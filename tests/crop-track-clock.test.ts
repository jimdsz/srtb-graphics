import test from 'node:test';
import assert from 'node:assert/strict';
import {motionCrop,patchCropMotion} from '../src/studio/crop-motion';
import type {CropMotion} from '../src/studio/crop-motion';
import type {ProjectData} from '../src/studio/domain';
import type {LegacyGraphic,Track} from '../src/studio/video/engine';
import {locateClip} from '../src/studio/presentation';
import {createAETemplate} from '../public/library/v1.7.0/_shared/lottie-ae-engine-v2.mjs';
import {CONFIG as weekly} from '../public/library/v1.7.0/BTV_Semainier/config.mjs';
import {CONFIG as event} from '../public/library/v1.7.0/BTV_Evenement/config.mjs';

async function nativeTrack(config:typeof weekly,kind:string):Promise<Track>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'HTMLElement');let g:LegacyGraphic;
  Object.defineProperty(globalThis,'HTMLElement',{configurable:true,value:class{}});
  try{g=Object.create(createAETemplate({},config,import.meta.url).prototype);}
  finally{if(previous)Object.defineProperty(globalThis,'HTMLElement',previous);else Reflect.deleteProperty(globalThis,'HTMLElement');}
  Object.assign(g,{animation:{renderer:{elements:[]}},makeMedia:async(spec:{key:string})=>spec.key===kind?{video:true,duration:1,url:'one-second.mp4',node:{},canvas:{}}:null});
  await g.prepareTracks();return g.tracks[kind];
}
const motion:CropMotion={start:0,end:0,duration:1,points:[{at:0,x:0,y:50,transition:'linear'},{at:.96,x:100,y:50,transition:'linear'}]};
function data(kind:string,m=motion){const d:ProjectData={_studio_format:'vertical',[`_media_${kind}_start_seconds`]:m.start,[`_media_${kind}_end_seconds`]:m.end};return {...d,...patchCropMotion(d,kind,m)};}

test('real AE tracks repeat the crop with each automatically looped short video',async()=>{
  for(const [config,kind] of [[weekly,'programme_1'],[weekly,'final'],[event,'event']] as const){
    const track=await nativeTrack(config,kind);assert.equal(track.loop,true);
    for(const seconds of [.92,.96,1,1.04,1.2,1.96,2,2.2,4.2]){
      const source=locateClip(track.clips,seconds,track.loop,track.rate)!;
      const expected=Math.min(100,(source.time-track.clips[0].start)/.96*100);
      assert.ok(Math.abs(motionCrop(data(kind),kind,seconds,motion,track).x-expected)<1e-7,`${kind} at ${seconds}: expected ${expected}`);
    }
  }
});
test('resolved primary track owns speed, loop and last decoded source frame',()=>{
  const kind='body',m={...motion,start:4,end:5},d={...data(kind,m),_media_body_loop:true,_media_body_rate:2};
  const track:Track={clips:[{start:4,end:5,length:1,type:'video'}],loop:false,rate:.5};
  assert.ok(Math.abs(motionCrop(d,kind,1,m,track).x-50/.96)<1e-7);
  assert.equal(motionCrop(d,kind,10,m,track).x,100);
  const endpoint={...m,points:[{at:0,x:0,y:50,transition:'linear' as const},{at:1,x:100,y:50,transition:'linear' as const}]};
  assert.ok(Math.abs(motionCrop(data(kind,endpoint),kind,10,endpoint,track).x-96)<1e-7);
});
test('without a resolved track the editor keeps its current fallback semantics',()=>{
  assert.equal(motionCrop({...data('body'),_media_body_loop:true},'body',1.2,motion).x,motionCrop({...data('body'),_media_body_loop:true},'body',1.2,motion,{clips:[],loop:false}).x);
  assert.deepEqual(motionCrop({...data('body'),_media_body_start_seconds:3},'body',1.2,motion,{clips:[{start:0,end:1,length:1,type:'video'}],loop:true}),{x:50,y:50});
});

test('an untrimmed still repeats its finite crop movement, not an infinite source clock',()=>{
  const m:CropMotion={...motion,duration:5,points:[{at:0,x:0,y:50,transition:'linear'},{at:4.96,x:100,y:50,transition:'linear'}]};
  const d={...data('background',m),_media_background_loop:true};
  const track:Track={clips:[{start:0,end:0,length:Infinity,type:'image'}],loop:true,rate:1};
  assert.ok(Math.abs(motionCrop(d,'background',6.2,m,track).x-1.2/4.96*100)<1e-7);
});

test('retained primary video crops follow the displayed source time, not the requested next loop',()=>{
  const track:Track={clips:[{start:0,end:1,length:1,type:'video'}],loop:true,rate:1};
  assert.equal(motionCrop(data('body'),'body',1.2,motion,track,{index:0,time:.96}).x,100);
});
