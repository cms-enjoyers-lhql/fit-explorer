// Browser-only native ROOT input. RooFit objects stay in the file; the browser
// reads native display histograms and tables without executing custom C++ code.
import { openFile } from 'jsroot/io';

const FORMAT='fit-explorer.root/1',BASE='fit_explorer';
const SAFE_ID=/^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_IDS=new Set(['all','total','__proto__','constructor','prototype']);
const fail=message=>{throw Error(message)};
const numeric=(obj,label)=>{const value=obj?.fVal;if(!Number.isFinite(value))fail('Invalid ROOT value: '+label);return value};
const utf8=value=>{
  // ROOT TString stores UTF-8 bytes; JSROOT's binary reader exposes byte chars.
  if([...value].some(c=>c.charCodeAt(0)>255))return value;
  try{return new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(value,c=>c.charCodeAt(0)))}catch{return value}
};
const text=obj=>utf8(typeof obj?.fTitle==='string'?obj.fTitle:typeof obj?.fString==='string'?obj.fString:'');
const values=(obj,label)=>{
  if(!Array.isArray(obj)&&!ArrayBuffer.isView(obj))fail('Invalid ROOT array: '+label);
  return Array.from(obj);
};
function edges(axis,label){
  const n=axis?.fNbins;
  if(!Number.isInteger(n)||n<1||n>262144)fail('Invalid ROOT axis: '+label);
  const bins=axis.fXbins;
  const out=bins?.length?values(bins,label):Array.from({length:n+1},(_,i)=>axis.fXmin+(axis.fXmax-axis.fXmin)*i/n);
  if(out.length!==n+1||out.some((v,i)=>!Number.isFinite(v)||(i&&v<=out[i-1])))fail('Invalid ROOT bin edges: '+label);
  return out;
}
function histogram2D(obj,label){
  if(!/^TH2/.test(obj?._typename??''))fail('Missing ROOT TH2: '+label);
  const x=edges(obj.fXaxis,label+' x'),y=edges(obj.fYaxis,label+' y'),nx=x.length-1,ny=y.length-1;
  if(nx*ny>8000000)fail('ROOT table is too large: '+label);
  const array=values(obj.fArray,label);
  if(array.length!==(nx+2)*(ny+2))fail('Invalid ROOT TH2 storage: '+label);
  // ROOT's global bin uses x-fast order and includes overflow cells. The
  // renderer uses explicit ix*ny+iy row-major tables without overflow cells.
  const counts=Array.from({length:nx*ny},(_,i)=>array[(Math.floor(i/ny)+1)+(nx+2)*(i%ny+1)]);
  if(counts.some(v=>!Number.isFinite(v)||v<0))fail('Invalid ROOT bin counts: '+label);
  return {counts,x,y,nx,ny};
}
function histogram1D(obj,label){
  if(!/^TH1/.test(obj?._typename??''))fail('Missing ROOT TH1: '+label);
  const n=obj.fXaxis?.fNbins,array=values(obj.fArray,label);
  if(!Number.isInteger(n)||n<1||array.length!==n+2)fail('Invalid ROOT TH1 storage: '+label);
  const result=array.slice(1,n+1);
  if(result.some(v=>!Number.isFinite(v)||v<0))fail('Invalid ROOT count errors: '+label);
  return result;
}
function parameterRows(list){
  if(!list)return [];
  if(list._typename!=='TList'||!Array.isArray(list.arr))fail('Invalid ROOT parameter list.');
  return list.arr.map(row=>{
    if(row._typename!=='TList'||!Array.isArray(row.arr))fail('Invalid ROOT parameter row.');
    const fields=Object.fromEntries(row.arr.map(v=>[v.fName??v.name,v]));
    const name=text(fields.name)||row.name||row.fName;
    if(typeof name!=='string'||!name)fail('ROOT parameter name is missing.');
    const value=numeric(fields.value,name),fixed=numeric(fields.fixed,name+' fixed');
    if(![0,1].includes(fixed))fail('Invalid ROOT fixed flag: '+name);
    const error=fields.error?numeric(fields.error,name+' error'):null;
    if(error!==null&&error<0)fail('Invalid ROOT parameter error: '+name);
    return {name,label:text(fields.label)||name,unit:text(fields.unit),value,error,fixed:Boolean(fixed)};
  });
}
const sameEdges=(a,b)=>a.length===b.length&&a.every((v,i)=>Math.abs(v-b[i])<=1e-12*Math.max(1,Math.abs(v),Math.abs(b[i])));

