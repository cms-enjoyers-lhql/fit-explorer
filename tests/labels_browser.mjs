/** GPU text regression using only the supplied synthetic ROOT; no fits are run. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile,access,readdir} from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';
const args=process.argv.slice(2),arg=(k,f=null)=>{const i=args.indexOf(k);return i<0?f:args[i+1]};
if(!arg('--url')||!arg('--output'))throw Error('Pass --url and a new --output directory.');
const url=new URL(arg('--url')),output=path.resolve(arg('--output'));await mkdir(output,{recursive:true});
const exists=async p=>{try{await access(p);return true}catch{return false}};
async function executable(){
 if(arg('--browser')||process.env.FIT_EXPLORER_BROWSER)return arg('--browser',process.env.FIT_EXPLORER_BROWSER);
 if(await exists(chromium.executablePath()))return chromium.executablePath();
 for(const base of [path.join(homedir(),'Library/Caches/ms-playwright'),path.join(homedir(),'.cache/ms-playwright')]){
  if(!await exists(base))continue;
  for(const dir of (await readdir(base)).filter(n=>n.startsWith('chromium_headless_shell-')).sort().reverse())for(const rel of ['chrome-headless-shell-mac-arm64/chrome-headless-shell','chrome-headless-shell-mac-x64/chrome-headless-shell','chrome-linux/headless_shell','chrome-linux64/headless_shell']){const p=path.join(base,dir,rel);if(await exists(p))return p}
 }
 throw Error('Install Playwright Chromium or pass --browser PATH.');
}
const browser=await chromium.launch({headless:true,executablePath:await executable(),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox','--no-sandbox']});
const context=await browser.newContext({viewport:{width:1064,height:700},deviceScaleFactor:1}),page=await context.newPage(),errors=[],external=[],checks=[];let report;
page.on('pageerror',e=>errors.push(e.message));
await context.route('**/*',route=>{const target=new URL(route.request().url());if(['file:','data:','blob:'].includes(target.protocol)||target.origin===url.origin)return route.continue();external.push(target.href);return route.abort()});
const pass=(name,evidence)=>checks.push({name,status:'PASS',evidence});
const massLabels=rows=>rows.filter(row=>/^mass[12]-(tick|title)$/.test(row.role));
function foreground(rows,label,requireWholeViewport=true){
 const mass=massLabels(rows);
 assert.equal(mass.filter(r=>r.role==='mass1-tick').length,5,label+' m1 ticks');
 assert.equal(mass.filter(r=>r.role==='mass2-tick').length,4,label+' m2 ticks');
 assert.equal(mass.filter(r=>r.role.endsWith('title')).length,2,label+' mass titles');
 for(const row of mass){assert.equal(row.inFrustum,true,label+' '+row.text+' in view');assert.ok(row.baseline_pixels>0,label+' '+row.text+' has glyph pixels');const [left,top,right,bottom]=row.screen_bbox;if(requireWholeViewport)assert.ok(left>=-1&&top>=-1&&right<=1065&&bottom<=641,label+' '+row.text+' fits the scene');assert.ok(row.visible_fraction>=.98,label+' '+row.text+' foreground ink retained: '+row.visible_fraction)}
 return mass.map(({text,role,baseline_pixels,visible_pixels,visible_fraction})=>({text,role,baseline_pixels,visible_pixels,visible_fraction}));
}
try{
 await page.goto(url.href,{waitUntil:'networkidle'});await page.evaluate(()=>window.fitExplorerReady);
 const before=await page.evaluate(()=>JSON.stringify(window.fitExplorer.package));
 const sceneCSS='.topbar,.sidebar,.charts,.timeline,.scene-controls,.phase,.scale-label{display:none!important}.fit-app,.layout,.workspace{display:block!important;width:1064px!important;height:700px!important;min-height:0!important;padding:0!important;margin:0!important}.scene-wrap{position:fixed!important;inset:60px 0 auto!important;width:1064px!important;height:640px!important;overflow:hidden!important;border:0!important}.axis-label{font-size:21px!important}.axis-label.tick{font-size:17px!important}';await page.addStyleTag({content:sceneCSS});
 await page.evaluate(async()=>{await document.fonts.ready;window.fitExplorer.setState({view:'3d',components:['twin_peak'],scale:'log',logMinimum:.1,time:5,playing:false,data:'off',lightMotion:false,cameraTarget:[0,1.3,0]})});
 for(const [name,angle]of [['front',0],['right',Math.PI/2],['back',Math.PI],['left',3*Math.PI/2],['repro',.70+Math.PI/6]]){
  const rows=await page.evaluate(angle=>{window.fitExplorer.setState({cameraPosition:[17.8*Math.sin(angle),14.3,17.8*Math.cos(angle)],cameraTarget:[0,1.3,0]});return window.fitExplorer.getLabelVisibility({measure:true})},angle);
  pass('foreground-mass-labels-'+name,foreground(rows,name));await page.screenshot({path:path.join(output,name+'.png')});
 }
 const probeText=await page.evaluate(()=>window.fitExplorer.getLabelVisibility().find(row=>row.role==='mass1-title').text);
 await page.evaluate(()=>window.fitExplorer.setState({components:[]}));
 const baseProbe=await page.evaluate(text=>window.fitExplorer.measureLabelDepth({text,position:[0,-.4,0]}),probeText);
 assert.ok(baseProbe.baseline_pixels>0);assert.ok(baseProbe.visible_fraction>=.99,'Decorative base must not erase text');pass('decorative-base-excluded-from-text-depth',baseProbe);
 await page.evaluate(()=>window.fitExplorer.setState({components:['twin_peak','power_background'],scale:'linear'}));
 const behind=await page.evaluate(text=>window.fitExplorer.measureLabelDepth({text,position:[0,-.4,0]}),probeText);
 assert.ok(behind.baseline_pixels>0);assert.ok(behind.visible_fraction<.01,'Glyph pixels behind the model must be hidden');pass('actual-glyph-fragments-occluded-behind-model',behind);
 const partial=await page.evaluate(text=>{for(let i=-60;i<=60;i++){const row=window.fitExplorer.measureLabelDepth({text,position:[i/20,1,0]});if(row.baseline_pixels>0&&row.visible_fraction>.05&&row.visible_fraction<.95)return row}return null},probeText);
 assert.ok(partial,'A silhouette-crossing word must retain only its visible glyph fragments');pass('partial-word-depth-clipping',partial);
 const cleanup=await page.evaluate(()=>{const viewer=window.fitExplorer,rows=[];for(const scale of ['log','linear','log','linear','log']){viewer.setState({scale});const labels=viewer.getLabelVisibility({measure:true});rows.push({scale,labels,domCount:document.querySelectorAll('.axis-label').length})}return rows});
 for(const row of cleanup){assert.equal(row.labels.length,row.domCount);assert.ok(row.labels.every(l=>l.method==='gpu-depth'));foreground(row.labels,'scale '+row.scale)}
 pass('scale-switch-glyph-cleanup-and-foreground-labels',cleanup.map(row=>({scale:row.scale,count:row.labels.length})));
 const near=await page.evaluate(()=>{const angle=.70+Math.PI/6;window.fitExplorer.setState({cameraPosition:[16*Math.sin(angle),13,16*Math.cos(angle)],cameraTarget:[0,1.3,0]});return window.fitExplorer.getLabelVisibility({measure:true})});
 pass('foreground-labels-near-zoom',foreground(near,'near zoom',false));
 const closeTitles=await page.evaluate(()=>{window.fitExplorer.setState({cameraPosition:[7,1.41,0],cameraTarget:[0,1.3,0]});return window.fitExplorer.getLabelVisibility({measure:true}).filter(row=>row.role==='mass1-title'||row.role==='mass2-title')});
 assert.equal(closeTitles.length,2);for(const row of closeTitles){assert.ok(row.inFrustum&&row.baseline_pixels>0,'Near minimum-distance title stays in front of camera: '+row.text);assert.ok(row.visible_fraction>=.98,'Near minimum-distance title retains its ink: '+JSON.stringify(row))}
 pass('minimum-distance-low-elevation-mass-titles',closeTitles);await page.screenshot({path:path.join(output,'minimum-distance.png')});
 const dprContext=await browser.newContext({viewport:{width:1064,height:700},deviceScaleFactor:2}),dprPage=await dprContext.newPage();
 dprPage.on('pageerror',e=>errors.push(e.message));await dprContext.route('**/*',route=>{const target=new URL(route.request().url());if(['file:','data:','blob:'].includes(target.protocol)||target.origin===url.origin)return route.continue();external.push(target.href);return route.abort()});
 await dprPage.goto(url.href,{waitUntil:'networkidle'});await dprPage.evaluate(()=>window.fitExplorerReady);await dprPage.addStyleTag({content:sceneCSS});
 const retina=await dprPage.evaluate(async()=>{await document.fonts.ready;const angle=.70+Math.PI/6;window.fitExplorer.setState({view:'3d',components:['twin_peak'],data:'off',scale:'log',logMinimum:.1,time:5,playing:false,lightMotion:false,cameraPosition:[17.8*Math.sin(angle),14.3,17.8*Math.cos(angle)],cameraTarget:[0,1.3,0]});return window.fitExplorer.getLabelVisibility({measure:true})});
 const dprEvidence=foreground(retina,'DPR2'),reference=checks.find(c=>c.name==='foreground-mass-labels-repro').evidence;
 assert.ok(dprEvidence.reduce((n,r)=>n+r.baseline_pixels,0)>2.8*reference.reduce((n,r)=>n+r.baseline_pixels,0),'DPR2 diagnostics must measure the physical glyph pixel grid');
 pass('retina-dpr2-fragment-measurement',dprEvidence);await dprContext.close();
 assert.equal(await page.evaluate(()=>JSON.stringify(window.fitExplorer.package)),before,'Labels must not mutate saved numerical data');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);report={status:'PASS',checks,errors,external,new_minimizations:0};
}catch(error){report={status:'FAIL',checks,errors,external,error:error.stack};process.exitCode=1}
finally{await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');await browser.close()}
console.log(JSON.stringify({status:report.status,checks:checks.length,error:report.error}));
