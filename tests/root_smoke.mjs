import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readRootFile } from '../web/root_io.js';
const bytes=await readFile(new URL('../examples/twin-gaussian.root',import.meta.url));
const data=await readRootFile(bytes);
assert.equal(data.observed.reduce((a,b)=>a+b,0),12000);
assert.equal(data.components.length,2);
assert.deepEqual(data.components.map(c=>c.id),['twin_peak','power_background']);
const peak=data.components[0];assert.equal(peak.children.length,2);
for(let i=0;i<peak.expected.length;i++)assert.ok(Math.abs(peak.children.reduce((a,c)=>a+c.expected[i],0)-peak.expected[i])<1e-6+1e-5*peak.expected[i]);
for(const axis of data.projection_samples.axes){assert.ok(axis.points.length>100);assert.ok(axis.components[peak.children[0].id]);}
assert.ok(data.title.toUpperCase().includes('SYNTHETIC'));
console.log('PASS: native synthetic ROOT, automatic hierarchy and smooth projection tables');
