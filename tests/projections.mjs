import assert from 'node:assert/strict';
import {selectionRegion,projectCounts,sampledCurve} from '../web/projections.js';

// Deliberately asymmetric grid catches x/y transposition and double cuts.
const shape=[3,5],counts=Array.from({length:15},(_,i)=>i);
const rectangle=selectionRegion({axis:'both',xlo:1,xhi:3,ylo:1,yhi:4},shape);
assert.deepEqual(projectCounts(counts,shape,rectangle,0),[0,21,36]);
assert.deepEqual(projectCounts(counts,shape,rectangle,1),[0,17,19,21,0]);
assert.equal(projectCounts(counts,shape,rectangle,0).reduce((a,b)=>a+b,0),57);
assert.equal(projectCounts(counts,shape,rectangle,1).reduce((a,b)=>a+b,0),57);
assert.deepEqual(selectionRegion({axis:0,lo:1,hi:2},shape),[[1,2],[0,5]]);
const points=[0,.5,1,1.5,2,2.5,3];
const pkg={shape,axes:[{edges:[0,1,2,3]},{edges:[0,1,2,3,4,5]}],projection_samples:{axes:[{points,other_bins:5,components:{SS:points.flatMap(x=>[x,2*x,3*x,4*x,5*x])}}]}};
const curve=sampledCurve(pkg,{id:'SS'},0,rectangle);
assert.deepEqual(curve.points,[1,1.5,2,2.5,3]);
assert.deepEqual(curve.values,[9,13.5,18,22.5,27]);
assert.equal(curve.source,'integrated-pdf-samples');
console.log('PASS: same-region x/y counts and finite-window dense curve support');
