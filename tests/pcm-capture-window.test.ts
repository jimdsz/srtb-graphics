import {test} from 'node:test';
import assert from 'node:assert/strict';
import {captureWindow} from './pcm-capture-window';
const block=(firstFrame:number,length:number,value:number)=>({firstFrame,channels:[new Float32Array(length).fill(value),new Float32Array(length).fill(-value)]});
test('exact PCM window is assembled only from observed samples',()=>{
  const result=captureWindow([block(0,128,1),block(128,128,2)],120,136);
  assert.equal(result.firstFrame,120);assert.deepEqual([...result.channels[0]],[...Array(8).fill(1),...Array(8).fill(2)]);
  assert.deepEqual([...result.channels[1]],[...Array(8).fill(-1),...Array(8).fill(-2)]);
});
test('a gap outside the measured interval cannot shift any observed sample',()=>{
  const result=captureWindow([block(0,128,1),block(256,128,2),block(512,128,3)],256,384);
  assert.ok(result.channels[0].every(n=>n===2));assert.equal(result.channels[0].length,128);
});
test('a one-sample gap inside the interval is rejected, never padded',()=>{
  assert.throws(()=>captureWindow([block(0,128,1),block(129,128,2)],120,136),/Lacune/);
});
test('missing first/last samples and overlapping captures are rejected',()=>{
  assert.throws(()=>captureWindow([block(1,128,1)],0,128),/Lacune/);
  assert.throws(()=>captureWindow([block(0,127,1)],0,128),/incomplète/);
  assert.throws(()=>captureWindow([block(0,128,1),block(127,128,2)],120,136),/recouvrement/);
});
