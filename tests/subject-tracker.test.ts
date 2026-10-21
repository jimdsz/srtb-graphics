import test from 'node:test';
import assert from 'node:assert/strict';
import {SubjectTracker,subjectCrop,subjectPoints} from '../src/studio/subject-tracker';
import type {GrayFrame,SubjectBox,TrackSample} from '../src/studio/subject-tracker';
import {cropMotionSchema} from '../src/studio/crop-motion';
import {interpolateCrop} from '../src/studio/crop-motion';
function scene(x:number,y=45,duplicate=false):GrayFrame{
 const width=256,height=144,pixels=new Uint8Array(width*height).fill(35);
 const draw=(left:number)=>{for(let dy=0;dy<36;dy++)for(let dx=0;dx<30;dx++)pixels[(y+dy)*width+left+dx]=55+(dx*37+dy*59+dx*dy*7)%190;};draw(x);if(duplicate)draw(x+38);return {width,height,pixels};
}
const box:SubjectBox={x:60,y:45,w:30,h:36};
test('tracks a selected moving subject without running detection during playback',()=>{
 const tracker=new SubjectTracker(scene(60),box),samples:TrackSample[]=[{at:0,box,confidence:1}];
 for(let i=1;i<=20;i++){const result=tracker.next(scene(60+i*3));assert.equal(result.stopped,false);assert.ok(Math.abs(result.box.x-(60+i*3))<2);samples.push({at:i/5,...result});}
 const points=subjectPoints(samples,256,144,9/16);assert.ok(points.at(-1)!.x>points[0].x+20);assert.ok(points.length<=120);
 assert.equal(cropMotionSchema.safeParse({start:1,end:5,duration:4,points}).success,true);
});
test('uniform selection and lost subject stop rather than invent a path',()=>{
 assert.throws(()=>new SubjectTracker({width:256,height:144,pixels:new Uint8Array(256*144).fill(80)},box),/uniforme/);
 const tracker=new SubjectTracker(scene(60),box);const result=tracker.next({width:256,height:144,pixels:new Uint8Array(256*144).fill(80)});assert.equal(result.stopped,true);assert.deepEqual(result.box,box);
});
test('a hard cut and a repeated ambiguous patch are not silently followed',()=>{
 const tracker=new SubjectTracker(scene(60),box);assert.equal(tracker.next(scene(190)).stopped,true);
 const tracker2=new SubjectTracker(scene(60),box);assert.equal(tracker2.next(scene(42,45,true)).stopped,true);
});
test('crop geometry centres the chosen subject and bounds both portrait and vertical axes',()=>{
 assert.equal(subjectCrop({x:0,y:40,w:20,h:30},256,144,9/16).x,0);
 assert.equal(subjectCrop({x:230,y:40,w:20,h:30},256,144,4/5).x,100);
 assert.equal(subjectCrop(box,256,144,9/16).y,50);
 const samples=Array.from({length:301},(_,i)=>({at:i*.2,box:{...box,x:60+30*Math.sin(i)},confidence:1}));
 const points=subjectPoints(samples,256,144,9/16);assert.ok(points.length<=120);assert.equal(points[0].at,0);assert.equal(points.at(-1)!.at,60);
});

test('steady motion is anticipated without stopping the camera at each tracking sample',()=>{
 const samples=Array.from({length:51},(_,i)=>({at:i*.2,box:{...box,x:40+i*2},confidence:1}));
 const points=subjectPoints(samples,256,144,9/16);
 assert.ok(points.every(point=>point.transition==='linear'));
 for(const at of [2,4,6,8]){
  const before=interpolateCrop(points,at-.04,{x:50,y:50});
  const current=interpolateCrop(points,at,{x:50,y:50});
  const after=interpolateCrop(points,at+.04,{x:50,y:50});
  assert.ok(Math.abs((after.x-current.x)-(current.x-before.x))<.05,'constant speed across measurement');
  assert.ok(Math.abs(current.x-subjectCrop(samples[Math.round(at*5)].box,256,144,9/16).x)<.5,'no trailing behind the subject');
 }
});

test('small tracking noise does not continually move a static social crop',()=>{
 const samples=Array.from({length:101},(_,i)=>({at:i*.2,box:{...box,x:90+(i%2?.5:-.5)},confidence:1}));
 for(const ratio of [9/16,4/5]){
  const points=subjectPoints(samples,256,144,ratio);
  assert.ok(Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x))<.7);
  assert.ok(points.length<=3);
 }
});
