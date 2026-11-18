import assert from 'node:assert/strict';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-14,`${a} ≈ ${b}`);
import {countFloor, countFraction, countTicks, formatCountTick} from '../web/count_scale.js';

assert.equal(formatCountTick(.01),'0.01');
assert.equal(formatCountTick(1000),'1,000');
assert.equal(formatCountTick(1e-8),'1e-8');
assert.equal(formatCountTick(2.5e-8),'2.5e-8');
assert.equal(countFraction(25,100),.25);
assert.equal(countFraction(0,100,'log'),0);
assert.equal(countFraction(.001,100,'log'),0);
assert.equal(countFraction(.01,100,'log'),0);
close(countFraction(1,100,'log'),.5);
close(countFraction(10,100,'log'),.75);
assert.equal(countFraction(100,100,'log'),1);
assert.deepEqual(countTicks(124.32,'log'),[.01,.1,1,10,100]);
assert.deepEqual(countTicks(100,'linear'),[0,25,50,75,100]);
assert.equal(countFloor(124,.1),.1);
assert.equal(countFraction(0,100,'log',.1),0);
assert.equal(countFraction(.01,100,'log',.1),0);
assert.equal(countFraction(.1,100,'log',.1),0);
close(countFraction(1,100,'log',.1),1/3);
close(countFraction(10,100,'log',.1),2/3);
assert.equal(countFraction(100,100,'log',.1),1);
assert.deepEqual(countTicks(124.32,'log',4,.1),[.1,1,10,100]);
assert.deepEqual(countTicks(124.32,'log',4,.03),[.03,.1,1,10,100]);
for(const invalid of [0,-1,NaN,Infinity,100,101])assert.throws(()=>countFloor(100,invalid));
assert.throws(()=>countFraction(1,100,'invalid'));
assert.throws(()=>countFraction(1,0,'log'));
assert.ok(countFraction(1+9,100,'log')!==countFraction(1,100,'log')+countFraction(9,100,'log'));


assert.ok(Number.isFinite(countFraction(1,124.32,'log',Number.MIN_VALUE)));
assert.equal(formatCountTick(1.5),'1.5');
assert.equal(formatCountTick(124.32),'124.32');

assert.equal(countFraction(124.32,124.32,'log',124.32-Number.EPSILON*124.32),1);
console.log('PASS: linear/log mapping, true decades, adjustable floors and sum-before-log');
