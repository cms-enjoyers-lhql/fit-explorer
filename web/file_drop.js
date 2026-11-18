// Document-level ROOT file drops survive viewer remounts and guide transitions.
const bindings=new WeakMap();
const fileDrag=transfer=>{
  if(!transfer)return false;
  return Array.from(transfer.types??[]).some(type=>String(type).toLowerCase()==='files'||type==='application/x-moz-file')||
    Array.from(transfer.items??[]).some(item=>item.kind==='file')||Boolean(transfer.files?.length);
};

async function droppedFile(transfer){
  // Capture protected drag data synchronously, before awaiting a filesystem handle.
  const items=Array.from(transfer?.items??[]).filter(item=>item.kind==='file');
  const files=Array.from(transfer?.files??[]);
  if(items.length>1||files.length>1)throw Error('Drop one ROOT file at a time.');
  const entries=items.map(item=>{try{return typeof item.webkitGetAsEntry==='function'?item.webkitGetAsEntry():null}catch{return null}});
  if(entries.some(entry=>entry?.isDirectory))throw Error('Folders cannot be opened. Drop one .root file.');
  const fallback=items[0]?.getAsFile?.();
  const handles=items.map(item=>{try{return typeof item.getAsFileSystemHandle==='function'?item.getAsFileSystemHandle():null}catch{return null}});
  for(const handle of handles){
    let value;try{value=await handle}catch{value=null}
    if(value?.kind==='directory')throw Error('Folders cannot be opened. Drop one .root file.');
  }
  const file=files[0]??fallback;
  if(!file)throw Error('No file found. Drop one .root file.');
  return file;
}

export function bindRootFileDrop({document:doc=globalThis.document,onStart=()=>undefined,onFile,onError,enabled=()=>true}={}){
  if(!doc||typeof onFile!=='function'||typeof onError!=='function')throw TypeError('A document, onFile and onError are required.');
  bindings.get(doc)?.();
  const controller=new AbortController(),options={capture:true,signal:controller.signal};
  const win=doc.defaultView,overlay=doc.createElement('div');
  overlay.className='file-drop-overlay';overlay.dataset.fileDropOverlay='';overlay.hidden=true;overlay.setAttribute('role','status');overlay.setAttribute('aria-live','polite');
  overlay.innerHTML='<div class="file-drop-card"><span class="file-drop-arrow" aria-hidden="true">↓</span><strong>Drop ROOT file to open</strong><span>One .root file · stays on this computer</span></div>';
  (doc.body??doc.documentElement).appendChild(overlay);
  let depth=0,sequence=0,dismissed=false;
  const clear=()=>{depth=0;overlay.hidden=true};
  const show=()=>{if(!dismissed&&enabled())overlay.hidden=false};
  doc.addEventListener('dragenter',event=>{
    if(!fileDrag(event.dataTransfer))return;
    event.preventDefault();if(depth===0)dismissed=false;depth++;show();
  },options);
  doc.addEventListener('dragover',event=>{
    if(!fileDrag(event.dataTransfer))return;
    event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect=enabled()?'copy':'none';show();
  },options);
  doc.addEventListener('dragleave',event=>{
    if(!depth&&overlay.hidden)return;
    if(depth<=1&&(event.target===doc||event.target===doc.documentElement||event.target===doc.body)&&!event.relatedTarget){clear();return}
    if(event.clientX<0||event.clientY<0||event.clientX>win.innerWidth||event.clientY>win.innerHeight){clear();return}
    depth=Math.max(0,depth-1);if(!depth)clear();
  },options);
  doc.addEventListener('drop',async event=>{
    if(!fileDrag(event.dataTransfer)){clear();return}
    event.preventDefault();event.stopPropagation();clear();dismissed=false;
    if(!enabled())return;
    const current=++sequence,request=onStart();
    try{const file=await droppedFile(event.dataTransfer);if(current===sequence)await onFile(file,request)}
    catch(error){if(current===sequence)onError(error,request)}
  },options);
  doc.addEventListener('dragend',clear,options);
  doc.addEventListener('keydown',event=>{if(event.key==='Escape'){clear();dismissed=true}},options);
  doc.addEventListener('visibilitychange',()=>{if(doc.hidden)clear()},options);
  win.addEventListener('blur',clear,{signal:controller.signal});
  const cleanup=()=>{sequence++;controller.abort();overlay.remove();if(bindings.get(doc)===cleanup)bindings.delete(doc)};
  bindings.set(doc,cleanup);return cleanup;
}
