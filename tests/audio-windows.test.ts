import test from 'node:test';
import assert from 'node:assert/strict';
import {audioWindows} from '../src/studio/video/audio';
import type {AudioEvent} from '../src/studio/video/audio';
const event=(start:number,duration:number,rate=1,url='local-video'):AudioEvent=>({url,start,duration,rate,at:0,gain:()=>1,required:false});
test('distant excerpts decode only their selected audio, not hours of unused gaps',()=>{
  const first=event(0,3),last=event(7200,3),windows=audioWindows([last,first]);
  assert.deepEqual(windows.map(w=>[w.start,w.end]),[[0,3],[7200,7203]]);
  assert.equal(windows.reduce((sum,w)=>sum+w.end-w.start,0),6);
  assert.equal(windows[0].events[0],first);assert.equal(windows[1].events[0],last);
});
test('overlaps and repeats share decoded audio while rate and independent sources stay correct',()=>{
  const a=event(2,4),b=event(4,4,2),repeat=event(2,4),other=event(2,4,1,'other');
  const windows=audioWindows([a,b,repeat,other]);
  assert.deepEqual(windows.map(w=>[w.url,w.start,w.end,w.events.length]),[['local-video',2,12,3],['other',2,6,1]]);
});
