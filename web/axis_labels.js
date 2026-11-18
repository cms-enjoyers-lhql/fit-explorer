// Camera-facing glyphs use the fitted surface's depth, independently of decoration.
export function createDepthLabels({THREE,renderer,camera,mesh,axisGeometry,host,exportMode}){
  const scene=new THREE.Scene(),depthScene=new THREE.Scene(),probeScene=new THREE.Scene(),cache=new Map();
  // Three's default Sprite geometry is module-global. Give this viewer its own
  // geometry so renderer disposal cannot leave callbacks on that shared root.
  const glyphGeometry=new THREE.Sprite().geometry.clone();
  const depthMaterial=new THREE.MeshDepthMaterial({side:THREE.DoubleSide});depthMaterial.colorWrite=false;
  const depthMesh=new THREE.Mesh(mesh.geometry,depthMaterial);depthMesh.frustumCulled=false;depthMesh.matrixAutoUpdate=false;depthScene.add(depthMesh);
  const glyphs=new Map();let target=null,width=0,height=0;
  const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
  function release(label){const glyph=glyphs.get(label);if(!glyph)return;scene.remove(glyph.sprite);glyph.material.dispose();if(--glyph.asset.users===0){glyph.asset.texture.dispose();cache.delete(glyph.key)}glyphs.delete(label)}
  function glyphFor(label){
    const style=getComputedStyle(label.el),size=parseFloat(style.fontSize)||14;
    const font=`${style.fontStyle} ${style.fontWeight} ${size}px ${style.fontFamily}`;
    const key=[label.el.textContent,font,style.color,document.fonts?.status].join('|');
    let glyph=glyphs.get(label);if(glyph?.key===key)return glyph;release(label);
    let asset=cache.get(key);
    if(!asset){
      const canvas=document.createElement('canvas'),context=canvas.getContext('2d');context.font=font;
      const w=Math.ceil(context.measureText(label.el.textContent).width)+10,h=Math.ceil(size*1.5)+4;
      canvas.width=w*2;canvas.height=h*2;context.scale(2,2);context.font=font;context.textAlign='center';context.textBaseline='middle';context.fillStyle=style.color;context.fillText(label.el.textContent,w/2,h/2);
      const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
      asset={texture,w,h,users:0};cache.set(key,asset);
    }
    asset.users++;
    const material=new THREE.SpriteMaterial({map:asset.texture,transparent:true,depthTest:true,depthWrite:false,sizeAttenuation:false,alphaTest:.01});material.toneMapped=false;
    const sprite=new THREE.Sprite(material);sprite.geometry=glyphGeometry;sprite.frustumCulled=false;scene.add(sprite);
    glyph={key,asset,material,sprite};glyphs.set(label,glyph);return glyph;
  }
  function describe(label,glyph,box){
    const p=glyph.sprite.position.clone().project(camera),{w,h}=glyph.asset,x=(p.x+1)*box.width/2,y=(1-p.y)*box.height/2;
    const inFrustum=p.z>-1&&p.z<1&&x+w/2>0&&x-w/2<box.width&&y+h/2>0&&y-h/2<box.height;
    return {text:label.el.textContent,role:label.role,method:'gpu-depth',depthTest:true,depthWrite:false,decorative_base_in_depth:false,inFrustum,submitted:inFrustum,visibility_measured:false,visible:null,occluded:null,screen:[x,y],screen_bbox:[x-w/2,y-h/2,x+w/2,y+h/2],world:glyph.sprite.position.toArray(),baseline_pixels:null,visible_pixels:null,visible_fraction:null};
  }
  function update(labels){
    const box=host.getBoundingClientRect();if(!box.width||!box.height)return;
    camera.updateMatrixWorld(true);mesh.updateWorldMatrix(true,false);
    for(const label of glyphs.keys())if(!labels.includes(label))release(label);
    const sx=camera.position.x>=0?1:-1,sz=camera.position.z>=0?1:-1;
    const corners=[[-1,-1],[-1,1],[1,-1],[1,1]];
    const [cx,cz]=corners.reduce((left,c)=>new THREE.Vector3(c[0]*5,0,c[1]*4).project(camera).x<new THREE.Vector3(left[0]*5,0,left[1]*4).project(camera).x?c:left);
    axisGeometry.attributes.position.array.set([-5,0,sz*4,5,0,sz*4,sx*5,0,4,sx*5,0,-4,cx*5,0,cz*4,cx*5,6,cz*4]);axisGeometry.attributes.position.needsUpdate=true;
    for(const label of labels){
      const glyph=glyphFor(label),{w,h}=glyph.asset,p=label.position.clone(),role=label.role;
      label.el.style.visibility='hidden';label.el.dataset.labelRenderer='gpu-depth';
      if(role==='count-tick'){p.x=cx*5.7;p.z=cz*4.7}
      else if(role==='mass1-title')p.set(0,.12,sz*6.1);
      else if(role==='mass2-title')p.set(sx*7.2,.12,0);
      else if(role==='count-title')p.set(cx*5.7,6.5,cz*4.7);
      else if(role==='mass1-tick'){p.y=.08;p.z=sz*4.85}
      else if(role==='mass2-tick'){p.y=.08;p.x=sx*5.85}
      const projected=p.clone().project(camera);
      // Screen-pinned titles must retain a positive view depth even at minimum zoom.
      if(role.endsWith('title')&&!(projected.z>-1&&projected.z<1))projected.z=new THREE.Vector3(0,0,-camera.near*2).applyMatrix4(camera.projectionMatrix).z;
      if(role==='mass1-title'||role==='mass2-title'){
        const first=new THREE.Vector3(0,.12,sz*6.1).project(camera).x,second=new THREE.Vector3(sx*7.2,.12,0).project(camera).x;
        projected.x=(role==='mass1-title'?first<second:second<first)?-.5:.5;
        projected.y=-1+(h/2+(exportMode?8:55))/box.height*2;p.copy(projected.unproject(camera));
      }else if(role==='count-tick'){projected.x-=120/box.width;p.copy(projected.unproject(camera))}
      else if(role==='count-title'){
        const mx=(w/2+12)/box.width*2,my=(h/2+12)/box.height*2;
        projected.x=clamp(projected.x,-1+mx,1-mx);projected.y=clamp(projected.y,-1+my,1-my);p.copy(projected.unproject(camera));
      }
      glyph.sprite.position.copy(p);
      const factor=2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))/box.height;
      glyph.sprite.scale.set(w*factor,h*factor,1);
      label.visibility=describe(label,glyph,box);label.el.style.left=label.visibility.screen[0]+'px';label.el.style.top=label.visibility.screen[1]+'px';label.el.dataset.inFrustum=String(label.visibility.inFrustum);delete label.el.dataset.occluded;
    }
    depthMesh.visible=mesh.visible;depthMesh.matrix.copy(mesh.matrixWorld);
  }
  function render(){renderer.autoClear=false;renderer.clearDepth();renderer.render(depthScene,camera);renderer.render(scene,camera);renderer.autoClear=true}
  function measure(label,glyph){
    const box=host.getBoundingClientRect(),row=describe(label,glyph,box),size=renderer.getDrawingBufferSize(new THREE.Vector2());
    if(!target||width!==size.x||height!==size.y){target?.dispose();width=size.x;height=size.y;target=new THREE.WebGLRenderTarget(width,height,{depthBuffer:true})}
    const ratioX=width/box.width,ratioY=height/box.height,[left,top,right,bottom]=row.screen_bbox;
    const x=clamp(Math.floor(left*ratioX)-2,0,width),y=clamp(Math.floor((box.height-bottom)*ratioY)-2,0,height);
    const w=Math.max(0,Math.min(width-x,Math.ceil((right-left)*ratioX)+4)),h=Math.max(0,Math.min(height-y,Math.ceil((bottom-top)*ratioY)+4));
    const saved={target:renderer.getRenderTarget(),color:renderer.getClearColor(new THREE.Color()),alpha:renderer.getClearAlpha(),auto:renderer.autoClear,viewport:renderer.getViewport(new THREE.Vector4()),scissor:renderer.getScissor(new THREE.Vector4()),scissorTest:renderer.getScissorTest()};
    const probe=new THREE.Sprite(glyph.material);probe.geometry=glyphGeometry;probe.position.copy(glyph.sprite.position);probe.scale.copy(glyph.sprite.scale);probe.frustumCulled=false;probeScene.add(probe);
    const pixels=new Uint8Array(w*h*4);
    const count=withDepth=>{renderer.setRenderTarget(target);renderer.setScissorTest(false);renderer.setClearColor(0x000000,0);renderer.autoClear=false;renderer.clear(true,true,true);if(withDepth)renderer.render(depthScene,camera);renderer.render(probeScene,camera);if(!w||!h)return 0;renderer.readRenderTargetPixels(target,x,y,w,h,pixels);let n=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]>2)n++;return n};
    try{row.baseline_pixels=count(false);row.visible_pixels=count(true);row.visible_fraction=row.baseline_pixels?row.visible_pixels/row.baseline_pixels:null;row.visibility_measured=true;row.visible=row.visible_pixels>0;row.occluded=row.baseline_pixels>row.visible_pixels;row.partially_occluded=row.visible_pixels>0&&row.occluded;return row}
    finally{probeScene.remove(probe);renderer.setRenderTarget(saved.target);renderer.setClearColor(saved.color,saved.alpha);renderer.setViewport(saved.viewport);renderer.setScissor(saved.scissor);renderer.setScissorTest(saved.scissorTest);renderer.autoClear=saved.auto}
  }
  function diagnostics(labels,{measure:readPixels=false}={}){update(labels);return labels.map(label=>readPixels?measure(label,glyphs.get(label)):{...label.visibility})}
  function measureLabelDepth(labels,{text,role,position}={}){
    update(labels);const label=labels.find(l=>(text===undefined||l.el.textContent===text)&&(role===undefined||l.role===role));
    if(!label)throw Error('Unknown axis label');if(!Array.isArray(position)||position.length!==3||!position.every(Number.isFinite))throw Error('Expected a finite world position [x, y, z]');
    const glyph=glyphs.get(label),previous=glyph.sprite.position.clone();
    try{glyph.sprite.position.fromArray(position);return measure(label,glyph)}finally{glyph.sprite.position.copy(previous)}
  }
  return {update,render,diagnostics,measureLabelDepth,release,dispose(){for(const label of [...glyphs.keys()])release(label);glyphGeometry.dispose();depthMaterial.dispose();target?.dispose()}};
}
