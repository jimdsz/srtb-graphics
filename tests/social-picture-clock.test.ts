import test from 'node:test';
import assert from 'node:assert/strict';
import {liveSocialPictures} from '../src/studio/social-renderer';
import type {PictureCache} from '../src/studio/social-renderer';
import {sequenceCropAt} from '../src/studio/sequence-crop';
import type {Track} from '../src/studio/video/engine';
import type {ClipPosition} from '../src/studio/media-position';
import {rememberPreviewPosition} from '../src/studio/preview-picture-position';
import {motionCrop} from '../src/studio/crop-motion';

test('a waiting next clip cannot apply its crop to the retained previous picture',()=>{
  class Video {readyState=2;seeking=false;error=null;videoWidth=1920;videoHeight=1080;currentTime=0;name='';}
  class Image {}
  const names=['HTMLVideoElement','HTMLImageElement','document'] as const,old=names.map(name=>Object.getOwnPropertyDescriptor(globalThis,name));
  const context={drawImage(video:Video){canvas.image=video.name;}},canvas={width:0,height:0,image:'',getContext:()=>context};
  Object.defineProperties(globalThis,{HTMLVideoElement:{configurable:true,value:Video},HTMLImageElement:{configurable:true,value:Image},document:{configurable:true,value:{createElement:()=>canvas}}});
  try{
    const a=Object.assign(new Video(),{name:'A',currentTime:5.96}),b=Object.assign(new Video(),{name:'B',currentTime:8.04,seeking:true});
    const track:Track={clips:[{start:4,end:6,length:2,type:'video',node:a as unknown as HTMLVideoElement},{start:8,end:10,length:2,type:'video',node:b as unknown as HTMLVideoElement}],loop:true,rate:1};
    const cache:PictureCache=new Map(),styles=[{x:0,y:50,fit:'cover' as const},{x:100,y:50,fit:'cover' as const}];
    function paint(seconds:number){const positions:Record<string,ClipPosition>={};const image=liveSocialPictures({body:track},{body:seconds},cache,1280,positions).body;return {image,position:positions.body,crop:sequenceCropAt(styles,seconds,track,positions.body)};}
    const initial=paint(1.96);assert.equal(canvas.image,'A');assert.equal(initial.crop?.x,0);
    for(const sourceTime of [6,6.1]){a.currentTime=sourceTime;const ended=paint(1.96);assert.equal(ended.crop?.x,0,'exact/end overshoot remains in the displayed clip');assert.deepEqual(ended.position,{index:0,time:5.96});}
    const waiting=paint(2.04);assert.equal(waiting.image,initial.image);assert.equal(canvas.image,'A');assert.equal(waiting.crop?.x,0,'retained A must keep A framing');assert.deepEqual(waiting.position,{index:0,time:5.96});
    b.seeking=false;const ready=paint(2.04);assert.equal(canvas.image,'B');assert.equal(ready.crop?.x,100);assert.deepEqual(ready.position,{index:1,time:8.04});
    track.clips[0].node=null;const loop=paint(4.04);assert.equal(loop.crop?.x,100,'keep last B crop while A is not yet allocated');
    track.clips[0].node=a as unknown as HTMLVideoElement;a.currentTime=4.04;track.rate=2;const faster=paint(2.02);assert.equal(canvas.image,'A');assert.deepEqual(faster.position,{index:0,time:4.04});assert.equal(faster.crop?.x,0);
    // At exactly frame 28, reconstructing output time (.84/.75) would
    // round into A even though the decoder is displaying the first B frame.
    track.clips[0].start=0;track.clips[0].end=.84;track.clips[0].length=.84;track.rate=.75;b.currentTime=8;
    const boundary=paint(1.12);assert.equal(canvas.image,'B');assert.deepEqual(boundary.position,{index:1,time:8});assert.equal(boundary.crop?.x,100);
  }finally{names.forEach((name,i)=>{if(old[i])Object.defineProperty(globalThis,name,old[i]!);else Reflect.deleteProperty(globalThis,name);});}
});

test('AE prepared canvas keeps its own last painted position during a pending loop seek',()=>{
  const canvas={width:640,height:360} as HTMLCanvasElement;
  const track={clips:[{start:0,end:1,length:1,type:'video' as const}],loop:true,rate:1,previewCanvas:canvas};
  const motion={start:0,end:0,duration:1,points:[{at:0,x:0,y:50,transition:'linear' as const},{at:.96,x:100,y:50,transition:'linear' as const}]};
  const positions:Record<string,ClipPosition>={};
  rememberPreviewPosition(canvas,{index:0,time:.96});
  assert.equal(liveSocialPictures({event:track},{event:1.2},new Map(),1280,positions).event,canvas);
  assert.equal(motionCrop({_studio_format:'vertical'},'event',1.2,motion,track,positions.event).x,100);
  rememberPreviewPosition(canvas,{index:0,time:.2});
  liveSocialPictures({event:track},{event:1.2},new Map(),1280,positions);
  assert.ok(Math.abs(motionCrop({_studio_format:'vertical'},'event',1.2,motion,track,positions.event).x-100*.2/.96)<1e-7);
});
