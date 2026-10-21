import test from 'node:test';
import assert from 'node:assert/strict';
import {installAESignatureLevel,aeSignatureEnd,hasAESignature} from '../src/studio/ae-signature-audio';
import {audioEvents} from '../src/studio/video/audio';
import {makeTimeline} from '../src/studio/video/timeline';
import type {LegacyGraphic,PreparedGraphic} from '../src/studio/video/engine';
import {completeAEOutConfig} from '../src/studio/ae-out-timing';
import {assertSupplementalVoiceFits} from '../src/studio/supplemental-voice';

for(const id of ['BTV_Renvoi','BTV_Evenement','BTV_Semainier'])test(`${id}: native preview gain and offline event agree, including OUT`,()=>{
 const node={volume:1},calls:unknown[][]=[],g={data:{_audio_volume:.35},audio:[id==='BTV_Renvoi'?{element:node}:{node}],syncAudio(...args:unknown[]){calls.push(args);}} as unknown as LegacyGraphic;
 installAESignatureLevel(g,{id,libraryVersion:'1.7.0'});const installed=g.syncAudio;installAESignatureLevel(g,{id,libraryVersion:'1.7.0'});assert.equal(g.syncAudio,installed);
 g.syncAudio(2.8,true);assert.equal(node.volume,.35);assert.deepEqual(calls,[[2.8,true]]);
 const data={_audio_enabled:true,_audio_volume:.35,_out_mode:'duration',_out_duration_seconds:18};
 const timeline=makeTimeline(id,data,{},18),events=audioEvents({graphic:g,data,timeline,tracks:{audio:{clips:[{type:'audio',url:'audio.wav',start:0,end:30,length:30}],loop:false}}} as unknown as PreparedGraphic,id,false);
 assert.equal(events.length,1);assert.equal(events[0].gain(19),node.volume);assert.equal(events[0].duration,id==='BTV_Renvoi'?10:timeline.duration);
 g.data._audio_volume=0;g.syncAudio(3,false);assert.equal(node.volume,0);
 g.data._audio_volume=4;g.syncAudio(3,false);assert.equal(node.volume,1);
 g.data._audio_volume=NaN;g.syncAudio(3,false);assert.equal(node.volume,0);
});

test('source duration, explicit silence and short OUT remain respected',()=>{
 const id='BTV_Renvoi',data={_audio_enabled:true,_audio_volume:1,_out_mode:'duration',_out_duration_seconds:3},timeline=makeTimeline(id,data,{},3);
 const prepared={graphic:{},data,timeline,tracks:{audio:{clips:[{type:'audio',url:'audio.wav',start:0,end:2,length:2}],loop:false}}} as unknown as PreparedGraphic;
 assert.equal(audioEvents(prepared,id,false)[0].duration,2);
 prepared.tracks.audio.clips[0].length=10.125;assert.equal(audioEvents(prepared,id,false)[0].duration,5.6);
 prepared.data._audio_enabled=false;assert.deepEqual(audioEvents(prepared,id,false),[]);
 assert.equal(aeSignatureEnd(id,20),10);assert.equal(aeSignatureEnd('BTV_Evenement',21.04),21.04);
});

test('other models and future library versions are not patched',()=>{
 const g={syncAudio(){}} as unknown as LegacyGraphic,before=g.syncAudio;
 installAESignatureLevel(g,{id:'BTV_Ce_Soir',libraryVersion:'1.7.0'});assert.equal(g.syncAudio,before);assert.equal(hasAESignature('BTV_Ce_Soir'),false);
 installAESignatureLevel(g,{id:'BTV_Renvoi',libraryVersion:'2'});assert.equal(g.syncAudio,before);
});