export async function readRootFile(input){
  const content=input instanceof ArrayBuffer?input:ArrayBuffer.isView(input)?input.buffer.slice(input.byteOffset,input.byteOffset+input.byteLength):await input?.arrayBuffer?.();
  if(!(content instanceof ArrayBuffer)||content.byteLength<4||String.fromCharCode(...new Uint8Array(content,0,4))!=='root')fail('Choose a valid .root file saved with the Data Guide code.');
  if(content.byteLength>256*1024*1024)fail('This ROOT file exceeds the 256 MB viewer limit.');
  const file=await openFile(content);
  const optional=async path=>{try{return await file.readObject(path)}catch(error){if(/Key not found/.test(error.message))return null;throw error}};
  const read=path=>file.readObject(BASE+'/'+path);
  const maybe=path=>optional(BASE+'/'+path);
  const marker=await maybe('format');
  if(!marker)fail('This ROOT file has no Fit Explorer tables. Save it with the Data Guide code.');
  if(text(marker)!==FORMAT)fail('Unsupported Fit Explorer ROOT format. Use the current Data Guide saving code.');
  const observed=histogram2D(await read('observed'),'observed');
  if(observed.nx<2||observed.ny<2||observed.nx*observed.ny>262144)fail('Invalid ROOT display grid dimensions.');
  const axes=await Promise.all(['x','y'].map(async(name,k)=>({name:text(await read(name+'_name')),label:text(await read(name+'_label')),unit:text(await read(name+'_unit')),edges:k?observed.y:observed.x})));
  const orderedIds=async(path,directory)=>{
    if(!directory||!Array.isArray(directory.fKeys))fail('Invalid ROOT component directory: '+path);
    const keys=[...new Map(directory.fKeys.map(key=>[key.fName,key])).values()];
    if(keys.some(key=>!/^TDirectory(?:File)?$/.test(key.fClassName)||!SAFE_ID.test(key.fName)||RESERVED_IDS.has(key.fName)))fail('Invalid ROOT component ID in '+path);
    const entries=await Promise.all(keys.map(async(key,index)=>{const order=await maybe(path+'/'+key.fName+'/order');const value=order?numeric(order,key.fName+' order'):index;if(!Number.isInteger(value)||value<0)fail('Invalid ROOT component order.');return {id:key.fName,order:value,index}}));
    return entries.sort((a,b)=>a.order-b.order||a.index-b.index).map(entry=>entry.id);
  };
  const seen=new Set();let nodeCount=0;
  const component=async(id,path,depth=0)=>{
    if(seen.has(id))fail('ROOT component IDs must be globally unique: '+id);
    if(depth>32||++nodeCount>512)fail('ROOT component tree is too large.');seen.add(id);
    const grid=histogram2D(await read(path+'/expected'),id);
    if(!sameEdges(grid.x,observed.x)||!sameEdges(grid.y,observed.y))fail('ROOT component axes do not match DATA: '+id);
    const value=numeric(await read(path+'/yield'),id+' yield'),error=numeric(await read(path+'/error'),id+' error');
    if(value<0||error<0)fail('Invalid ROOT component yield: '+id);
    const result={id,label:text(await maybe(path+'/label'))||id,description:text(await maybe(path+'/description')),color:text(await maybe(path+'/color')),expected:grid.counts,yield:{value,error},parameters:parameterRows(await maybe(path+'/parameters'))};
    const directory=await maybe(path+'/children');
    if(directory){const ids=await orderedIds(path+'/children',directory);result.children=await Promise.all(ids.map(child=>component(child,path+'/children/'+child,depth+1)))}
    return result;
  };
  const componentKeys=await orderedIds('components',await read('components'));
  if(!componentKeys.length)fail('ROOT model has no components.');
  const components=await Promise.all(componentKeys.map(id=>component(id,'components/'+id)));
  const flatten=items=>items.flatMap(item=>[item.id,...flatten(item.children??[])]),allIds=flatten(components);
  const projectionAxes=[];
  for(let axis=0;axis<2;axis++){
    const path='projections/axis'+axis,graph=await maybe(path+'/points');
    if(!graph){projectionAxes.push(null);continue}
    if(!/^TGraph/.test(graph._typename??'')||!Number.isInteger(graph.fNpoints)||graph.fNpoints<2||graph.fNpoints>100000)fail('Invalid ROOT projection points.');
    const points=values(graph.fX,'projection points').slice(0,graph.fNpoints);
    if(points.length!==graph.fNpoints||points.some((v,i)=>!Number.isFinite(v)||(i&&v<=points[i-1])))fail('Invalid ROOT projection coordinates.');
    const tables={};
    for(const id of allIds){
      const grid=histogram2D(await read(path+'/components/'+id),'projection '+id);
      if(grid.nx!==points.length||!sameEdges(grid.y,axes[1-axis].edges))fail('Invalid ROOT projection table dimensions: '+id);
      tables[id]=grid.counts;
    }
    const width=numeric(await read(path+'/bin_width'),'projection bin width');
    if(width<=0)fail('Invalid ROOT projection bin width.');
    projectionAxes.push({points,other_bins:axes[1-axis].edges.length-1,bin_width:width,components:tables});
  }
  if(projectionAxes.some(Boolean)&&!projectionAxes.every(Boolean))fail('Both ROOT smooth-projection tables are required.');
  const result={schema:'fit-explorer.view',version:1,title:text(await read('title'))||'Fit result',channel:text(await read('channel')),axes,shape:[observed.nx,observed.ny],observed:observed.counts,
    poisson_lookup:{low:histogram1D(await read('poisson_low'),'poisson_low'),high:histogram1D(await read('poisson_high'),'poisson_high')},components,parameters:parameterRows(await maybe('parameters')),fit:{},
    provenance:{baseline_id:text(await maybe('baseline_id')),native_root_input:true,new_minimizations:0},display:{z_max:numeric(await read('z_max'),'count maximum'),normalization:'Expected candidates per 2D bin'}};
  if(projectionAxes.every(Boolean))result.projection_samples={version:1,axes:projectionAxes};
  return result;
}

export function rootBufferFromBase64(encoded){
  const raw=atob(encoded.replace(/\s+/g,'')),bytes=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
  return bytes.buffer;
}

export function downloadExampleRoot(){
  const built=typeof __FIT_ROOT_EXAMPLE__==='string'?__FIT_ROOT_EXAMPLE__:'';
  const encoded=document.getElementById('fit-root-example')?.textContent?.trim()||built;
  if(!encoded)throw Error('The example ROOT file is unavailable. Rebuild the viewer with its example asset.');
  const blob=new Blob([rootBufferFromBase64(encoded)],{type:'application/octet-stream'}),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download='fit-example.root';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
