import test from 'node:test';
import assert from 'node:assert/strict';
import {seekSignatureMedia} from '../src/studio/video/signature-media';
import type {LegacyGraphic,Track} from '../src/studio/video/engine';
// Exercise the frozen native clock, not a reimplementation of its formula.
import {createAETemplate} from '../public/library/v1.7.0/_shared/lottie-ae-engine-v2.mjs';
import {CONFIG as weekly} from '../public/library/v1.7.0/BTV_Semainier/config.mjs';
import {CONFIG as event} from '../public/library/v1.7.0/BTV_Evenement/config.mjs';

function clock(config:typeof weekly):LegacyGraphic{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'HTMLElement');
  Object.defineProperty(globalThis,'HTMLElement',{configurable:true,value:class{}});
  try{return Object.assign(Object.create(createAETemplate({},config,import.meta.url).prototype),{elapsed:0,outAt:undefined,phase:'ready'});}
  finally{if(previous)Object.defineProperty(globalThis,'HTMLElement',previous);else Reflect.deleteProperty(globalThis,'HTMLElement');}
}
function tracks(config:typeof weekly){
  const calls:{key:string;time:number}[]=[],tracks:Record<string,Track>={};
  for(const media of config.media)tracks[media.key]={clips:[],loop:false,activeStart:media.activeStart,activeEnd:media.activeEnd,seek:async time=>{calls.push({key:media.key,time});}};
  return {calls,tracks};
}

test('weekly final video continues during a long hold and the complete delayed OUT',async()=>{
  const g=clock(weekly),t=tracks(weekly);
  for(const seconds of [25.04,30.04]){
    t.calls.length=0;await seekSignatureMedia(g,t.tracks,seconds,30);
    assert.deepEqual(t.calls.map(c=>c.key),['final']);
    assert.ok(Math.abs(t.calls[0].time-(seconds-19.8))<1e-8);
    assert.equal(g.phase,seconds<30?'inspection':'out');
  }
  t.calls.length=0;await seekSignatureMedia(g,t.tracks,31.68,30);
  assert.deepEqual(t.calls,[],'final stops only when its AE layer ends at 25 s');
});

test('early OUT selects the media visible in the native exit, not the interrupted programme',async()=>{
  const g=clock(weekly),t=tracks(weekly);
  await seekSignatureMedia(g,t.tracks,10.04,10);
  assert.deepEqual(t.calls.map(c=>c.key),['final']);
  assert.equal(t.calls[0].time,0,'media time remains elapsed relative to its own activation');
});

test('weekly and event media activation agrees with native poses across normal, early and delayed OUT',async()=>{
  for(const config of [weekly,event])for(const outAt of [config.timing.outStart,10,30]){
    const g=clock(config),reference=clock(config),t=tracks(config);
    for(let frame=0;frame<Math.round((outAt+config.timing.outDuration)*25);frame++){
      const seconds=frame/25;reference.phase=seconds>=outAt?'out':'inspection';reference.outAt=outAt;
      const pose=reference.sourceFrame(seconds)/25;
      const expected=config.media.filter(m=>pose>=m.activeStart&&pose<m.activeEnd).map(m=>m.key);
      t.calls.length=0;await seekSignatureMedia(g,t.tracks,seconds,outAt);
      assert.deepEqual(t.calls.map(c=>c.key),expected,`${config.timing.outStart}: OUT ${outAt}, frame ${frame}`);
    }
  }
});

test('unwindowed legacy tracks keep their clock; audio is not DOM-seeked and media seek is awaited',async()=>{
  const calls:string[]=[],g={} as LegacyGraphic;let resolve!:()=>void;
  const pending=new Promise<void>(done=>resolve=done),t:Record<string,Track>={
    background:{clips:[],loop:false,seek:async seconds=>{calls.push(`start ${seconds}`);await pending;calls.push('done');}},
    audio:{clips:[],loop:false,seek:async()=>{throw Error('Audio must be mixed offline.');}},
  };
  let complete=false;const work=seekSignatureMedia(g,t,25,30).then(()=>complete=true);
  await Promise.resolve();assert.equal(complete,false);assert.deepEqual(calls,['start 25']);
  resolve();await work;assert.equal(complete,true);assert.deepEqual(calls,['start 25','done']);
});
