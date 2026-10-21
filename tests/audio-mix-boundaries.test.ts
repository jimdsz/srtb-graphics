import test from 'node:test';
import assert from 'node:assert/strict';
import {mixAudio} from '../src/studio/video/audio';
import type {AudioEvent} from '../src/studio/video/audio';

type StartCall={when:number;offset:number;duration:number};
class RecordingContext {
  static instances:RecordingContext[]=[];
  readonly destination={};
  readonly starts:StartCall[]=[];
  constructor(readonly channels:number,readonly length:number,readonly sampleRate:number){RecordingContext.instances.push(this);}
  createBufferSource(){return {buffer:null,connect(){},start:(when:number,offset:number,duration:number)=>{this.starts.push({when,offset,duration});}};}
  createGain(){return {connect(){},gain:{setValueAtTime(){},linearRampToValueAtTime(){}}};}
  async startRendering(){return {numberOfChannels:this.channels,getChannelData:()=>new Float32Array(this.length)};}
}
const source={duration:5,sampleRate:48000,length:240000,numberOfChannels:2} as AudioBuffer;
const event=(at:number,duration:number,start=.2):AudioEvent=>({buffer:source,at,start,duration,rate:1,gain:()=>.6,required:true});
async function scheduled(events:AudioEvent[],duration:number){
  const previous=Object.getOwnPropertyDescriptor(globalThis,'OfflineAudioContext');
  RecordingContext.instances=[];
  Object.defineProperty(globalThis,'OfflineAudioContext',{configurable:true,writable:true,value:RecordingContext});
  try{await mixAudio(events,duration,new AbortController().signal,()=>{});return RecordingContext.instances[0].starts;}
  finally{if(previous)Object.defineProperty(globalThis,'OfflineAudioContext',previous);else Reflect.deleteProperty(globalThis,'OfflineAudioContext');}
}

test('export passes the complete voice selection to Web Audio without a delay-dependent rounding trip',async()=>{
  const selected=event(.4,.8),[start]=await scheduled([selected],2);
  assert.deepEqual(start,{when:.4,offset:.2,duration:.8});
  assert.equal(start.duration*48000,38400,'The selected voice contains exactly 38,400 source frames.');
});

test('complete selections keep their duration at single-sample and render-quantum boundaries',async()=>{
  for(const duration of [1/48000,127/48000,128/48000,129/48000,.2,.8]){
    for(const at of [.4,1.3,8.3]){
      const selected=event(at,duration),[start]=await scheduled([selected],at+duration);
      assert.equal(start.duration,duration,`at=${at}, duration=${duration}: an exact-fit export must retain the selected passage`);
      assert.equal(start.when,at);assert.equal(start.offset,.2);
    }
  }
});

test('a real export boundary still clips the event and keeps its original source offset',async()=>{
  const selected=event(.4,.8,.125),exportEnd=.9,[start]=await scheduled([selected],exportEnd);
  assert.deepEqual(start,{when:.4,offset:.125,duration:.5});
});

test('subsample source marks are preserved instead of being rounded globally',async()=>{
  const selected=event(.4,.8+.25/48000,.2+.4/48000),[start]=await scheduled([selected],2);
  assert.equal(start.duration,selected.duration);assert.equal(start.offset,selected.start);
});
