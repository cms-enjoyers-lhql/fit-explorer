/** Synthetic ROOT reload lifecycle regression. No fits or generation are run.
 * node tests/memory_lifecycle.mjs --url LOCAL_URL --output DIRECTORY
 *   [--root examples/twin-gaussian.root] [--browser PATH] [--cycles 30] [--idle-ms 15000]
 */
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {chromium} from 'playwright';
const args=process.argv.slice(2),arg=(name,fallback=null)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1]};
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const url=new URL(arg('--url',pathToFileURL(path.join(project,'dist/fit-explorer.html')).href));
assert.ok(url.protocol==='file:'||(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)),'Use a local viewer URL.');
const output=path.resolve(arg('--output',path.join(project,'qa','memory-'+Date.now()))),rootPath=path.resolve(arg('--root',path.join(project,'examples/twin-gaussian.root')));
const cycles=Number(arg('--cycles',30)),idleMs=Number(arg('--idle-ms',15000));
assert.ok(Number.isSafeInteger(cycles)&&cycles>=10,'Use at least 10 reload cycles.');
assert.ok(Number.isFinite(idleMs)&&idleMs>=1000&&idleMs<=60000,'Idle duration must be 1000–60000 ms.');
await mkdir(output,{recursive:true});
const bytes=await readFile(rootPath),encoded=bytes.toString('base64'),digest=buffer=>createHash('sha256').update(buffer).digest('hex');
const report={started:new Date().toISOString(),cycles,idle_ms:idleMs,fixture:{name:path.basename(rootPath),bytes:bytes.length,sha256:digest(bytes)},samples:[],errors:[],external:[],warnings:[]};
const save=()=>writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
let browser;
try{
  browser=await chromium.launch({headless:true,executablePath:arg('--browser',process.env.FIT_EXPLORER_BROWSER||chromium.executablePath()),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox','--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1064,height:800},deviceScaleFactor:1}),page=await context.newPage(),cdp=await context.newCDPSession(page);
  await context.route('**/*',route=>{const target=new URL(route.request().url());if(['file:','data:','blob:'].includes(target.protocol)||target.origin===url.origin)return route.continue();report.external.push(target.href);return route.abort()});
  page.on('pageerror',error=>report.errors.push(error.message));
  page.on('console',message=>{if(['warning','error'].includes(message.type()))report.warnings.push(message.text())});
  await page.goto(url.href,{waitUntil:'networkidle',timeout:60000});
  const ready=await page.waitForFunction(()=>Boolean(window.fitExplorerReady),null,{polling:100});await ready.dispose();
  await page.evaluate(async()=>{await window.fitExplorerReady;if(!window.fitExplorer)throw Error('Load the synthetic demo before this test.');await document.fonts.ready;return true});
  // Exercise the diagnostic sprite/target disposal path as well as normal labels.
  await page.evaluate(()=>{window.fitExplorer.getLabelVisibility({measure:true});return true});
  async function sample(stage,cycle){
    await page.evaluate(()=>{for(const key of Object.getOwnPropertyNames(window))if(/^__(old|previous)/i.test(key))try{delete window[key]}catch{}});
    await cdp.send('HeapProfiler.collectGarbage');await page.waitForTimeout(250);await cdp.send('HeapProfiler.collectGarbage');await page.waitForTimeout(100);
    const heap=await cdp.send('Runtime.getHeapUsage'),dom=await cdp.send('Memory.getDOMCounters');
    const counts=await page.evaluate(()=>({canvases:document.querySelectorAll('canvas').length,apps:document.querySelectorAll('.fit-app').length,overlays:document.querySelectorAll('[data-file-drop-overlay]').length}));
    report.samples.push({stage,cycle,heap,dom,counts});await save();
    console.log(JSON.stringify({stage,cycle,heap_mib:heap.usedSize/2**20,backing_mib:heap.backingStorageSize/2**20,dom}));
  }
  for(let cycle=1;cycle<=cycles;cycle++){
    // Use the real picker change handler. CDP setInputFiles can retain retired
    // inputs in inspector state and distort a detached-DOM lifecycle test.
    await page.evaluate(encoded=>{
      const raw=atob(encoded),data=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)data[i]=raw.charCodeAt(i);
      const transfer=new DataTransfer();transfer.items.add(new File([data],'synthetic-example.root',{type:'application/octet-stream'}));
      const input=document.getElementById('load-fit');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    },encoded);
    const loaded=await page.waitForFunction(()=>Boolean(window.fitExplorer&&!document.getElementById('app').hasAttribute('aria-busy')&&document.getElementById('load-fit')?.files.length===0),null,{polling:100,timeout:30000});await loaded.dispose();
    if(cycle===2||cycle%5===0||cycle===cycles)await sample(cycle===2?'warmup':'reload',cycle);
  }
  await page.waitForTimeout(idleMs);await sample('idle',cycles);
  const baseline=report.samples[0],growth={heap_mib:Math.max(...report.samples.map(s=>s.heap.usedSize-baseline.heap.usedSize))/2**20,nodes:Math.max(...report.samples.map(s=>s.dom.nodes-baseline.dom.nodes)),listeners:Math.max(...report.samples.map(s=>s.dom.jsEventListeners-baseline.dom.jsEventListeners))};
  report.growth=growth;
  assert.ok(growth.heap_mib<8,'Retained heap grows across repeated synthetic reloads.');
  assert.ok(growth.nodes<200,'Detached viewer DOM grows across reloads.');
  assert.ok(growth.listeners<=2,'Viewer event listeners accumulate.');
  assert.ok(report.samples.every(s=>s.counts.canvases===1&&s.counts.apps===1&&s.counts.overlays===1),'Viewer canvases or overlays accumulate.');
  report.simultaneous_viewers=await page.evaluate(()=>{
    const first=window.fitExplorer,holder=document.createElement('div');holder.style.cssText='position:fixed;inset:0;z-index:1000';document.body.appendChild(holder);
    const second=window.FitExplorer.mount(holder,first.package,{export:true});
    try{
      second.setState({lightMotion:false,playing:false,time:5,data:'off'});second.render();second.render();
      const canvas=holder.querySelector('canvas'),before=canvas.toDataURL();first.dispose();first.dispose();second.render();second.render();
      const after=canvas.toDataURL();return {pixels_equal:before===after,image_bytes:after.length,canvas_count:document.querySelectorAll('canvas').length};
    }finally{second.dispose();holder.remove();window.fitExplorer=null;window.fitExplorerReady=Promise.resolve(null)}
  });
  assert.ok(report.simultaneous_viewers.pixels_equal&&report.simultaneous_viewers.image_bytes>10000,'Another mounted viewer changed after renderer disposal.');
  assert.equal(report.simultaneous_viewers.canvas_count,1);
  assert.equal(digest(await readFile(rootPath)),report.fixture.sha256,'Synthetic ROOT input bytes changed.');
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.external,[]);
  assert.ok(!report.warnings.some(message=>/Too many active WebGL contexts/.test(message)),'Disposed contexts accumulate.');
  report.status='PASS';report.finished=new Date().toISOString();await save();console.log('PASS synthetic viewer memory lifecycle');
}catch(error){report.status='FAIL';report.failure=error.message;await save();throw error}
finally{await browser?.close()}
