// All masks operate on the same rectangle. Counts are never renormalized.
export function selectionRegion(slice, shape) {
  const range=(a,b,n)=>{
    const lo=Math.max(0,Math.min(n-1,Math.round(a??0)));
    return [lo,Math.max(lo+1,Math.min(n,Math.round(b??n)))];
  };
  if(slice.axis===null)return [[0,shape[0]],[0,shape[1]]];
  if(slice.axis===0)return [range(slice.lo,slice.hi,shape[0]),[0,shape[1]]];
  if(slice.axis===1)return [[0,shape[0]],range(slice.lo,slice.hi,shape[1])];
  if(slice.axis==='both')return [range(slice.xlo,slice.xhi,shape[0]),range(slice.ylo,slice.yhi,shape[1])];
  throw Error('Unknown slicing axis');
}

export function projectCounts(values,shape,region,axis) {
  const result=new Array(shape[axis]).fill(0),ny=shape[1];
  for(let i=region[0][0];i<region[0][1];i++)for(let j=region[1][0];j<region[1][1];j++)result[axis?j:i]+=values[i*ny+j];
  return result;
}

// Shape-preserving cubic interpolation only for legacy packages. New packages
// carry actual PDF samples integrated over the other-mass bins instead.
function monotoneCurve(x,y,subdivisions=12) {
  if(x.length<2)return {points:x,values:y};
  const secants=x.slice(1).map((v,i)=>(y[i+1]-y[i])/(v-x[i]));
  const slopes=y.map((_,i)=>i===0?secants[0]:i===y.length-1?secants.at(-1):secants[i-1]*secants[i]<=0?0:2*secants[i-1]*secants[i]/(secants[i-1]+secants[i]));
  const points=[],values=[];
  for(let i=0;i<x.length-1;i++)for(let k=0;k<subdivisions;k++){
    const t=k/subdivisions,h=x[i+1]-x[i],h00=2*t*t*t-3*t*t+1,h10=t*t*t-2*t*t+t,h01=-2*t*t*t+3*t*t,h11=t*t*t-t*t;
    points.push(x[i]+t*h);values.push(Math.max(0,h00*y[i]+h10*h*slopes[i]+h01*y[i+1]+h11*h*slopes[i+1]));
  }
  points.push(x.at(-1));values.push(y.at(-1));return {points,values};
}

export function sampledCurve(pkg,component,axis,region,weight=1) {
  const sampling=pkg.projection_samples?.axes?.[axis],edges=pkg.axes[axis].edges;
  const [lo,hi]=region[axis],left=edges[lo],right=edges[hi];
  if(sampling?.components?.[component.id]){
    const table=sampling.components[component.id],other=region[1-axis],n=sampling.other_bins;
    const points=[],values=[];
    for(let p=0;p<sampling.points.length;p++){
      const x=sampling.points[p];if(x<left-1e-12||x>right+1e-12)continue;
      let value=0;for(let b=other[0];b<other[1];b++)value+=table[p*n+b];
      points.push(x);values.push(value*weight);
    }
    return {points,values,source:'integrated-pdf-samples'};
  }
  const projected=projectCounts(component.expected,pkg.shape,region,axis),centers=[];
  for(let i=lo;i<hi;i++)centers.push((edges[i]+edges[i+1])/2);
  const smooth=monotoneCurve(centers,projected.slice(lo,hi).map(v=>v*weight));
  return {...smooth,source:'legacy-monotone-interpolation'};
}

export function projectionRecord(pkg,components,axis,region,weight=()=>1) {
  const observed=projectCounts(pkg.observed,pkg.shape,region,axis);
  const curves=components.map(component=>({id:component.id,color:component.color,
    expected:projectCounts(component.expected,pkg.shape,region,axis).map(v=>v*weight(component.id)),
    ...sampledCurve(pkg,component,axis,region,weight(component.id))}));
  const expected=observed.map((_,i)=>curves.reduce((a,c)=>a+c.expected[i],0));
  const points=curves[0]?.points??[];
  const total=points.map((_,i)=>curves.reduce((a,c)=>a+c.values[i],0));
  return {axis,region,window:{x:[...region[0]],y:[...region[1]]},observed,expected,components:Object.fromEntries(curves.map(c=>[c.id,c.expected])),curves,total,points,
    observed_total:observed.reduce((a,b)=>a+b,0),
    expected_total:expected.reduce((a,b)=>a+b,0),
    selected_bins:[...region[axis]],source:curves[0]?.source??'none'};
}
