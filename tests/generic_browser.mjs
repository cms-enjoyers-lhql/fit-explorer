/** Real native RooFit demo regression; no fits or event generation are executed.
 * node tests/generic_browser.mjs --url file:///.../standalone.html --output DIR
 *   [--root /.../fit.root] [--reference /.../native-ui-reference.json] [--browser PATH]
 */
import assert from 'node:assert/strict';
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const args=process.argv.slice(2),arg=(key,fallback=null)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1]};
if(!arg('--url')||!arg('--output'))throw Error('Pass --url and a new --output directory.');
const exists=async value=>{try{await access(value);return true}catch{return false}};
async function executable(){
  if(arg('--browser'))return arg('--browser');
  if(process.env.FIT_EXPLORER_BROWSER)return process.env.FIT_EXPLORER_BROWSER;
  if(await exists(chromium.executablePath()))return chromium.executablePath();
  for(const base of [path.join(homedir(),'Library/Caches/ms-playwright'),path.join(homedir(),'.cache/ms-playwright')]){
    if(!await exists(base))continue;
    for(const folder of (await readdir(base)).filter(v=>v.startsWith('chromium_headless_shell-')).sort().reverse())for(const relative of ['chrome-headless-shell-mac-arm64/chrome-headless-shell','chrome-headless-shell-mac-x64/chrome-headless-shell','chrome-linux/headless_shell','chrome-linux64/headless_shell']){const candidate=path.join(base,folder,relative);if(await exists(candidate))return candidate}
  }
  throw Error('No Chromium found. Pass --browser.');
}
const url=new URL(arg('--url')),output=path.resolve(arg('--output'));
assert.ok(url.protocol==='file:'||(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)),'Use a local viewer URL.');
await mkdir(output);
const reference=arg('--reference')?JSON.parse(await readFile(arg('--reference'),'utf8')):null;
const browser=await chromium.launch({headless:true,executablePath:await executable(),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox','--no-sandbox']});
const context=await browser.newContext({viewport:{width:1440,height:1024},deviceScaleFactor:1}),page=await context.newPage(),errors=[],external=[],checks=[],started=Date.now();
page.on('pageerror',error=>errors.push(error.message));
await context.route('**/*',route=>{const target=new URL(route.request().url());if(['file:','blob:','data:'].includes(target.protocol)||target.origin===url.origin)return route.continue();external.push(target.href);return route.abort()});
const pass=(name,evidence={})=>checks.push({name,status:'PASS',...evidence});
const close=(actual,expected,label,tolerance=1e-8)=>assert.ok(Math.abs(actual-expected)<=tolerance*Math.max(1,Math.abs(actual),Math.abs(expected)),`${label}: ${actual} vs ${expected}`);
const screenshot=name=>page.screenshot({path:path.join(output,name+'.png'),animations:'disabled'});
const state=next=>page.evaluate(next=>window.fitExplorer.setState(next).getState(),next);
async function ready(){await page.evaluate(async()=>{await window.fitExplorerReady;if(!window.fitExplorer)throw Error('No native ROOT fit loaded');window.fitExplorer.setState({playing:false,time:5,lightMotion:false});await document.fonts.ready})}
async function projectionCheck(region,ids){
  const evidence=await page.evaluate(({region,ids})=>{
    const viewer=window.fitExplorer,p=viewer.package,[nx,ny]=p.shape,all=items=>items.flatMap(c=>[c,...all(c.children??[])]),byId=Object.fromEntries(all(p.components).map(c=>[c.id,c]));
    viewer.setState({components:ids,time:5,playing:false,slice:{axis:'both',xlo:region[0][0],xhi:region[0][1],ylo:region[1][0],yhi:region[1][1]}});
    return viewer.getProjectionData().map((record,axis)=>{
      const observed=Array(p.shape[axis]).fill(0),expected=Array(p.shape[axis]).fill(0);
      for(let i=region[0][0];i<region[0][1];i++)for(let j=region[1][0];j<region[1][1];j++){observed[axis?j:i]+=p.observed[i*ny+j];for(const id of ids)expected[axis?j:i]+=byId[id].expected[i*ny+j]}
      const sampling=p.projection_samples.axes[axis],other=region[1-axis],own=region[axis],points=[],total=[];
      for(let k=0;k<sampling.points.length;k++){const x=sampling.points[k];if(x<p.axes[axis].edges[own[0]]-1e-12||x>p.axes[axis].edges[own[1]]+1e-12)continue;let value=0;for(const id of ids)for(let b=other[0];b<other[1];b++)value+=sampling.components[id][k*sampling.other_bins+b];points.push(x);total.push(value)}
      return {axis,total:record.observed_total,window:record.window,maxObservedDifference:Math.max(...observed.map((v,i)=>Math.abs(v-record.observed[i]))),maxExpectedDifference:Math.max(...expected.map((v,i)=>Math.abs(v-record.expected[i]))),maxCurveDifference:Math.max(...total.map((v,i)=>Math.abs(v-record.total[i]))),pointCount:record.points.length,expectedPointCount:points.length,source:record.source};
    });
  },{region,ids});
  assert.equal(evidence[0].total,evidence[1].total);
  for(const record of evidence){assert.equal(record.maxObservedDifference,0);assert.ok(record.maxExpectedDifference<1e-8);assert.ok(record.maxCurveDifference<1e-8);assert.equal(record.pointCount,record.expectedPointCount);assert.equal(record.source,'integrated-pdf-samples')}
  return evidence;
}
async function drag(axis,from,to){
  const positions=await page.evaluate(({axis,from,to})=>{const svg=document.querySelectorAll('.chart svg')[axis],plot=window.fitExplorer.getProjectionData()[axis].plot,matrix=svg.getScreenCTM();return [from,to].map(f=>{const point=svg.createSVGPoint();point.x=plot.left+f*(plot.width-plot.left-plot.right);point.y=plot.top+(plot.height-plot.top-plot.bottom)/2;const screen=point.matrixTransform(matrix);return {x:screen.x,y:screen.y}})},{axis,from,to});
  await page.mouse.move(positions[0].x,positions[0].y);await page.mouse.down();await page.mouse.move(positions[1].x,positions[1].y,{steps:5});await page.mouse.up();
  return page.evaluate(()=>window.fitExplorer.getProjectionData()[0].window);
}
let report;
try{
  await page.goto(url.href,{waitUntil:'networkidle',timeout:60000});await ready();
  const initial=await page.evaluate(()=>{const p=window.fitExplorer.package;return {title:p.title,channel:p.channel,events:p.observed.reduce((a,b)=>a+b,0),shape:p.shape,components:p.components.map(c=>({id:c.id,label:c.label,yield:c.yield,children:c.children?.map(ch=>({id:ch.id,label:ch.label,yield:ch.yield}))})),parameters:p.parameters,labels:[...document.querySelectorAll('.component-card [data-component-label]')].map(el=>el.textContent),colors:[...document.querySelectorAll('.component-card')].map(el=>el.style.getPropertyValue('--component'))}});
  assert.equal(initial.events,12000);assert.deepEqual(initial.components.map(c=>c.id),['twin_peak','power_background']);assert.equal(initial.components[0].children.length,2);assert.deepEqual(initial.labels,initial.components.map(c=>c.label));assert.ok(initial.colors.every(c=>/^#[\da-f]{6}$/i.test(c)));assert.notEqual(initial.colors[0],initial.colors[1]);assert.ok(!initial.components.some(c=>['SS','SB','BS','BB'].includes(c.id)));
  const [peak,background]=initial.components,children=peak.children,topIds=initial.components.map(c=>c.id),childIds=children.map(c=>c.id),[nx,ny]=initial.shape;
  pass('actual-native-demo-arbitrary-labels-hierarchy-and-colors',initial);await screenshot('generic-fit');
  if(reference){
    const top=reference.top??reference.components;
    for(const component of initial.components){const expected=top[component.id];close(component.yield.value,expected.value,component.id+' yield');close(component.yield.error,expected.error,component.id+' error')}
    for(let i=0;i<children.length;i++){const expected=reference.children[children[i].id]??reference.children[i];close(children[i].yield.value,expected.value,'child yield');close(children[i].yield.error,expected.error,'child full-covariance error',1e-7)}
    for(const p of initial.parameters)if(reference.parameters?.[p.name]){close(p.value,reference.parameters[p.name].value,p.name+' value');if(p.error!==null)close(p.error,reference.parameters[p.name].error,p.name+' error')}
    pass('saved-native-result-and-full-covariance-reference',{source:path.resolve(arg('--reference'))});
  }
  const allArrays=await page.evaluate(()=>JSON.stringify({observed:window.fitExplorer.package.observed,components:window.fitExplorer.package.components,projection_samples:window.fitExplorer.package.projection_samples}));
  const timing=[];
  for(const time of [0,.5,1.25,2,2.75,3.5,5]){await state({components:topIds,time,playing:false});timing.push(await page.evaluate(()=>({time:window.fitExplorer.getState().time,total:window.fitExplorer.getProjectionData()[0].expected_total})))}
  close(timing[0].total,0,'animation start');close(timing[1].total,0,'data-only hold');close(timing[3].total,peak.yield.value,'first file-order component',1e-5);close(timing[5].total,peak.yield.value+background.yield.value,'animation final model',1e-5);close(timing[6].total,timing[5].total,'final hold');
  assert.ok(timing.every((r,i)=>!i||r.total>=timing[i-1].total-1e-7));pass('generic-file-order-additive-animation',{timing});
  await state({components:topIds,time:5});await page.locator(`[data-children="${peak.id}"]`).click();
  assert.equal(await page.locator(`[data-toggle="${childIds[0]}"]`).isChecked(),true);
  await page.locator(`[data-solo="${childIds[0]}"]`).click();
  const single=await page.locator(`[data-card="${peak.id}"]`).evaluate(el=>({name:el.querySelector('[data-component-label]').textContent,yieldText:el.querySelector('.yield').textContent,detailsVisible:!el.querySelector('.details').hidden}));
  assert.equal(single.name,children[0].label);assert.equal(single.detailsVisible,true);const printed=single.yieldText.split('±').map(v=>Number(v.replace(/[^\d.-]/g,'')));assert.ok(Math.abs(printed[0]-children[0].yield.value)<=.51);assert.ok(Math.abs(printed[1]-children[0].yield.error)<=.51);
  for(const child of children){const rejected=await page.evaluate(({parent,child})=>{const before=window.fitExplorer.getState().components;try{window.fitExplorer.setState({components:[parent,child]});return false}catch{return JSON.stringify(window.fitExplorer.getState().components)===JSON.stringify(before)}},{parent:peak.id,child:child.id});assert.equal(rejected,true)}
  await state({components:childIds,time:5});const multiple=await page.locator(`[data-card="${peak.id}"]`).evaluate(el=>({name:el.querySelector('[data-component-label]').textContent,text:el.querySelector('.yield').textContent}));assert.equal(multiple.name,children.map(c=>c.label).join(' + '));assert.ok(!multiple.text.includes('±'),'Combined child covariance error must not be invented');
  await state({components:[...childIds,background.id],time:5});assert.equal(await page.locator('.phase').textContent(),'Full model');
  await page.locator(`[data-toggle="${childIds[0]}"]`).uncheck();const partial=await page.evaluate(()=>({components:window.fitExplorer.getState().components,total:window.fitExplorer.getProjectionData()[0].expected_total}));assert.ok(partial.components.includes(childIds[1])&&partial.components.includes(background.id)&&!partial.components.includes(peak.id));close(partial.total,children[1].yield.value+background.yield.value,'partial child+background total',1e-5);assert.equal(await page.locator(`[data-toggle="${peak.id}"]`).evaluate(el=>el.indeterminate),true);
  pass('native-child-solo-multiselect-covariance-display-and-parent-guards',{single,multiple,partial});await screenshot('generic-child-selection');
  const region=[[Math.floor(nx*.25),Math.floor(nx*.7)],[Math.floor(ny*.2),Math.floor(ny*.65)]];
  const selected=await projectionCheck(region,[...childIds,background.id]);pass('same-candidates-arbitrary-child-rectangle-projections',{selected});
  const closure=await page.evaluate(({parent,children})=>{const v=window.fitExplorer;v.setState({components:[parent]});const baseline=v.getProjectionData().map(r=>({expected:[...r.expected],total:[...r.total]}));v.setState({components:children});return v.getProjectionData().map((r,k)=>({binDifference:Math.max(...r.expected.map((x,i)=>Math.abs(x-baseline[k].expected[i]))),curveDifference:Math.max(...r.total.map((x,i)=>Math.abs(x-baseline[k].total[i])))}))},{parent:peak.id,children:childIds});assert.ok(closure.every(r=>r.binDifference<1e-4&&r.curveDifference<1e-4));pass('finite-window-native-parent-child-closure',{closure});
  await state({components:topIds,view:'projections',time:5});assert.equal(await page.locator('[data-window-bound]').count(),4);
  const xmid=(region[0][0]+region[0][1])/(2*nx);let moved=await drag(0,xmid,xmid+5/nx);assert.deepEqual(moved,{x:region[0].map(v=>v+5),y:region[1]});
  const ymid=(region[1][0]+region[1][1])/(2*ny);moved=await drag(1,ymid,ymid+3/ny);assert.deepEqual(moved,{x:region[0].map(v=>v+5),y:region[1].map(v=>v+3)});await projectionCheck([moved.x,moved.y],topIds);pass('both-axis-pan-preserves-width-and-other-mass-window',{moved});await screenshot('generic-projection-windows');
  await page.locator('[data-scale-toggle]').click();assert.equal(await page.evaluate(()=>window.fitExplorer.getState().scale),'log');await projectionCheck([moved.x,moved.y],topIds);assert.equal(await page.evaluate(()=>JSON.stringify({observed:window.fitExplorer.package.observed,components:window.fitExplorer.package.components,projection_samples:window.fitExplorer.package.projection_samples})),allArrays);pass('log-display-preserves-saved-native-numerical-tables');
  await page.locator('[data-view="guide"]').click();assert.ok(!/json|SS\/SB\/BS\/BB|exactly four/i.test(await page.locator('.guide-content').innerText()));
  const downloading=page.waitForEvent('download');await page.locator('[data-download-example]').click();const download=await downloading;assert.match(download.suggestedFilename(),/\.root$/i);const downloaded=path.join(output,download.suggestedFilename());await download.saveAs(downloaded);assert.equal((await readFile(downloaded)).subarray(0,4).toString(),'root');
  await page.locator('[data-guide-back]').click();await page.evaluate(()=>{window.__previousViewer=window.fitExplorer});await page.setInputFiles('#load-fit',downloaded);await page.waitForFunction(()=>window.fitExplorer!==window.__previousViewer&&!document.getElementById('app').hasAttribute('aria-busy'));await ready();const downloadedState=await page.evaluate(()=>({events:window.fitExplorer.package.observed.reduce((a,b)=>a+b,0),ids:window.fitExplorer.package.components.map(c=>c.id)}));assert.equal(downloadedState.events,12000);assert.deepEqual(downloadedState.ids,topIds);pass('download-example-is-real-native-generic-fit-and-loads-through-picker',downloadedState);
  if(arg('--root')){await page.evaluate(()=>{window.__previousViewer=window.fitExplorer});await page.setInputFiles('#load-fit',path.resolve(arg('--root')));await page.waitForFunction(()=>window.fitExplorer!==window.__previousViewer&&!document.getElementById('app').hasAttribute('aria-busy'));await ready();assert.equal(await page.evaluate(()=>window.fitExplorer.package.observed.reduce((a,b)=>a+b,0)),12000);pass('explicit-native-root-picker')}
  for(const [name,width,height] of [['laptop',1280,800],['mobile',390,844]]){await page.setViewportSize({width,height});await state({view:'3d',components:topIds,time:5,slice:{axis:null}});const size=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,buttons:[...document.querySelectorAll('[data-view],[data-scale-toggle]')].map(el=>{const b=el.getBoundingClientRect();return {left:b.left,right:b.right}})}));assert.ok(size.scrollWidth<=size.width+1,name+' overflow');assert.ok(size.buttons.every(b=>b.left>=0&&b.right<=size.width+1),name+' controls');await screenshot('generic-'+name);pass('responsive-'+name,size)}
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);report={schema:'fit-explorer.generic-browser-qa',version:1,status:'PASS',url:url.href,checks,errors,external,new_minimizations:0,elapsed_seconds:(Date.now()-started)/1000};
}catch(error){report={schema:'fit-explorer.generic-browser-qa',version:1,status:'FAIL',url:url.href,checks,errors,external,error:error.stack,new_minimizations:0,elapsed_seconds:(Date.now()-started)/1000};process.exitCode=1}
finally{await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');await browser.close()}
console.log(JSON.stringify({status:report.status,checks:checks.length,output,error:report.error,elapsed_seconds:report.elapsed_seconds}));
