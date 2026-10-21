import test from 'node:test';
import assert from 'node:assert/strict';
import {PreviewPictureProgress,PreviewPictureSamples,pictureSourceSample,pictureCopyStalls} from '../src/studio/preview-picture-progress';
import type {PictureSurfaceSample} from '../src/studio/preview-picture-progress';
test('copy age includes the entire silence after the last successful copy',()=>{
 const p=new PreviewPictureProgress();assert.deepEqual(p.snapshot(500),{completed:0,lastCompletedAgeMs:null,sourceTimeAtCopy:null});
 p.record(1000,2.5);assert.deepEqual(p.snapshot(15000),{completed:1,lastCompletedAgeMs:14000,sourceTimeAtCopy:2.5});
 p.record(NaN,8);p.record(-1);assert.equal(p.snapshot(15000).completed,1);
 p.record(15100,2.5);assert.equal(p.snapshot(15101).completed,2); // Same source time is possible in a loop.
 p.record(15200);assert.equal(p.snapshot(15201).sourceTimeAtCopy,null);
});
const sampled=(count=8)=>Array.from({length:count},(_,i)=>({atMs:i*500,timelineSeconds:10+i/2,sources:[{id:0,time:i/2,paused:false,ended:false,seeking:false,readyState:4,frames:i*12,dropped:0}],surfaces:[{kind:'body',phaseActive:true,destinationVisible:true,sourceIsVideo:true,sourceId:0,sink:'canvas',copy:{completed:10,lastCompletedAgeMs:i*500,sourceTimeAtCopy:0}} as PictureSurfaceSample]}));
test('moving source and stopped active sink warn without claiming compositor verification',()=>{
 assert.deepEqual(pictureCopyStalls(sampled()),['body']);
 const healthy=sampled();healthy.forEach((s,i)=>s.surfaces[0].copy.completed+=i);assert.deepEqual(pictureCopyStalls(healthy),[]);
});
test('pause, hidden phase, unknown counters, changed source, sparse sampling and loops are not false stalls',()=>{
 for(const mutate of [
  (s:ReturnType<typeof sampled>[number])=>{s.sources[0].paused=true;},
  (s:ReturnType<typeof sampled>[number])=>{s.surfaces[0].phaseActive=false;},
  (s:ReturnType<typeof sampled>[number])=>{s.surfaces[0].destinationVisible=false;},
  (s:ReturnType<typeof sampled>[number])=>{s.sources[0].frames=0;},
  (s:ReturnType<typeof sampled>[number])=>{s.sources[0].dropped=s.sources[0].frames;},
  (s:ReturnType<typeof sampled>[number])=>{s.surfaces[0].sourceId=1;},
  (s:ReturnType<typeof sampled>[number])=>{s.atMs*=5;},
 ]){const series=sampled();series.forEach(mutate);assert.deepEqual(pictureCopyStalls(series),[]);}
 const loop=sampled();loop.forEach((s,i)=>{s.sources[0].time=0;s.surfaces[0].copy.completed+=i;});assert.deepEqual(pictureCopyStalls(loop),[]);
 const transition=sampled();transition.forEach((s,i)=>{s.surfaces[0].sink=i%3===0?'svg-href':'html-canvas';s.surfaces[0].svg={completed:10,lastCompletedAgeMs:9000,sourceTimeAtCopy:null,phase:'idle',phaseAgeMs:9000,busy:false,pending:false};});assert.deepEqual(pictureCopyStalls(transition),[]);
});
test('diagnostic source snapshots whitelist numbers and tolerate absent/throwing counters',()=>{
 const node={currentTime:1.23456,paused:false,ended:false,seeking:true,readyState:2,src:'secret-path',getVideoPlaybackQuality(){throw Error('unavailable');}} as unknown as HTMLVideoElement;
 assert.deepEqual(pictureSourceSample(node,7),{id:7,time:1.235,paused:false,ended:false,seeking:true,readyState:2,frames:null,dropped:null});
 node.getVideoPlaybackQuality=()=>({totalVideoFrames:NaN,droppedVideoFrames:-1}) as VideoPlaybackQuality;
 assert.equal(pictureSourceSample(node,7).frames,null);assert.equal(pictureSourceSample(node,7).dropped,null);
 assert.equal(JSON.stringify(pictureSourceSample(node,7)).includes('secret'),false);
});
test('on-demand snapshots retain past stalls after pause/inspection and stay bounded',()=>{
 const history=new PreviewPictureSamples(),source={id:0,time:0,paused:false,ended:false,seeking:false,readyState:4,frames:10,dropped:0};
 for(let i=0;i<50;i++)history.add(i*500,i/2,Array.from({length:40},(_,id)=>({...source,id})),null);
 const r=history.snapshot();assert.equal(r.samples.length,32);assert.equal(r.samples[0].sources.length,32);assert.equal(r.samples[31].atMs,15500);assert.equal(r.truncated,true);
 assert.match(r.observes,/not compositor/);
});
