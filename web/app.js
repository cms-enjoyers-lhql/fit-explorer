import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { countFraction, countTicks, countFloor, formatCountTick } from './count_scale.js';
import { selectionRegion, projectionRecord } from './projections.js';
import { guideHTML, bindGuide } from './guide.js';
import { readRootFile, rootBufferFromBase64 } from './root_io.js';
import { bindRootFileDrop } from './file_drop.js';
import { createDepthLabels } from './axis_labels.js';

const COLORS={total:'#df8b83',fallback:'#79aee6'};
const SURFACE_TOTAL='#bc6552';
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sum=a=>a.reduce((x,y)=>x+y,0);
const fmt=(v,n=1)=>Number(v).toLocaleString('en-US',{maximumFractionDigits:n,minimumFractionDigits:n});
const precise=v=>Number(v).toLocaleString('en-US',{maximumSignificantDigits:6});
const ease=v=>{v=clamp(v,0,1);return v*v*(3-2*v)};
const flatten=a=>Array.isArray(a?.[0])?a.flat():a;
const displayText=(value,fallback='')=>typeof value==='string'&&!/\p{Script=Cyrillic}/u.test(value)?value:fallback;
const packageTitle=pkg=>displayText(pkg.title,'Fit result');
const SAFE_ID=/^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_IDS=new Set(['all','total','__proto__','constructor','prototype']);
const walkComponents=items=>items.flatMap(c=>[c,...walkComponents(c.children??[])]);
const labelFor=c=>displayText(c.label,c.id)||c.id;
const descriptionFor=c=>displayText(c.description,displayText(c.label,c.id));
function componentColor(c){
  if(/^#[0-9a-f]{6}$/i.test(c.color??''))return c.color;
  let hash=2166136261;for(const letter of c.id){hash^=letter.charCodeAt(0);hash=Math.imul(hash,16777619)}
  return '#'+new THREE.Color('hsl('+((hash>>>0)%360)+',58%,67%)').getHexString();
}

export function validatePackage(pkg){
  if(pkg?.schema!=='fit-explorer.view'||pkg.version!==1)throw Error('Invalid Fit Explorer data. Choose a .root file saved with the Data Guide code.');
  const [nx,ny]=pkg.shape??[];
  if(!Number.isInteger(nx)||!Number.isInteger(ny)||nx<2||ny<2||nx*ny>262144)throw Error('Invalid grid dimensions.');
  if(pkg.axes?.length!==2||pkg.axes.some((a,k)=>!Array.isArray(a.edges)||a.edges.length!==pkg.shape[k]+1||a.edges.some((v,i)=>!Number.isFinite(v)||(i&&v<=a.edges[i-1]))))throw Error('Invalid mass axes.');
  const check=(a,label,integer=false)=>{a=flatten(a);if(!Array.isArray(a)||a.length!==nx*ny||a.some(v=>!Number.isFinite(v)||v<0||(integer&&!Number.isSafeInteger(v))))throw Error('Invalid values: '+label);return a};
  const parameters=p=>{if(p!==undefined&&(!Array.isArray(p)||p.some(q=>!Number.isFinite(q.value)||(q.error!==undefined&&q.error!==null&&(!Number.isFinite(q.error)||q.error<0)))))throw Error('Invalid model parameters.')};
  pkg.observed=check(pkg.observed,'DATA',true);const observedTotal=sum(pkg.observed);
  if(!Number.isSafeInteger(observedTotal))throw Error('Invalid DATA total.');
  if(!pkg.poisson_lookup||['low','high'].some(k=>!Array.isArray(pkg.poisson_lookup[k])||pkg.poisson_lookup[k].length<=observedTotal||pkg.poisson_lookup[k].some(v=>!Number.isFinite(v)||v<0)))throw Error('Missing complete Poisson DATA errors.');
  if(!Array.isArray(pkg.components)||!pkg.components.length)throw Error('At least one model component is required.');
  const ids=new Set();let componentCount=0;
  const inspect=(c,depth=0)=>{
    if(!c||typeof c.id!=='string'||!SAFE_ID.test(c.id)||RESERVED_IDS.has(c.id)||ids.has(c.id))throw Error('Component IDs must be unique safe names.');
    if(depth>32||++componentCount>512)throw Error('Model component tree is too large.');ids.add(c.id);
    c.expected=check(c.expected,c.id);
    if(!c.yield||!Number.isFinite(c.yield.value)||c.yield.value<0||!Number.isFinite(c.yield.error)||c.yield.error<0)throw Error('Invalid yield for component '+c.id);
    if(Math.abs(sum(c.expected)-c.yield.value)>1e-6+1e-5*c.yield.value)throw Error('Normalization does not match the yield: '+c.id);parameters(c.parameters);
    if(c.children!==undefined&&!Array.isArray(c.children))throw Error('Invalid component children: '+c.id);
    for(const child of c.children??[])inspect(child,depth+1);
    if(c.children?.length){
      if(c.expected.some((v,i)=>Math.abs(sum(c.children.map(ch=>ch.expected[i]))-v)>1e-6+1e-5*v))throw Error('Child counts do not sum to parent: '+c.id);
      if(Math.abs(sum(c.children.map(ch=>ch.yield.value))-c.yield.value)>1e-6+1e-5*c.yield.value)throw Error('Child yields do not sum to parent: '+c.id);
    }
  };
  pkg.components.forEach(c=>inspect(c));
  parameters(pkg.parameters);
  if(pkg.display?.z_max!==undefined&&(!Number.isFinite(pkg.display.z_max)||pkg.display.z_max<=0))throw Error('Invalid count-axis maximum.');
  if(pkg.projection_samples){
    const sampling=pkg.projection_samples;
    if(sampling.version!==1||sampling.axes?.length!==2)throw Error('Invalid smooth projection samples.');
    sampling.axes.forEach((axis,k)=>{
      if(axis.other_bins!==pkg.shape[1-k]||!Array.isArray(axis.points)||axis.points.length<2||axis.points.some((v,i)=>!Number.isFinite(v)||(i&&v<=axis.points[i-1])))throw Error('Invalid projection grid.');
      for(const c of walkComponents(pkg.components)){
        const values=axis.components?.[c.id];
        if(!Array.isArray(values)||values.length!==axis.points.length*axis.other_bins||values.some(v=>!Number.isFinite(v)||v<0))throw Error('Invalid projection for '+c.id);
      }
      for(const c of walkComponents(pkg.components))if(c.children?.length){const parent=axis.components[c.id];if(parent.some((value,i)=>Math.abs(sum(c.children.map(child=>axis.components[child.id][i]))-value)>1e-6+1e-5*value))throw Error('Child projection curves do not sum to parent: '+c.id)}
    });
  }
  return pkg;
}

export function mount(container,input,options={}){
  const pkg=validatePackage(input);const [nx,ny]=pkg.shape,N=nx*ny;
  const exportMode=options.export??new URLSearchParams(location.search).get('export')==='1';
  const clone=c=>({...c,color:componentColor(c),children:c.children?.map(clone)});
  const components=pkg.components.map(clone),allComponents=walkComponents(components),byId=Object.fromEntries(allComponents.map(c=>[c.id,c]));
  const parentById=new Map(),rootById=new Map();
  const indexTree=(c,parent,top)=>{if(parent)parentById.set(c.id,parent.id);rootById.set(c.id,top.id);for(const child of c.children??[])indexTree(child,c,top)};
  components.forEach(c=>indexTree(c,null,c));
  const descendants=c=>walkComponents(c.children??[]);
  const ancestors=id=>{const result=[];for(let parent=parentById.get(id);parent;parent=parentById.get(parent))result.push(parent);return result};
  const timing=new Map(components.map((c,index)=>[c.id,[.5+3*index/components.length,.5+3*(index+1)/components.length]]));
  const full=Array.from({length:N},(_,i)=>sum(components.map(c=>c.expected[i])));
  const maxValue=1.12*Math.max(1,pkg.observed.reduce((a,b)=>Math.max(a,b),0),full.reduce((a,b)=>Math.max(a,b),0)),zmax=Number(pkg.display?.z_max)||maxValue;
  const initialScale=options.scale??new URLSearchParams(location.search).get('scale')??'linear';
  if(!['linear','log'].includes(initialScale))throw Error('Unknown count scale');
  const requestedMinimum=options.logMinimum??new URLSearchParams(location.search).get('logMin');
  const initialMinimum=countFloor(zmax,requestedMinimum===null||requestedMinimum===undefined?Math.min(.1,zmax/10):Number(requestedMinimum));
  const state={logMinimum:initialMinimum,time:5,playing:false,components:components.map(c=>c.id),data:'solid',scale:initialScale,slice:{axis:null,lo:0,hi:nx},camera:'iso',selected:null,view:options.view??new URLSearchParams(location.search).get('view')??'3d',lightMotion:true};
  let dataScaleDirty=false,previousView='3d';
  let destroyed=false,animation=0,lastTime=null,projectionDirty=true,meshDirty=true,labels=[];
  container.innerHTML=`<main class="fit-app${exportMode?' export-mode':''}">
    <header class="topbar"><div class="heading-group"><button class="button log-toggle" data-scale-toggle aria-label="Logarithmic scale" aria-pressed="false" title="Logarithmic scale">log₁₀</button><div><div class="eyebrow">Fit Explorer</div><div class="title" style="white-space:normal;overflow-wrap:anywhere;max-width:100%">${escape(packageTitle(pkg))}</div><div class="subtitle">${fmt(sum(pkg.observed),0)} candidates</div></div></div><div class="toolbar"><div class="view-switch" role="group" aria-label="View"><button class="button active" data-view="3d">3D</button><button class="button" data-view="projections">Projections</button><button class="button" data-view="guide">Data guide</button></div><button class="button" data-load-fit>Load FIT ↑</button><input id="load-fit" hidden type="file" accept=".root,application/octet-stream"></div></header>
    <div class="layout"><section class="workspace"><div class="scene-wrap"><div class="scene"></div><div class="phase"></div><div class="scale-label"></div><div class="scene-controls"><button class="button" data-camera="iso">Orbit</button><button class="button" data-camera="top">Top</button><button class="button" data-camera="x">Along m₁</button><button class="button" data-camera="y">Along m₂</button><button class="button" data-camera="reset">Reset</button></div></div><div class="charts"><section class="chart" data-axis="0"><div class="chart-title"></div><svg role="img" aria-label="First-mass projection"></svg></section><section class="chart" data-axis="1"><div class="chart-title"></div><svg role="img" aria-label="Second-mass projection"></svg></section></div></section>
    <aside class="sidebar"><div class="section-label" title="Saved fitted yields over the full mass range">Components</div>${components.map(c=>`<article class="component-card" data-card="${escape(c.id)}" style="--component:${c.color??COLORS.fallback}"><div class="component-heading"><label style="min-width:0"><input type="checkbox" data-toggle="${escape(c.id)}" checked><span data-component-label style="overflow-wrap:anywhere;min-width:0">${escape(labelFor(c))}</span></label><button class="solo" data-solo="${escape(c.id)}">solo ↗</button></div><div class="component-description">${escape(descriptionFor(c))}</div><div class="yield" title="Over the full fit range">${fmt(c.yield?.value??sum(c.expected),0)} <span class="error">± ${fmt(c.yield?.error??0,0)}</span></div><div class="component-actions"><button class="link-button" data-details="${escape(c.id)}">Parameters</button>${c.children?.length?`<button class="link-button" data-children="${escape(c.id)}">Inside ${escape(labelFor(c))}</button>`:''}</div><div class="details" data-detail="${escape(c.id)}" hidden></div></article>`).join('')}
    <div class="legend"><span><i style="background:${COLORS.total}"></i>Total</span><span><i class="data-key"></i>DATA</span></div><div class="side-section interactive-only"><label class="field log-minimum-field" title="3D count-axis floor. Counts at or below this value stay at the baseline."><span>3D log minimum</span><input type="number" data-log-minimum data-field="log-minimum" aria-label="3D log minimum" step="any" min="${Number.MIN_VALUE}" max="${zmax}" value="${state.logMinimum}"></label><div class="field-error" data-log-minimum-error role="status" aria-live="polite"></div><div class="field"><span>Data</span><select data-field="data"><option value="wire">Wireframe</option><option value="solid">Columns</option><option value="off">Hide</option></select></div><label class="light-control"><input type="checkbox" data-field="light" checked>Moving light</label><div class="field"><span>Slice</span><select data-field="slice" aria-label="Slice"><option value="none">Full range</option><option value="0">m₁ window</option><option value="1">m₂ window</option><option value="both">m₁ × m₂ region</option></select></div><div class="window-sliders" hidden>${[0,1].map(axis=>`<div class="window-axis" data-window-axis="${axis}"><strong>m${axis===0?'₁':'₂'}${displayText(pkg.axes[axis].unit,'')?' ['+escape(displayText(pkg.axes[axis].unit,''))+']':''}</strong>${['lo','hi'].map(bound=>`<label><span>${bound==='lo'?'From':'To'}</span><input type="range" data-axis="${axis}" data-bound="${bound}" min="${bound==='lo'?0:1}" max="${axis?ny:nx}" value="${bound==='lo'?0:axis?ny:nx}"><input type="number" aria-label="${bound==='lo'?'Lower':'Upper'} bound m${axis+1}" data-mass-axis="${axis}" data-mass-bound="${bound}" step="${pkg.axes[axis].edges[1]-pkg.axes[axis].edges[0]}"></label>`).join('')}</div>`).join('')}</div><div class="window-label"></div><button class="button" data-clear-slice>Reset slice</button><button class="button" data-all>All components</button></div><div class="side-section interactive-only"><button class="link-button" data-details="all">All parameters</button><div class="details" data-detail="all" hidden></div></div></aside></div>
    <section class="guide-panel" hidden aria-label="Data guide"><div class="guide-actions"><button class="button" data-guide-back>← Back to fit</button></div>${guideHTML()}</section>
    <footer class="timeline"><button class="button primary" data-play>▶ Play 5 s</button><input data-time aria-label="Animation time" type="range" min="0" max="5" step="0.01" value="5"><span class="time">5.00 / 5 s</span></footer></main>`;
  const root=container.querySelector('.fit-app'),host=root.querySelector('.scene'),sceneWrap=root.querySelector('.scene-wrap');
  const uiEvents=new AbortController(),uiEventOptions={signal:uiEvents.signal};
  let renderer;
  try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0xffffff,0);renderer.outputColorSpace=THREE.SRGBColorSpace;host.appendChild(renderer.domElement)}catch(error){host.innerHTML='<div class="error-panel">Unable to create the WebGL scene.<br>Enable browser hardware acceleration.</div>';throw error}
  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(35,1,.1,100);const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,1.3,0);controls.enableDamping=true;controls.dampingFactor=.09;controls.minDistance=7;controls.maxDistance=45;controls.maxPolarAngle=Math.PI*.495;
  scene.add(new THREE.HemisphereLight(0xe8eef2,0x343c43,1.1));const light=new THREE.DirectionalLight(0xfff5e9,2.8);light.position.set(8,12,9);scene.add(light);const fill=new THREE.DirectionalLight(0xe2edff,.85);fill.position.set(-9,5,-6);scene.add(fill);const lightStart=performance.now();renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;
  const grid=new THREE.GridHelper(10,10,0x556068,0x333d44);grid.scale.z=.8;scene.add(grid);
  const base=new THREE.Mesh(new THREE.PlaneGeometry(10.4,8.4),new THREE.MeshStandardMaterial({color:0x171d21,roughness:.95,side:THREE.DoubleSide}));base.rotation.x=-Math.PI/2;base.position.y=-.018;scene.add(base);
  const lineMat=new THREE.LineBasicMaterial({color:0x8b979f});const axisGeo=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-5,0,4),new THREE.Vector3(5,0,4),new THREE.Vector3(-5,0,4),new THREE.Vector3(-5,0,-4),new THREE.Vector3(-5,0,4),new THREE.Vector3(-5,6.0,4)]);const axes=new THREE.LineSegments(axisGeo,lineMat);scene.add(axes);
  const world=(i,j,z)=>new THREE.Vector3(-5+(i+.5)*10/nx,countFraction(z,zmax,state.scale,state.logMinimum)*5.6,4-(j+.5)*8/ny);
  function addLabel(text,position,cls='',role=''){const el=document.createElement('span');el.className='axis-label '+cls;el.textContent=text;sceneWrap.appendChild(el);const label={el,position,role,visibility:null};labels.push(label);return label}
  const axisName=k=>{const label=displayText(pkg.axes[k].label,displayText(pkg.axes[k].name,k===0?'m₁':'m₂')),unit=displayText(pkg.axes[k].unit,'');return label+(unit?' ['+unit+']':'')};
  addLabel('m₁ = '+axisName(0),new THREE.Vector3(.5,-.65,5.9),'','mass1-title');addLabel('m₂ = '+axisName(1),new THREE.Vector3(-7.8,-.3,-.25),'','mass2-title');addLabel('Candidates / 2D bin',new THREE.Vector3(-5.1,6.5,4),'','count-title');
  for(let k=0;k<=4;k++){const f=k/4;addLabel((pkg.axes[0].edges[0]+f*(pkg.axes[0].edges[nx]-pkg.axes[0].edges[0])).toFixed(3),new THREE.Vector3(-5+10*f,-.15,4.35),'tick','mass1-tick');if(k>0)addLabel((pkg.axes[1].edges[0]+f*(pkg.axes[1].edges[ny]-pkg.axes[1].edges[0])).toFixed(3),new THREE.Vector3(-5.45,-.1,4-8*f),'tick','mass2-tick')}
  function updateCountLabels(){for(const item of labels.filter(l=>l.el.classList.contains('count-tick')))item.el.remove();labels=labels.filter(l=>!l.el.classList.contains('count-tick'));for(const value of countTicks(zmax,state.scale,4,state.logMinimum)){if(state.scale==='linear'&&value===0)continue;const text=(state.scale==='log'&&value===countFloor(zmax,state.logMinimum)?'≤ ':'')+formatCountTick(value);addLabel(text,new THREE.Vector3(-5.45,countFraction(value,zmax,state.scale,state.logMinimum)*5.6,4.2),'tick count-tick','count-tick')}}
  updateCountLabels();
  const dataPositions=[];const dummy=new THREE.Object3D();const nonzero=pkg.observed.map((v,i)=>[v,i]).filter(([v])=>v>0);
  const barMaterial=new THREE.MeshStandardMaterial({color:0xc9d0d4,transparent:true,opacity:.35,roughness:.85,depthWrite:false});const bars=new THREE.InstancedMesh(new THREE.BoxGeometry(10/nx*.78,1,8/ny*.78),barMaterial,nonzero.length);
  const corners=[[-1,0,-1],[1,0,-1],[1,0,1],[-1,0,1],[-1,1,-1],[1,1,-1],[1,1,1],[-1,1,1]],edges=[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
  for(let b=0;b<nonzero.length;b++){const [v,idx]=nonzero[b],i=Math.floor(idx/ny),j=idx%ny,p=world(i,j,v);dummy.position.set(p.x,p.y/2,p.z);dummy.scale.set(1,p.y,1);dummy.updateMatrix();bars.setMatrixAt(b,dummy.matrix);for(const [a,c]of edges)for(const q of [a,c]){const t=corners[q];dataPositions.push(p.x+t[0]*5/nx*.78,t[1]*p.y,p.z+t[2]*4/ny*.78)}}
  bars.instanceMatrix.needsUpdate=true;scene.add(bars);const wireGeo=new THREE.BufferGeometry();wireGeo.setAttribute('position',new THREE.Float32BufferAttribute(dataPositions,3));const wire=new THREE.LineSegments(wireGeo,new THREE.LineBasicMaterial({color:0xb0bdc7,transparent:true,opacity:.29,depthWrite:false}));scene.add(wire);
  function updateDataScale(){const positions=wireGeo.attributes.position.array;let offset=0;for(let b=0;b<nonzero.length;b++){const [v,idx]=nonzero[b],p=world(Math.floor(idx/ny),idx%ny,v);dummy.position.set(p.x,p.y/2,p.z);dummy.scale.set(1,p.y,1);dummy.updateMatrix();bars.setMatrixAt(b,dummy.matrix);for(const [a,c]of edges)for(const q of [a,c]){positions[offset+1]=corners[q][1]*p.y;offset+=3}}bars.instanceMatrix.needsUpdate=true;wireGeo.attributes.position.needsUpdate=true;dataScaleDirty=false}
  const meshGeo=new THREE.BufferGeometry();const vertices=new Float32Array(N*3);const indices=[];
  for(let i=0;i<nx;i++)for(let j=0;j<ny;j++){const k=i*ny+j,p=world(i,j,0);vertices[k*3]=p.x;vertices[k*3+2]=p.z;if(i<nx-1&&j<ny-1){indices.push(k,k+ny,k+1,k+1,k+ny,k+ny+1)}}
  meshGeo.setAttribute('position',new THREE.BufferAttribute(vertices,3));meshGeo.setIndex(indices);const meshMaterial=new THREE.MeshPhysicalMaterial({color:SURFACE_TOTAL,roughness:.23,metalness:.13,clearcoat:1,clearcoatRoughness:.17,specularIntensity:1.15,transparent:false,opacity:1,depthWrite:true,side:THREE.DoubleSide});const mesh=new THREE.Mesh(meshGeo,meshMaterial);mesh.renderOrder=1;scene.add(mesh);
  const surfaceWire=new THREE.LineSegments(new THREE.WireframeGeometry(meshGeo),new THREE.LineBasicMaterial({color:COLORS.total,transparent:true,opacity:.1,depthWrite:false}));surfaceWire.visible=false;scene.add(surfaceWire);
  const windowMaterial=new THREE.MeshBasicMaterial({color:0xd49a35,transparent:true,opacity:.10,side:THREE.DoubleSide,depthWrite:false});const windowPlane=new THREE.Mesh(new THREE.BoxGeometry(1,6,1),windowMaterial);scene.add(windowPlane);windowPlane.visible=false;const windowEdges=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1,6,1)),new THREE.LineBasicMaterial({color:0xc9a45d,transparent:true,opacity:.45}));scene.add(windowEdges);windowEdges.visible=false;
  const activeWeight=id=>{const t=timing.get(rootById.get(id))??[.5,3.5];return ease((state.time-t[0])/(t[1]-t[0]))};
  function chosen(){return state.components.map(id=>byId[id]).filter(Boolean)}
  function currentValues(){const values=new Float64Array(N);for(const c of chosen()){const w=activeWeight(c.id);for(let i=0;i<N;i++)values[i]+=w*c.expected[i]}return values}
  function updateSurface(){if(dataScaleDirty)updateDataScale();const values=currentValues();for(let i=0;i<N;i++){const height=countFraction(values[i],zmax,state.scale,state.logMinimum)*5.6;vertices[i*3+1]=height}meshGeo.attributes.position.needsUpdate=true;meshGeo.computeVertexNormals();mesh.visible=values.some(v=>v>0);const selected=chosen();let color=selected.length===1?(selected[0].color??COLORS.fallback):SURFACE_TOTAL;if(state.time<3.5&&selected.length>1){const phase=components.find(c=>state.time<timing.get(c.id)[1])??components.at(-1);color=phase.color}meshMaterial.color.set(color);const reveal=ease(state.time/.5);bars.scale.y=reveal;wire.scale.y=reveal;bars.visible=state.data==='solid';wire.visible=state.data==='wire';meshDirty=false}
  const depthLabels=createDepthLabels({THREE,renderer,camera,mesh,axisGeometry:axisGeo,host,exportMode});
  function updateLabels(){depthLabels.update(labels)}
  const charts=[...root.querySelectorAll('.chart')];
  let projectionData=[];
  function drawCharts(){
    const region=selectionRegion(state.slice,pkg.shape),selected=chosen();projectionData=[];
    for(let axis=0;axis<2;axis++){
      const record=projectionRecord(pkg,selected,axis,region,activeWeight);projectionData.push(record);
      const obs=record.observed,comp=record.curves,total=record.total,ex=pkg.axes[axis].edges,n=obs.length;
      const errs=obs.map(v=>[pkg.poisson_lookup.low[v],pkg.poisson_lookup.high[v]]);
      const ymax=1.18*Math.max(1,...obs.map((v,i)=>v+errs[i][1]),...total);
      const W=state.view==='projections'?1000:380,H=state.view==='projections'?330:280,L=54,R=16,T=24,B=44;
      const x=value=>L+(value-ex[0])/(ex[n]-ex[0])*(W-L-R),xx=i=>x((ex[i]+ex[i+1])/2),yy=v=>T+(H-T-B)*(1-countFraction(v,ymax,state.scale));
      const svg=charts[axis].querySelector('svg');let content='';
      for(const value of countTicks(ymax,state.scale,3)){const y=yy(value);content+=`<line x1="${L}" y1="${y}" x2="${W-R}" y2="${y}" stroke="#2a3339"/><text x="${L-7}" y="${y+3}" text-anchor="end" fill="#a9b3ba" font-size="12">${state.scale==='log'&&value===countFloor(ymax)?'≤ ':''}${formatCountTick(value)}</text>`}
      if(state.slice.axis!==null){const [lo,hi]=region[axis],a=x(ex[lo]),b=x(ex[hi]);content+=`<rect x="${a}" y="${T}" width="${b-a}" height="${H-T-B}" fill="#ad956f" opacity=".15"/>`;if(exportMode&&lo>0)content+=`<line x1="${a}" x2="${a}" y1="${T}" y2="${H-B}" stroke="#b7a17e" stroke-dasharray="4 4"/>`;if(exportMode&&hi<n)content+=`<line x1="${b}" x2="${b}" y1="${T}" y2="${H-B}" stroke="#b7a17e" stroke-dasharray="4 4"/>`}
      for(let k=0;k<=4;k++){const f=k/4,v=ex[0]+f*(ex[n]-ex[0]);content+=`<text x="${x(v)}" y="${H-B+16}" text-anchor="middle" fill="#a9b3ba" font-size="12">${v.toFixed(3)}</text>`}
      const path=(points,values)=>points.map((v,i)=>(i?'L':'M')+x(v).toFixed(3)+','+yy(values[i]).toFixed(3)).join(' ');
      for(const c of comp)content+=`<path data-curve="${escape(c.id)}" d="${path(c.points,c.values)}" fill="none" stroke="${c.color??COLORS.fallback}" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round" />`;
      if(record.points.length)content+=`<path data-curve="total" d="${path(record.points,total)}" fill="none" stroke="${COLORS.total}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      for(let i=region[axis][0];i<region[axis][1];i++){const px=xx(i),py=yy(obs[i]);content+=`<line x1="${px}" y1="${yy(obs[i]+errs[i][1])}" x2="${px}" y2="${yy(Math.max(0,obs[i]-errs[i][0]))}" stroke="#b4bec5" stroke-width=".7"/><circle data-bin="${i}" cx="${px}" cy="${py}" r="1.8" fill="#e5eaed"/>`}
      content+=`<text x="${(W+L-R)/2}" y="${H-2}" text-anchor="middle" fill="#c2cbd1" font-size="12">${escape(axisName(axis))}</text><text x="${L}" y="${T-4}" fill="#929fa8" font-size="11">Candidates / bin${state.scale==='log'?' · log₁₀':''}</text>`;
      if(!exportMode){
        const [lo,hi]=region[axis],a=x(ex[lo]),b=x(ex[hi]),middle=T+(H-T-B)/2,hitInside=Math.min(4,(b-a)/3),gripWidth=Math.min(10,(b-a)*.4);
        content+=`<g class="projection-window"><rect data-window-body x="${a}" y="${T}" width="${b-a}" height="${H-T-B}" fill="transparent" pointer-events="all"><title>Drag to move this window</title></rect>`;
        for(const [bound,index,position] of [['lo',lo,a],['hi',hi,b]]){
          content+=`<g class="projection-boundary" data-window-bound="${bound}" role="slider" tabindex="0" aria-label="${bound==='lo'?'Lower':'Upper'} window boundary, m${axis+1}" aria-valuemin="${ex[bound==='lo'?0:lo+1]}" aria-valuemax="${ex[bound==='lo'?hi-1:n]}" aria-valuenow="${ex[index]}" aria-valuetext="${ex[index]}${displayText(pkg.axes[axis].unit,'')?' '+escape(displayText(pkg.axes[axis].unit,'')):''}"><title>Drag to resize; arrow keys move one bin</title><rect class="boundary-hit" x="${bound==='lo'?position-10:position-hitInside}" y="${T}" width="${10+hitInside}" height="${H-T-B}" fill="transparent" pointer-events="all"/><line class="boundary-line" x1="${position}" x2="${position}" y1="${T}" y2="${H-B}"/><rect class="boundary-grip" x="${position-gripWidth/2}" y="${middle-12}" width="${gripWidth}" height="24" rx="3"/><path class="boundary-grip-mark" d="M${position-1.5},${middle-5}v10 M${position+1.5},${middle-5}v10"/></g>`;
        }
        content+='</g>';
      }
      svg.setAttribute('viewBox',`0 0 ${W} ${H}`);svg.innerHTML=content;svg.dataset.curveSource=record.source;
      record.plot={width:W,height:H,left:L,right:R,top:T,bottom:B,ymax};
      charts[axis].querySelector('.chart-title').textContent=(state.slice.axis===null?'m'+(axis+1):'Slice · m'+(axis+1))+' · '+fmt(record.observed_total,0)+' candidates';
    }
    projectionDirty=false;
  }
  function paramsHTML(parameters){return parameters.length?parameters.map(p=>{const unit=displayText(p.unit,'');return `<div class="parameter"><span>${escape(displayText(p.label,displayText(p.name,'parameter')))}<br><em>${p.fixed?'fixed':'free'}${unit?' · '+escape(unit):''}</em></span><span class="parameter-value">${precise(p.value)}${!p.fixed&&Number.isFinite(p.error)?'<br>± '+precise(p.error):''}</span></div>`}).join(''):'<span style="color:#8a96a7">No separate parameters.</span>'}
  const expandedChildren=new Set(),detailTargets=new Map(components.map(c=>[c.id,c.id]));
  function childrenHTML(c,depth=0){return (c.children??[]).map(child=>`<div class="child-row" data-child="${child.id}" style="margin-left:${Math.min(depth+1,6)*8}px;flex-wrap:wrap"><label style="flex:1 1 100%;display:flex;align-items:center;gap:6px;min-width:0;overflow-wrap:anywhere"><input type="checkbox" data-toggle="${child.id}" style="accent-color:${child.color};width:12px;height:12px;flex:none"><strong style="color:${child.color}">${escape(labelFor(child))}</strong></label><span>${fmt(child.yield.value,1)}</span><button class="button" data-solo="${child.id}" aria-label="Show only ${escape(labelFor(child))}">solo ↗</button><button class="button" data-node-details="${child.id}">Parameters</button>${child.children?.length?`<button class="button" data-children="${child.id}">Inside ${escape(labelFor(child))}</button>`:''}</div>${expandedChildren.has(child.id)?childrenHTML(child,depth+1):''}`).join('')}
  function renderDetails(c){const detail=root.querySelector(`[data-detail="${c.id}"]`),shown=byId[detailTargets.get(c.id)]??c;detail.innerHTML=paramsHTML(shown.parameters??[])+(expandedChildren.has(c.id)?childrenHTML(c):'')}
  for(const c of components)renderDetails(c);
  root.querySelector('[data-detail="all"]').innerHTML=paramsHTML(pkg.parameters??[]);
  function updateWindow(){
    const region=selectionRegion(state.slice,pkg.shape),axis=state.slice.axis,active=axis!==null;
    if(axis===0||axis===1){state.slice.lo=region[axis][0];state.slice.hi=region[axis][1]}
    if(axis==='both'){[state.slice.xlo,state.slice.xhi]=region[0];[state.slice.ylo,state.slice.yhi]=region[1]}
    windowPlane.visible=windowEdges.visible=active;root.querySelector('.window-sliders').hidden=!active;
    for(let k=0;k<2;k++){
      const row=root.querySelector(`[data-window-axis="${k}"]`);row.hidden=!active||(axis!=='both'&&axis!==k);
      for(const bound of ['lo','hi']){
        const i=bound==='lo'?0:1,slider=row.querySelector(`[data-bound="${bound}"]`),number=row.querySelector(`[data-mass-bound="${bound}"]`);
        slider.max=String(bound==='lo'?pkg.shape[k]-1:pkg.shape[k]);slider.value=String(region[k][i]);number.value=pkg.axes[k].edges[region[k][i]].toFixed(5);number.min=pkg.axes[k].edges[0];number.max=pkg.axes[k].edges.at(-1);
      }
    }
    root.querySelector('[data-clear-slice]').hidden=!active;
    root.querySelector('.window-label').textContent=active?region.map(([lo,hi],k)=>`${pkg.axes[k].edges[lo].toFixed(4)} ≤ m${k+1} ${hi===pkg.shape[k]?'≤':'<'} ${pkg.axes[k].edges[hi].toFixed(4)}`).join(' · '):'';
    const [[xl,xh],[yl,yh]]=region,scale=[10*(xh-xl)/nx,1,8*(yh-yl)/ny],pos=[-5+5*(xl+xh)/nx,3,4-4*(yl+yh)/ny];windowPlane.scale.set(...scale);windowEdges.scale.set(...scale);windowPlane.position.set(...pos);windowEdges.position.set(...pos);
  }
  function ui(){
    root.classList.toggle('projection-view',state.view==='projections');
    root.classList.toggle('guide-view',state.view==='guide');
    root.querySelector('.guide-panel').hidden=state.view!=='guide';
    const minimumField=root.querySelector('[data-log-minimum]');minimumField.value=String(state.logMinimum);minimumField.disabled=state.scale!=='log';
    for(const button of root.querySelectorAll('[data-view]')){const active=button.dataset.view===state.view;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active))}
    root.querySelector('[data-field="light"]').checked=state.lightMotion;
    const logButton=root.querySelector("[data-scale-toggle]");logButton.classList.toggle("active",state.scale==="log");logButton.setAttribute("aria-pressed",String(state.scale==="log"));logButton.title=state.scale==="log"?"Switch to linear scale":"Switch to logarithmic scale";
    root.querySelector('.scale-label').textContent=state.scale==='log'?'log₁₀ · N ≤ '+formatCountTick(countFloor(zmax,state.logMinimum))+' at baseline':'Linear scale';
    root.querySelector('[data-time]').value=String(state.time);root.querySelector('.time').textContent=state.time.toFixed(2)+' / 5 s';root.querySelector('[data-play]').textContent=state.playing?'Ⅱ Pause':'▶ Play 5 s';
    root.querySelector('[data-field="data"]').value=state.data;root.querySelector('[data-field="slice"]').value=state.slice.axis===null?'none':String(state.slice.axis);
    const selectedSet=new Set(state.components);
    const covered=c=>selectedSet.has(c.id)||Boolean(c.children?.length&&c.children.every(covered));
    for(const c of components){
      const selected=state.components.map(id=>byId[id]).filter(node=>rootById.get(node.id)===c.id),active=selected.length>0,shown=selected.length===1?selected[0]:c;
      const card=root.querySelector(`[data-card="${c.id}"]`),signature=selected.map(node=>node.id).join('|');
      card.style.opacity=active?String(.3+.7*activeWeight(c.id)):'.35';
      if(card.dataset.shown!==signature){
        card.dataset.shown=signature;card.style.setProperty('--component',selected.length===1?shown.color:c.color);
        card.querySelector('[data-component-label]').textContent=selected.length>1?selected.map(labelFor).join(' + '):labelFor(shown);
        card.querySelector('.component-description').textContent=selected.length>1?'Selection inside '+labelFor(c):descriptionFor(shown);
        const amount=selected.length>1?sum(selected.map(node=>node.yield.value)):shown.yield.value;
        const error=selected.length>1?undefined:shown.yield.error;
        card.querySelector('.yield').innerHTML=fmt(amount,0)+(Number.isFinite(error)?' <span class="error">± '+fmt(error,0)+'</span>':'');
        detailTargets.set(c.id,shown.id);renderDetails(c);
        if(selected.length===1&&shown.id!==c.id)card.querySelector('.details').hidden=false;
      }
    }
    for(const input of root.querySelectorAll('[data-toggle]')){const c=byId[input.dataset.toggle],selectedBelow=state.components.some(id=>id===c.id||ancestors(id).includes(c.id)),selectedAbove=ancestors(c.id).some(id=>selectedSet.has(id));input.checked=covered(c)||selectedAbove;input.indeterminate=selectedBelow&&!covered(c)&&!selectedAbove}
    const exactFull=components.every(covered),visible=state.components.filter(id=>activeWeight(id)>0);
    root.querySelector('.phase').textContent=state.time<.5?'DATA':state.components.length===0?'No components selected':state.time<3.5?(visible.map(id=>labelFor(byId[id])).join(' + ')||'DATA'):exactFull?'Full model':state.components.map(id=>labelFor(byId[id])).join(' + ');
  }
  function setCamera(mode,animated=false){state.camera=mode;if(mode==='top')camera.position.set(.01,22,.01);else if(mode==='x')camera.position.set(20,5,.01);else if(mode==='y')camera.position.set(.01,5,22);else{const angle=.70+(animated ? .32*ease(state.time/3.5) : 0),radius=17;camera.position.set(radius*Math.sin(angle),10.0,radius*Math.cos(angle))}controls.target.set(0,1.3,0);controls.update()}
  function setTime(value,{orbit=true}={}){state.time=clamp(Number(value),0,5);meshDirty=projectionDirty=true;if(orbit)setCamera('iso',true);ui();render();return api}
  function render(){if(destroyed||state.view==='guide')return;if(meshDirty)updateSurface();if(projectionDirty)drawCharts();controls.update();const phase=state.lightMotion?(exportMode||state.playing?state.time*.8:(performance.now()-lightStart)/2800):0;const front=camera.position.clone().sub(controls.target).normalize(),right=new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion);light.position.copy(controls.target).addScaledVector(front,12).addScaledVector(right,7+Math.sin(phase)*1.7).add(new THREE.Vector3(0,10+Math.cos(phase)*.7,0));light.target.position.copy(controls.target);light.target.updateMatrixWorld();updateLabels();renderer.autoClear=true;renderer.render(scene,camera);depthLabels.render()}
  function getState(){return JSON.parse(JSON.stringify({...state,cameraPosition:camera.position.toArray(),cameraTarget:controls.target.toArray()}))}
  function setState(next={}){
    // Validate the requested floor before changing any state, including other fields.
    const minimum=next.logMinimum===undefined?state.logMinimum:countFloor(zmax,next.logMinimum);
    if(next.scale!==undefined&& !['linear','log'].includes(next.scale))throw Error('Unknown count scale');
    if(next.logMinimum!==undefined&&minimum!==state.logMinimum){state.logMinimum=minimum;dataScaleDirty=true;updateCountLabels()}
    if(next.scale!==undefined){if(!['linear','log'].includes(next.scale))throw Error('Unknown count scale');if(next.scale!==state.scale){state.scale=next.scale;dataScaleDirty=true;updateCountLabels()}}
    if(next.components){if(!Array.isArray(next.components)||next.components.some(id=>!Object.hasOwn(byId,id)))throw Error('Unknown component');const ids=[...new Set(next.components)];if(ids.some(id=>ancestors(id).some(parent=>ids.includes(parent))))throw Error('A component and its descendants cannot be added together');state.components=ids}
    if(next.data){if(!['wire','solid','off'].includes(next.data))throw Error('Unknown DATA mode');state.data=next.data}
    if(next.slice){const slice={...state.slice,...next.slice};if(![null,0,1,'both'].includes(slice.axis))throw Error('Unknown slicing axis');for(const key of ['lo','hi','xlo','xhi','ylo','yhi'])if(slice[key]!==undefined&&!Number.isFinite(slice[key]))throw Error('Invalid slice boundary');state.slice=slice;updateWindow()}
    if(next.view!==undefined){if(!['3d','projections','guide'].includes(next.view))throw Error('Unknown view');if(next.view==='guide'&&state.view!=='guide')previousView=state.view;state.view=next.view}
    if(next.lightMotion!==undefined)state.lightMotion=Boolean(next.lightMotion);
    if(next.camera)setCamera(next.camera);if(next.cameraPosition){camera.position.fromArray(next.cameraPosition);if(next.cameraTarget)controls.target.fromArray(next.cameraTarget);controls.update()}
    if(next.playing!==undefined){state.playing=Boolean(next.playing);lastTime=null}if(next.time!==undefined)state.time=clamp(Number(next.time),0,5);
    meshDirty=projectionDirty=true;ui();resize();render();return api;
  }
  function resize(){const box=host.getBoundingClientRect();if(box.width&&box.height){renderer.setSize(box.width,box.height,false);camera.aspect=box.width/box.height;const framingAspect=box.width<500?1.9:1.5;camera.fov=THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(17.5))*Math.max(1,framingAspect/camera.aspect)));camera.updateProjectionMatrix();render()}}
  const ro=new ResizeObserver(resize);ro.observe(host);
  const click=e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.hasAttribute("data-scale-toggle"))setState({scale:state.scale==="linear"?"log":"linear"});
    if(b.dataset.view)setState({view:b.dataset.view});
    if(b.hasAttribute('data-guide-back'))setState({view:previousView});
    if(b.hasAttribute('data-load-fit'))root.querySelector('#load-fit').click();
    if(b.dataset.camera){state.playing=false;setCamera(b.dataset.camera);ui();render()}
    if(b.hasAttribute('data-play')){if(!state.playing&&state.time>=5)setTime(0);state.playing=!state.playing;lastTime=null;ui()}
    if(b.dataset.solo)setState({components:[b.dataset.solo],playing:false,time:5});
    if(b.hasAttribute('data-all'))setState({components:components.map(c=>c.id),time:5});
    if(b.hasAttribute('data-clear-slice'))setState({slice:{axis:null}});
    if(b.dataset.details){const d=root.querySelector(`[data-detail="${b.dataset.details}"]`);d.hidden=!d.hidden}
    if(b.dataset.nodeDetails){const node=byId[b.dataset.nodeDetails],top=byId[rootById.get(node.id)];detailTargets.set(top.id,node.id);renderDetails(top);root.querySelector(`[data-detail="${top.id}"]`).hidden=false;ui()}
    if(b.dataset.children){const c=byId[b.dataset.children],top=byId[rootById.get(c.id)];if(expandedChildren.has(c.id))expandedChildren.delete(c.id);else expandedChildren.add(c.id);detailTargets.set(top.id,c.id);renderDetails(top);root.querySelector(`[data-detail="${top.id}"]`).hidden=false;ui()}

  };
  function setWindowRange(axis,range,region=selectionRegion(state.slice,pkg.shape),extra={}){
    region=region.map(r=>[...r]);region[axis]=range;
    const active=region.map(([lo,hi],k)=>lo!==0||hi!==pkg.shape[k]);
    const slice=active.every(Boolean)?{axis:'both',xlo:region[0][0],xhi:region[0][1],ylo:region[1][0],yhi:region[1][1]}:active[0]?{axis:0,lo:region[0][0],hi:region[0][1]}:active[1]?{axis:1,lo:region[1][0],hi:region[1][1]}:{axis:null};
    setState({slice,...extra});
  }
  function changeWindow(axis,bound,index){
    const region=selectionRegion(state.slice,pkg.shape),range=[...region[axis]],n=pkg.shape[axis];
    if(bound==='lo')range[0]=clamp(index,0,range[1]-1);else range[1]=clamp(index,range[0]+1,n);
    setWindowRange(axis,range,region,{playing:false,time:5});
  }
  const inputEvent=e=>{const el=e.target;if(el.hasAttribute('data-time')){state.playing=false;setTime(Number(el.value))}if(el.dataset.bound)changeWindow(Number(el.dataset.axis),el.dataset.bound,Number(el.value))};
  const change=e=>{
    const el=e.target;
    if(el.hasAttribute('data-log-minimum')){const error=root.querySelector('[data-log-minimum-error]');try{setState({logMinimum:Number(el.value)});error.textContent='';el.removeAttribute('aria-invalid')}catch{el.value=String(state.logMinimum);el.setAttribute('aria-invalid','true');error.textContent='Enter a number above 0 and below '+formatCountTick(zmax)+'.'}return}
    if(el.dataset.toggle){
      const c=byId[el.dataset.toggle],below=new Set([c.id,...descendants(c).map(node=>node.id)]);let selected=state.components.filter(id=>!below.has(id));
      if(el.checked){const above=new Set(ancestors(c.id));selected=selected.filter(id=>!above.has(id));selected.push(c.id)}
      else {
        // Removing one descendant of a selected parent keeps the disjoint
        // sibling branches, so toggles never double count or erase other parts.
        const expand=(node,removed)=>node.id===removed.id?[]:ancestors(removed.id).includes(node.id)?(node.children??[]).flatMap(child=>expand(child,removed)):[node.id];
        selected=selected.flatMap(id=>ancestors(c.id).includes(id)?expand(byId[id],c):[id]);
      }
      setState({components:selected,playing:false,time:5});
    }
    if(el.dataset.field==='data')setState({data:el.value});if(el.dataset.field==='light')setState({lightMotion:el.checked});
    if(el.dataset.field==='slice'){
      if(el.value==='none')setState({slice:{axis:null}});
      else if(el.value==='both')setState({slice:{axis:'both',xlo:Math.floor(nx*.35),xhi:Math.ceil(nx*.65),ylo:Math.floor(ny*.35),yhi:Math.ceil(ny*.65)}});
      else{const axis=Number(el.value),n=pkg.shape[axis];setState({slice:{axis,lo:Math.floor(n*.35),hi:Math.ceil(n*.65)}})}
    }
    if(el.dataset.massBound){const axis=Number(el.dataset.massAxis),value=Number(el.value);if(Number.isFinite(value)){const edges=pkg.axes[axis].edges;let index=0;for(let i=1;i<edges.length;i++)if(Math.abs(edges[i]-value)<Math.abs(edges[index]-value))index=i;changeWindow(axis,el.dataset.massBound,index)}}
    if(el.id==='load-fit'&&el.files?.[0])loadFile(el.files[0],container);
  };
  for(let axis=0;axis<2;axis++){
    const svg=charts[axis].querySelector('svg'),edges=pkg.axes[axis].edges,n=pkg.shape[axis];let drag=null;
    const pointer=e=>{
      const p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;
      const point=p.matrixTransform(svg.getScreenCTM().inverse()),plot=projectionData[axis].plot;
      const mass=edges[0]+(point.x-plot.left)/(plot.width-plot.left-plot.right)*(edges[n]-edges[0]);
      let bin=0;while(bin<n-1&&edges[bin+1]<=mass)bin++;
      const index=clamp(bin+(mass-edges[bin])/(edges[bin+1]-edges[bin]),0,n);
      return {index,inside:point.x>=plot.left&&point.x<=plot.width-plot.right&&point.y>=plot.top&&point.y<=plot.height-plot.bottom};
    };
    const move=e=>{
      if(!drag||e.pointerId!==drag.pointerId)return;
      const current=pointer(e).index,[lo,hi]=drag.region[axis];let range;
      if(drag.mode==='lo')range=[clamp(Math.round(current),0,hi-1),hi];
      else if(drag.mode==='hi')range=[lo,clamp(Math.round(current),lo+1,n)];
      else if(drag.mode==='move'){const delta=clamp(Math.round(current-drag.start),-lo,n-hi);range=[lo+delta,hi+delta]}
      else {const first=clamp(Math.floor(drag.start),0,n-1),last=clamp(Math.floor(current),0,n-1);range=[Math.min(first,last),Math.max(first,last)+1]}
      setWindowRange(axis,range,drag.region,{playing:false,time:5});
    };
    svg.addEventListener('pointerdown',e=>{
      if(exportMode||e.button!==0||drag)return;
      const point=pointer(e),bound=e.target.closest('[data-window-bound]')?.dataset.windowBound;
      if(!point.inside&&!bound)return;
      const region=selectionRegion(state.slice,pkg.shape),body=e.target.closest('[data-window-body]');
      drag={pointerId:e.pointerId,start:point.index,region,mode:bound??(body?'move':'select')};
      svg.dataset.dragging=drag.mode==='lo'||drag.mode==='hi'?'resize':'move';svg.setPointerCapture(e.pointerId);e.preventDefault();
    },uiEventOptions);
    svg.addEventListener('pointermove',move,uiEventOptions);
    const finish=e=>{if(!drag||e.pointerId!==drag.pointerId)return;if(e.type==='pointerup')move(e);drag=null;delete svg.dataset.dragging;if(svg.hasPointerCapture(e.pointerId))svg.releasePointerCapture(e.pointerId)};
    svg.addEventListener('pointerup',finish,uiEventOptions);svg.addEventListener('pointercancel',finish,uiEventOptions);svg.addEventListener('lostpointercapture',finish,uiEventOptions);
    svg.addEventListener('keydown',e=>{
      const target=e.target.closest('[data-window-bound]');if(!target||!['ArrowLeft','ArrowRight','ArrowDown','ArrowUp','Home','End'].includes(e.key))return;
      e.preventDefault();const bound=target.dataset.windowBound,range=selectionRegion(state.slice,pkg.shape)[axis],index=range[bound==='lo'?0:1],step=e.shiftKey?5:1;
      changeWindow(axis,bound,e.key==='Home'?0:e.key==='End'?n:index+(['ArrowLeft','ArrowDown'].includes(e.key)?-step:step));
      // Redrawing the SVG replaces its children; keep keyboard focus on this handle.
      svg.querySelector(`[data-window-bound="${bound}"]`)?.focus();
    },uiEventOptions);
  }
  root.addEventListener('click',click,uiEventOptions);root.addEventListener('input',inputEvent,uiEventOptions);root.addEventListener('change',change,uiEventOptions);const controlsStart=()=>{state.playing=false;ui()};controls.addEventListener('start',controlsStart);
  function tick(now){if(destroyed)return;if(state.playing&&state.view!=='guide'){const dt=lastTime===null?0:Math.min((now-lastTime)/1000,.1);state.time=clamp(state.time+dt,0,5);if(state.time>=5)state.playing=false;setCamera('iso',true);meshDirty=projectionDirty=true;ui()}lastTime=now;render();animation=requestAnimationFrame(tick)}
  const unbindGuide=bindGuide(root.querySelector('.guide-panel'),{onChooseFile:()=>root.querySelector('#load-fit').click()});
  function disposePhysicalLookup(){
    // Three r182 shares DFG_LUT across physical materials, but renderer.dispose()
    // leaves its per-context texture listeners alive. Dispose that exact lookup
    // before the material properties disappear; another viewer reuploads it.
    const lookup=renderer.properties.get(meshMaterial).uniforms?.dfgLUT?.value??renderer.properties.get(base.material).uniforms?.dfgLUT?.value;
    lookup?.dispose();
  }
  const api={getState,setState,setTime,render,getProjectionData:()=>projectionData,getLabelVisibility:options=>depthLabels.diagnostics(labels,options),measureLabelDepth:options=>depthLabels.measureLabelDepth(labels,options),package:pkg,dispose(){if(destroyed)return;destroyed=true;uiEvents.abort();unbindGuide();cancelAnimationFrame(animation);ro.disconnect();controls.removeEventListener('start',controlsStart);controls.dispose();depthLabels.dispose();disposePhysicalLookup();scene.traverse(obj=>{obj.geometry?.dispose();if(Array.isArray(obj.material))obj.material.forEach(m=>m.dispose());else obj.material?.dispose()});renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();container.replaceChildren()}};
  if(!['3d','projections','guide'].includes(state.view))throw Error('Unknown view');setCamera('iso',true);updateWindow();ui();resize();animation=requestAnimationFrame(tick);return api;
}

const pendingLoads=new WeakMap();
function startLoad(container){const token={};pendingLoads.set(container,token);container.removeAttribute('aria-busy');return token}
function rejectLoad(container,error,token){if(pendingLoads.get(container)!==token)return;pendingLoads.delete(container);container.removeAttribute('aria-busy');showLoadError(container,error)}
async function loadFile(file,container,request){
  const token=request??startLoad(container);if(pendingLoads.get(container)!==token)return;container.setAttribute('aria-busy','true');
  try{
    if(!/\.root$/i.test(file.name??''))throw Error('Choose a .root file saved with the Data Guide code.');
    const pkg=validatePackage(await readRootFile(file));
    if(pendingLoads.get(container)!==token)return;
    window.fitExplorer?.dispose();window.fitExplorer=mount(container,pkg);window.fitExplorerReady=Promise.resolve(window.fitExplorer);
  }catch(error){if(pendingLoads.get(container)===token)showLoadError(container,error)}
  finally{if(pendingLoads.get(container)===token){pendingLoads.delete(container);container.removeAttribute('aria-busy')}}
}
function showLoadError(container,error){
  if(!container.querySelector('.load-card,.fit-app'))showEmptyLoader(container);
  const card=container.querySelector('.load-card');
  if(card){let el=card.querySelector('.load-error');if(!el){el=document.createElement('div');el.className='load-error';card.appendChild(el)}el.textContent=(displayText(String(error.message??error),'Unable to load this ROOT file.'));return}
  container.querySelector('.error-panel')?.remove();const panel=document.createElement('div');panel.className='error-panel';panel.style.position='fixed';panel.style.inset='25%';const text=document.createElement('p');text.textContent=(displayText(String(error.message??error),'Unable to load this ROOT file.'));const dismiss=document.createElement('button');dismiss.className='button';dismiss.textContent='Close';dismiss.setAttribute('aria-label','Close');dismiss.onclick=()=>panel.remove();panel.append(text,dismiss);container.appendChild(panel);
}

function showEmptyLoader(container,guide=false){
  container.innerHTML=guide?`<main class="fit-app guide-view empty-guide"><header class="topbar"><div class="eyebrow">Fit Explorer</div><div class="toolbar"><button class="button" data-guide-back>← Back</button><button class="button" data-choose-file>Choose ROOT</button></div></header><section class="guide-panel" aria-label="Data guide">${guideHTML()}</section><input id="open-package" type="file" hidden accept=".root,application/octet-stream"></main>`:'<div class="load-screen"><section class="load-card"><div class="eyebrow">Fit Explorer</div><h1>Open a fit</h1><p class="file-drop-hint">Choose a file or drop a ROOT file here.</p><div class="load-actions"><button class="button primary" data-choose-file>Choose ROOT</button><button class="button" data-open-guide>Data guide</button></div><input id="open-package" type="file" hidden accept=".root,application/octet-stream"><div class="load-error"></div></section></div>';
  const picker=container.querySelector('#open-package');
  picker.addEventListener('change',e=>{if(e.target.files?.[0])loadFile(e.target.files[0],container)});
  container.querySelector('[data-choose-file]').addEventListener('click',()=>picker.click());
  container.querySelector('[data-open-guide]')?.addEventListener('click',()=>showEmptyLoader(container,true));
  container.querySelector('[data-guide-back]')?.addEventListener('click',()=>showEmptyLoader(container));
  if(guide)bindGuide(container.querySelector('.guide-panel'),{onChooseFile:()=>picker.click()});
}
async function bootstrap(){
  const container=document.getElementById('app');if(!container)return null;
  bindRootFileDrop({onStart:()=>startLoad(container),onFile:(file,token)=>loadFile(file,container,token),onError:(error,token)=>rejectLoad(container,error,token),enabled:()=>new URLSearchParams(location.search).get('export')!=='1'&&!document.querySelector('.export-mode')});
  const token=startLoad(container);
  try{
    const native=document.getElementById('fit-root'),url=new URLSearchParams(location.search).get('root');let pkg;
    if(native)pkg=await readRootFile(rootBufferFromBase64(native.textContent));
    else if(url){const response=await fetch(url);if(!response.ok)throw Error('Unable to load ROOT file: HTTP '+response.status);pkg=await readRootFile(await response.arrayBuffer())}
    if(pendingLoads.get(container)!==token)return window.fitExplorer??null;
    pendingLoads.delete(container);
    if(pkg){window.fitExplorer=mount(container,pkg);return window.fitExplorer}
    showEmptyLoader(container);return null;
  }catch(error){if(pendingLoads.get(container)!==token)return window.fitExplorer??null;pendingLoads.delete(container);showEmptyLoader(container);showLoadError(container,error);throw error}
}
if(typeof window!=='undefined'){window.FitExplorer={mount,validatePackage,readRootFile};window.fitExplorerReady=bootstrap();window.fitExplorerReady.catch(error=>console.error(error))}
