import test from 'node:test';import assert from 'node:assert/strict';
import {stretchStereo} from '../src/studio/video/stretch';
test('slow/fast audio keeps pitch, stereo separation and exact output duration',()=>{
  const sr=48000,input=new Float32Array(sr*2),right=new Float32Array(input.length);for(let i=0;i<input.length;i++)input[i]=Math.sin(2*Math.PI*440*i/sr)*.4;
  for(const tempo of [.25,.5,1.5,2,4]){const frames=Math.round(input.length/tempo),output=stretchStereo(input,right,sr,tempo,frames);assert.equal(output[0].length,frames);assert.equal(output[1].length,frames);assert.ok(output[1].every(v=>v===0));let crossings=0;const from=Math.round(sr*.15),to=frames-Math.round(sr*.15);for(let i=from+1;i<to;i++)if(output[0][i-1]<=0&&output[0][i]>0)crossings++;const hz=crossings/((to-from)/sr);assert.ok(Math.abs(hz-440)<10,`${tempo}: ${hz} Hz`);}
});
