/** Deterministic, offline 5 s capture of the same interactive scene. */
import { chromium } from 'playwright';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const args=process.argv.slice(2),arg=(name,fallback=null)=>{const i=args.indexOf(name);return i>=0?args[i+1]:fallback};
for(const flag of ['--url','--output','--root','--components','--label','--browser','--gif-fps','--gif-width'])if(args.includes(flag)&&(arg(flag)==null||arg(flag).startsWith('--')))throw Error('Missing value for '+flag);
if(!arg('--output')){console.error('Usage: npm run render -- --output DIR [--root fit.root] [--components all|component_a,component_b] [--label TEXT] [--poster-only] [--gif-width 1280] [--browser PATH]');process.exit(2)}
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const url=arg('--url')?new URL(arg('--url')):pathToFileURL(path.join(project,'dist/fit-explorer.html'));
if(!['http:','file:'].includes(url.protocol)||(url.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw Error('Renderer accepts a local file or loopback HTTP URL only');
url.searchParams.set('export','1');
const output=path.resolve(arg('--output'));await mkdir(output,{recursive:true});
const exists=async p=>{try{await access(p,constants.F_OK);return true}catch{return false}};
for(const name of ['poster.png','fit-animation.mp4','fit-animation.gif','render-report.json'])if(await exists(path.join(output,name)))throw Error('Refusing to overwrite '+path.join(output,name));
async function browserPath(){
  if(arg('--browser'))return arg('--browser');
  if(process.env.FIT_EXPLORER_BROWSER)return process.env.FIT_EXPLORER_BROWSER;
  const executable=chromium.executablePath();
  if(await exists(executable))return executable;
  throw Error('No Playwright Chromium found. Run npx playwright install chromium or set FIT_EXPLORER_BROWSER.');
}
let selected=arg('--components')?.split(',').map(id=>id.trim()).filter(Boolean)??null;
if(selected&&(!selected.length||new Set(selected).size!==selected.length))throw Error('Pass a nonempty, unique comma-separated component list.');
const allComponents=selected?.length===1&&selected[0]==='all';
const label=arg('--label');
const gifFps=Number(arg('--gif-fps','15')),gifWidth=Number(arg('--gif-width','1280'));
if(!Number.isInteger(gifFps)||gifFps<2||gifFps>30)throw Error('GIF frame rate must be an integer between 2 and 30.');
if(!Number.isInteger(gifWidth)||gifWidth<640||gifWidth>1920||gifWidth%2)throw Error('GIF width must be an even integer between 640 and 1920.');
const ffmpegRun=options=>new Promise((resolve,reject)=>{
  const child=spawn(process.env.FFMPEG??'ffmpeg',['-hide_banner','-loglevel','error','-n',...options],{stdio:['ignore','inherit','inherit']});
  child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('FFmpeg exited '+code)));
});
async function packageFingerprint(){
  return page.evaluate(async()=>{
    const bytes=new TextEncoder().encode(JSON.stringify(window.fitExplorer.package));
    const digest=await crypto.subtle.digest('SHA-256',bytes);
    return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
  });
}
const executablePath=await browserPath();
const browser=await chromium.launch({headless:true,executablePath,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox','--no-sandbox']});
const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1});const page=await context.newPage();const errors=[],externalRequests=[];
page.on('pageerror',error=>errors.push(error.message));
await context.route('**/*',async route=>{const target=new URL(route.request().url());if(['data:','blob:','file:'].includes(target.protocol)||target.origin===url.origin)return route.continue();externalRequests.push(target.origin);return route.abort()});
const started=Date.now();let frames=0;
try{
  await page.goto(url.href,{waitUntil:'networkidle',timeout:60000});
  await page.evaluate(async()=>{await window.fitExplorerReady;if(!window.fitExplorer)throw Error('Viewer did not load a ROOT model');window.fitExplorer.setState({view:'3d',playing:false});await document.fonts.ready});
  if(arg('--root')){
    await page.evaluate(()=>{window.__beforeRootViewer=window.fitExplorer});
    await page.setInputFiles('#load-fit',path.resolve(arg('--root')));
    await page.waitForFunction(()=>window.fitExplorer!==window.__beforeRootViewer,{},{timeout:30000});
    await page.evaluate(()=>{delete window.__beforeRootViewer;window.fitExplorer.setState({playing:false})});
  }
  if(allComponents)selected=await page.evaluate(()=>window.fitExplorer.package.components.map(component=>component.id));
  // Capture only the scientific scene: axes/units and a short component label.
  // The original viewer objects and numerical package remain unchanged.
  await page.evaluate(async()=>{
    if(!document.querySelector('.scene-wrap'))throw Error('This viewer has no 3D scene.');
    const style=document.createElement('style');style.dataset.renderSceneOnly='';
    style.textContent='.topbar,.sidebar,.charts,.timeline,.guide-panel,.scene-controls,.phase,.scale-label{display:none!important}.fit-app,.layout{display:block!important;height:100vh!important}.workspace{display:contents!important}.scene-wrap{display:block!important;position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;min-height:0!important;margin:0!important;border:0!important}.scene{position:absolute!important;inset:0!important}.axis-label{font-size:20px!important}.axis-label.tick{font-size:16px!important}';
    document.head.appendChild(style);
    for(const element of document.querySelectorAll('.axis-label:not(.tick)'))element.textContent=element.textContent.replace(/expected\s+weighted\s+yield/gi,'Yield');
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    window.fitExplorer.setState({data:'off'});window.fitExplorer.render();
  });
  const before=await packageFingerprint();
  const fixedMaximum=await page.evaluate(()=>window.fitExplorer.package.display?.z_max);
  if(!Number.isFinite(fixedMaximum)||fixedMaximum<=0)throw Error('A positive full-model display.z_max is required for fixed-height export.');
  await page.evaluate(()=>window.fitExplorer.setTime(5));
  const fullCountTicks=await page.locator('.count-tick').allTextContents();
  if(selected)await page.evaluate(ids=>window.fitExplorer.setState({components:ids,playing:false,time:5}),selected);
  const componentLabel=await page.evaluate(({label,selected,allComponents})=>{
    const flatten=items=>items.flatMap(item=>[item,...flatten(item.children??[])]);
    const nodes=flatten(window.fitExplorer.package.components),names=new Map(nodes.map(item=>[item.id,item.label||item.id]));
    const text=label||(allComponents?'Full model':selected?selected.map(id=>names.get(id)||id).join(' + '):'Full model');
    const overlay=document.createElement('div');overlay.dataset.renderLabel='';overlay.textContent=text;
    overlay.style.cssText='position:fixed;left:24px;top:20px;max-width:calc(100vw - 48px);z-index:50;padding:0;color:inherit;font-family:inherit;font-size:24px;font-weight:500;line-height:1.35;pointer-events:none;overflow-wrap:anywhere;';
    document.body.appendChild(overlay);return text;
  },{label,selected,allComponents});
  const selectedYields=selected?await page.evaluate(ids=>{
    const flatten=items=>items.flatMap(item=>[item,...flatten(item.children??[])]),nodes=flatten(window.fitExplorer.package.components);
    const byId=new Map(nodes.map(item=>[item.id,item]));
    const rows=ids.map(id=>{const item=byId.get(id);return {id,label:item.label||id,value:item.yield?.value??item.expected.reduce((a,b)=>a+b,0),error:Number.isFinite(item.yield?.error)?item.yield.error:null}});
    return rows;
  },selected):null;
  const orbit=await page.evaluate(()=>{const state=window.fitExplorer.getState();return {position:state.cameraPosition,target:state.cameraTarget}});
  if(!orbit.position?.every(Number.isFinite)||!orbit.target?.every(Number.isFinite))throw Error('This viewer does not expose cameraPosition/cameraTarget for fixed-framing export.');
  orbit.distance=Math.max(23,1.15*Math.hypot(...orbit.position.map((value,index)=>value-orbit.target[index])));
  const captureFrame=async index=>page.evaluate(({index,selected,fixedMaximum,orbit,fullCountTicks})=>{
    if(selected){
      const [px,py,pz]=orbit.position,[tx,ty,tz]=orbit.target,distance=orbit.distance;
      const elevation=Math.PI/5,horizontal=distance*Math.cos(elevation),angle=Math.atan2(px-tx,pz-tz)+2*Math.PI*index/149;
      window.fitExplorer.setState({playing:false,time:5,cameraPosition:[tx+horizontal*Math.sin(angle),ty+distance*Math.sin(elevation),tz+horizontal*Math.cos(angle)],cameraTarget:[tx,ty,tz]});
    }else{
      window.fitExplorer.setTime(index/30);
      const state=window.fitExplorer.getState(),position=state.cameraPosition,target=state.cameraTarget;
      const distance=Math.hypot(...position.map((value,index)=>value-target[index]));
      window.fitExplorer.setState({cameraPosition:position.map((value,index)=>target[index]+(value-target[index])*orbit.distance/distance),cameraTarget:target});
    }
    if(window.fitExplorer.package.display.z_max!==fixedMaximum)throw Error('Full-model 3D maximum changed during capture.');
    const ticks=[...document.querySelectorAll('.count-tick')].map(element=>element.textContent);
    if(JSON.stringify(ticks)!==JSON.stringify(fullCountTicks))throw Error('Full-model 3D count ticks changed during capture.');
    window.fitExplorer.render();
  },{index,selected,fixedMaximum,orbit,fullCountTicks});
  if(await page.evaluate(()=>window.fitExplorer.package.display.z_max)!==fixedMaximum)throw Error('3D maximum changed after component selection.');
  if(selected)await captureFrame(0);
  else{
    await page.evaluate(distance=>{const state=window.fitExplorer.getState(),p=state.cameraPosition,t=state.cameraTarget,r=Math.hypot(...p.map((v,i)=>v-t[i]));window.fitExplorer.setState({cameraPosition:p.map((v,i)=>t[i]+(v-t[i])*distance/r),cameraTarget:t})},orbit.distance);
  }
  await page.screenshot({path:path.join(output,'poster.png'),animations:'disabled'});
  if(!args.includes('--poster-only')){
    const frameDir=path.join(output,'frames');await mkdir(frameDir);
    for(let i=0;i<150;i++){
      await captureFrame(i);
      await page.screenshot({path:path.join(frameDir,'frame-'+String(i).padStart(4,'0')+'.png'),animations:'disabled'});frames++;
      if(i%30===0)console.log('Rendered '+i+'/150 frames');
    }
    const input=['-framerate','30','-i',path.join(frameDir,'frame-%04d.png')];
    await ffmpegRun([...input,'-frames:v','150','-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',path.join(output,'fit-animation.mp4')]);
    await ffmpegRun([...input,'-filter_complex',`[0:v]fps=${gifFps},scale=${gifWidth}:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`,'-loop','0',path.join(output,'fit-animation.gif')]);
  }
  const after=await packageFingerprint();
  if(after!==before)throw Error('Viewer input data changed during export.');
  const state=await page.evaluate(()=>window.fitExplorer.getState());
  const report={schema:'fit-explorer.render',version:1,status:errors.length||externalRequests.length?'FAIL':'PASS',source:'local ROOT viewer',viewport:[1920,1080],fps:30,frames,duration_seconds:frames/30,poster_only:args.includes('--poster-only'),mode:selected?'component-orbit':'additive-timeline',component_orbit:selected?{degrees:360,elevation_degrees:36,camera_distance:orbit.distance,shared_distance_for_components:true,preserve_target:true}:null,camera_distance:orbit.distance,layout:'scene-only',data_overlay:'hidden',selected_components:selected,selected_yields:selectedYields,label:componentLabel,fixed_z_max:fixedMaximum,fixed_count_ticks:fullCountTicks,data_unchanged:true,package_sha256:before,gif:frames?{fps:gifFps,width:gifWidth,duration_seconds:5}:null,new_minimizations:0,backend:'Three.js / Chromium / FFmpeg',browser:browser.version(),errors,external_requests:externalRequests,elapsed_seconds:(Date.now()-started)/1000,final_state:state,outputs:{}};
  for(const name of ['poster.png',...(frames?['fit-animation.mp4','fit-animation.gif']:[])]){const bytes=await readFile(path.join(output,name));report.outputs[name]={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}}
  await writeFile(path.join(output,'render-report.json'),JSON.stringify(report,null,2)+'\n');if(report.status!=='PASS')throw Error('Browser errors during render: '+errors.join('; '));console.log(JSON.stringify({status:'PASS',frames,output,elapsed_seconds:report.elapsed_seconds}));
}finally{await browser.close()}