for(const [id,outSeconds,early] of [['BTV_Evenement',3.32,4.4],['BTV_Semainier',3.08,3]] as const){
 test(`${id}: complete OUT audio remains on the global native clock, never restarts or stretches`,async()=>{
  const {createAETemplate}=await import(new URL('../public/library/v1.7.0/_shared/lottie-ae-engine-v2.mjs',import.meta.url).href);
  const {CONFIG}=await import(new URL(`../public/library/v1.7.0/${id}/config.mjs`,import.meta.url).href);
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'HTMLElement');
  Object.defineProperty(globalThis,'HTMLElement',{configurable:true,value:class {}});
  let Native:any;try{Native=createAETemplate({},completeAEOutConfig(CONFIG,id),new URL(`../public/library/v1.7.0/${id}/graphic-v2.mjs`,import.meta.url).href);}
  finally{if(descriptor)Object.defineProperty(globalThis,'HTMLElement',descriptor);else Reflect.deleteProperty(globalThis,'HTMLElement');}
  for(const mode of ['duration','manual'])for(const outAt of [early,CONFIG.defaults._out_duration_seconds,28]){
   let plays=0,pauses=0;const node={duration:100,currentTime:0,muted:false,volume:1,play:async()=>{plays++;},pause:()=>{pauses++;}};
   const g=Object.assign(Object.create(Native.prototype),{data:{_out_mode:mode,_audio_volume:.35},phase:'out',outAt,muted:false,audio:[{node,offset:0}],errors:[]});
   installAESignatureLevel(g,{id,libraryVersion:'1.7.0'});
   for(const seconds of [outAt,outAt+outSeconds-.04]){
    g.syncAudio(seconds,true);assert.equal(node.currentTime,seconds);assert.equal(node.volume,.35);
   }
   assert.equal(plays,2);assert.equal(pauses,0);
   node.duration=outAt+outSeconds-.04;g.syncAudio(node.duration,true);
   assert.equal(plays,2);assert.equal(pauses,1,'A finished source must not loop to fill the longer OUT');
  }
 });

 test(`${id}: complete OUT export and supplemental voice use the full new endpoint without shifting source audio`,()=>{
  for(const mode of ['duration','manual'])for(const outAt of [early,28]){
   const data={_audio_enabled:true,_audio_volume:.35,_out_mode:mode,_out_duration_seconds:outAt},timeline=makeTimeline(id,data,{},outAt);
   assert.equal(timeline.duration,(Math.round(outAt*25)+Math.round(outSeconds*25))/25);
   const prepared={graphic:{},data,timeline,tracks:{audio:{clips:[{type:'audio',url:'audio.wav',start:0,end:100,length:100}],loop:false}}} as unknown as PreparedGraphic;
   const [event]=audioEvents(prepared,id,false);
   assert.deepEqual({at:event.at,start:event.start,duration:event.duration,rate:event.rate},{at:0,start:0,duration:timeline.duration,rate:1});
   assert.equal(event.gain(outAt),.35);assert.equal(event.gain(timeline.duration),.35,'No extra artificial signature OUT fade');
   prepared.tracks.audio.clips[0].length=outAt+3;
   assert.equal(audioEvents(prepared,id,false)[0].duration,outAt+3,'The added tail must not extend or repeat a shorter audio source');
   const plan={url:'voice.wav',start:2,end:3,duration:1,delay:timeline.duration-1,volume:.6},buffer={} as AudioBuffer;
   assert.doesNotThrow(()=>assertSupplementalVoiceFits(plan,timeline.duration));
   assert.throws(()=>assertSupplementalVoiceFits(plan,outAt+3),/Aucun son n’a été coupé/,'The former 3s endpoint would reject this complete voice');
   prepared.supplementalVoice={plan,buffer};
   const voice=audioEvents(prepared,id,false)[0];
   assert.deepEqual({at:voice.at,start:voice.start,duration:voice.duration,rate:voice.rate},{at:plan.delay,start:2,duration:1,rate:1});
   assert.equal(voice.buffer,buffer);assert.equal(voice.gain(timeline.duration),.6);
   prepared.supplementalVoice.plan={...plan,delay:plan.delay+.04};
   assert.throws(()=>audioEvents(prepared,id,false),/Aucun son n’a été coupé/,'A voice extending beyond the new endpoint is still rejected, never truncated');
  }
 });
}
