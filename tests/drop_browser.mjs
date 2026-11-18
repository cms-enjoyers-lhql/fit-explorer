/** Native file drag/drop regression. Uses only the supplied synthetic ROOT. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {access,mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const args=process.argv.slice(2),arg=(key,fallback=null)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1]};
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const url=new URL(arg('--url',pathToFileURL(path.join(project,'dist/fit-explorer.html')).href));
const output=path.resolve(arg('--output',path.join(project,'qa','drop-'+Date.now())));await mkdir(output,{recursive:true});
const exists=async p=>{try{await access(p);return true}catch{return false}};
async function executable(){
 if(arg('--browser')||process.env.FIT_EXPLORER_BROWSER)return arg('--browser',process.env.FIT_EXPLORER_BROWSER);
 if(await exists(chromium.executablePath()))return chromium.executablePath();
 for(const base of [path.join(homedir(),'Library/Caches/ms-playwright'),path.join(homedir(),'.cache/ms-playwright')]){
  if(!await exists(base))continue;
  for(const folder of (await readdir(base)).filter(f=>f.startsWith('chromium_headless_shell-')).sort().reverse())for(const rel of ['chrome-headless-shell-mac-arm64/chrome-headless-shell','chrome-headless-shell-mac-x64/chrome-headless-shell','chrome-linux/headless_shell','chrome-linux64/headless_shell']){const p=path.join(base,folder,rel);if(await exists(p))return p}
 }
 throw Error('Install Playwright Chromium or pass --browser PATH.');
}
const bytes=await readFile(arg('--root',path.join(project,'examples/twin-gaussian.root'))),encoded=bytes.toString('base64');
const browser=await chromium.launch({headless:true,executablePath:await executable(),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox','--no-sandbox']});
const context=await browser.newContext({viewport:{width:1440,height:1024}}),errors=[],external=[],checks=[];let report;
await context.route('**/*',route=>{const target=new URL(route.request().url());if(['file:','data:','blob:'].includes(target.protocol)||target.origin===url.origin)return route.continue();external.push(target.href);return route.abort()});
async function init(page){page.on('pageerror',e=>errors.push(e.message));await page.evaluate(data=>{window.__rootBytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0))},encoded)}
async function send(page,type,selector='body',kind='valid',reset=false){return page.evaluate(({type,selector,kind,reset})=>{
 if(reset||!window.__transfer){const transfer=new DataTransfer();
  if(kind==='text')transfer.setData('text/plain','Synthetic text drag');
  else if(kind==='corrupt')transfer.items.add(new File(['invalid binary'],'broken.root',{type:'application/octet-stream'}));
  else if(kind==='wrong')transfer.items.add(new File(['not a fit'],'notes.txt',{type:'text/plain'}));
  else{transfer.items.add(new File([window.__rootBytes],'example.ROOT',{type:'application/octet-stream'}));if(kind==='multi')transfer.items.add(new File([window.__rootBytes],'second.root',{type:'application/octet-stream'}));if(kind==='folder')Object.defineProperty(transfer.items[0],'webkitGetAsEntry',{value:()=>({isDirectory:true})})}
  window.__transfer=transfer;
 }
 const event=new DragEvent(type,{dataTransfer:window.__transfer,bubbles:true,cancelable:true,clientX:200,clientY:200});if(kind==='folder')Object.defineProperty(event,'dataTransfer',{value:{types:['Files'],items:[{kind:'file',webkitGetAsEntry:()=>({isDirectory:true}),getAsFile:()=>null}],files:[]}});document.querySelector(selector).dispatchEvent(event);
 return {prevented:event.defaultPrevented,effect:window.__transfer.dropEffect,visible:!document.querySelector('[data-file-drop-overlay]').hidden};
},{type,selector,kind,reset})}
async function mark(page){await page.evaluate(()=>{window.fitExplorer.setState({playing:false,time:5,lightMotion:false});window.__oldViewer=window.fitExplorer;window.__oldState=window.fitExplorer.getState()})}
async function changed(page){await page.waitForFunction(()=>window.fitExplorer&&window.fitExplorer!==window.__oldViewer&&!document.getElementById('app').hasAttribute('aria-busy'));assert.equal(await page.evaluate(()=>window.fitExplorer.package.observed.reduce((a,b)=>a+b,0)),12000)}
async function unchanged(page){assert.equal(await page.evaluate(()=>window.fitExplorer===window.__oldViewer),true);assert.deepEqual(await page.evaluate(()=>window.fitExplorer.getState()),await page.evaluate(()=>window.__oldState))}
const passed=(name)=>checks.push({name,status:'PASS'});
try{
 const page=await context.newPage();await page.goto(url.href,{waitUntil:'networkidle'});await page.evaluate(()=>window.fitExplorerReady);await init(page);
 assert.equal(await page.locator('[data-file-drop-overlay]').count(),1);
 let result=await send(page,'dragenter','body','valid',true);assert.equal(result.prevented,true);assert.equal(result.visible,true);
 assert.equal(await page.locator('[data-file-drop-overlay] strong').textContent(),'Drop ROOT file to open');
 await send(page,'dragenter','canvas');await send(page,'dragleave','canvas');assert.equal(await page.locator('[data-file-drop-overlay]').isVisible(),true);
 await page.screenshot({path:path.join(output,'file-drop-overlay.png')});await page.keyboard.press('Escape');assert.equal(await page.locator('[data-file-drop-overlay]').isVisible(),false);await send(page,'dragover');assert.equal(await page.locator('[data-file-drop-overlay]').isVisible(),false);passed('file-only-overlay-nested-drag-and-escape');
 await mark(page);await send(page,'dragenter','canvas','valid',true);await send(page,'dragover','canvas');await send(page,'drop','canvas');await changed(page);assert.equal(await page.locator('[data-file-drop-overlay]').isVisible(),false);passed('native-root-drop-on-3d-canvas');
 await page.locator('[data-view="projections"]').click();await mark(page);await send(page,'drop','.chart svg','valid',true);await changed(page);passed('drop-on-projection');
 await page.locator('[data-view="guide"]').click();await mark(page);await send(page,'drop','.guide-content','valid',true);await changed(page);assert.equal(await page.locator('[data-file-drop-overlay]').count(),1);passed('drop-on-guide-and-after-remounts');
 for(const [kind,pattern]of [['wrong',/\.root/],['corrupt',/root/i],['multi',/one ROOT file/i],['folder',/Folders cannot/i]]){
  await mark(page);result=await send(page,'drop','canvas',kind,true);assert.equal(result.prevented,true);await page.locator('.error-panel').waitFor({state:'visible'});assert.match(await page.locator('.error-panel').innerText(),pattern);await unchanged(page);assert.equal(await page.locator('[data-file-drop-overlay]').isVisible(),false);await page.getByRole('button',{name:'Close',exact:true}).click();
 }
 passed('wrong-corrupt-multiple-and-folder-drops-retain-fit');
 await mark(page);result=await send(page,'dragenter','canvas','text',true);assert.equal(result.prevented,false);assert.equal(result.visible,false);result=await send(page,'drop','canvas');assert.equal(result.prevented,false);await unchanged(page);passed('text-drag-does-not-intercept-viewer');
 await mark(page);await page.evaluate(()=>{for(const count of [1,2]){const transfer=new DataTransfer();for(let i=0;i<count;i++)transfer.items.add(new File([window.__rootBytes],'fit'+i+'.root'));document.querySelector('canvas').dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}))}});await page.locator('.error-panel').waitFor({state:'visible'});await page.waitForTimeout(500);await unchanged(page);await page.getByRole('button',{name:'Close',exact:true}).click();passed('invalid-latest-drop-cancels-pending-native-load');
 // Recheck ordinary pointer gestures after installing the HTML drag listeners.
 await page.locator('[data-view="projections"]').click();await page.evaluate(()=>window.fitExplorer.setState({slice:{axis:0,lo:15,hi:35},playing:false,time:5}));
 const points=await page.evaluate(()=>{const svg=document.querySelector('.chart svg'),plot=window.fitExplorer.getProjectionData()[0].plot,matrix=svg.getScreenCTM();return [25/60,30/60].map(f=>{const p=svg.createSVGPoint();p.x=plot.left+f*(plot.width-plot.left-plot.right);p.y=plot.top+.5*(plot.height-plot.top-plot.bottom);const q=p.matrixTransform(matrix);return {x:q.x,y:q.y}})});
 await page.mouse.move(points[0].x,points[0].y);await page.mouse.down();await page.mouse.move(points[1].x,points[1].y,{steps:5});await page.mouse.up();assert.deepEqual(await page.evaluate(()=>window.fitExplorer.getProjectionData()[0].window.x),[20,40]);passed('ordinary-window-pointer-drag-unaffected');
 await page.close();const blank=await context.newPage();const html=(await readFile(path.join(project,'dist/fit-explorer.html'),'utf8')).replace(/<script id="fit-root" type="application\/octet-stream">[\s\S]*?<\/script>/,'');const emptyPath=path.join(output,'empty-viewer.html');await writeFile(emptyPath,html);await blank.goto(pathToFileURL(emptyPath).href,{waitUntil:'networkidle'});await blank.waitForFunction(()=>Object.hasOwn(window,'fitExplorerReady'));await blank.evaluate(()=>window.fitExplorerReady);await init(blank);await blank.locator('.load-card').waitFor({state:'visible'});
 result=await send(blank,'dragenter','body','valid',true);assert.equal(result.visible,true);await send(blank,'drop','.load-card');await blank.waitForFunction(()=>{const error=document.querySelector('.load-error')?.textContent;if(error)throw Error(error);return window.fitExplorer&&!document.getElementById('app').hasAttribute('aria-busy')},{},{timeout:30000,polling:100});assert.equal(await blank.locator('.subtitle').textContent(),'12,000 candidates');passed('empty-loader-root-drop');await blank.close();
 const exp=await context.newPage();const exportURL=new URL(url);exportURL.searchParams.set('export','1');await exp.goto(exportURL.href,{waitUntil:'networkidle'});await exp.evaluate(()=>window.fitExplorerReady);await init(exp);result=await send(exp,'dragenter','body','valid',true);assert.equal(result.visible,false);await exp.close();passed('export-mode-overlay-disabled');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);report={status:'PASS',checks,errors,external};
}catch(error){for(const [i,p] of context.pages().entries()){await writeFile(path.join(output,'failure-'+i+'.html'),await p.content()).catch(()=>{})}report={status:'FAIL',checks,errors,external,error:error.stack};process.exitCode=1}
finally{await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');await browser.close()}
console.log(JSON.stringify({status:report.status,checks:checks.length,error:report.error}));
