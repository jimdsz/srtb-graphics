import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {baVoicePlacement,baVoiceDucking} from '../src/studio/ba-voice-placement';
import {audioEvents} from '../src/studio/video/audio';
import {makeTimeline} from '../src/studio/video/timeline';
import type {PreparedGraphic} from '../src/studio/video/engine';
import {decodedVoiceDuration} from '../src/studio/voice-duration';
const root=resolve(import.meta.dirname,'..');
const native=await import(pathToFileURL(resolve(root,'public/library/v1.7.0/BTV_BA_1P/audio.mjs')).href);
const adapted=await import(pathToFileURL(resolve(root,'public/studio-engines/ba-text-v2/audio.mjs')).href);
const generated=JSON.parse(await readFile(resolve(root,'src/studio/ba-editor.generated.json'),'utf8'));
const voiceURL='data:text/javascript;base64,'+Buffer.from(generated.voiceLayout).toString('base64');
const clockURL='data:text/javascript;base64,'+Buffer.from(generated.audioClock).toString('base64');
const portable=await import('data:text/javascript;base64,'+Buffer.from(generated.audio.replace("'./studio-voice-layout.mjs'",JSON.stringify(voiceURL)).replace("'./studio-audio-clock.mjs'",JSON.stringify(clockURL))).toString('base64'));
test('legacy audio plan is strictly unchanged unless the complete-placement option is explicit',()=>{
  assert.deepEqual(adapted.audioPlan(adapted.AUDIO_DEFAULTS),native.audioPlan(native.AUDIO_DEFAULTS));
  assert.throws(()=>baVoicePlacement(3.526541667,'source'),/explicitement/);
  assert.equal(baVoiceDucking({...adapted.AUDIO_DEFAULTS,_studio_ba_voice_fit:'source'}),undefined);
});
test('full decoded MP3 preserves every sample and fits before body and end fade',()=>{
  const duration=169274/48000,fit=baVoicePlacement(duration,'fit-complete');
  assert.equal(fit.duration,duration);assert.equal(fit.introEnd,4.36);assert.equal(fit.outro,68.48);assert.ok(fit.outroEnd+.4<72.92);
  const config={...adapted.AUDIO_DEFAULTS,_studio_ba_voice_fit:'fit-complete',_audio_voice_in_seconds:0,_audio_voice_out_seconds:duration,_audio_voice_intro_offset_seconds:fit.intro,_audio_voice_outro_offset_seconds:fit.outro};
  const plan=adapted.audioPlan(config);assert.deepEqual(plan,portable.audioPlan(config));
  for(const item of plan.voice){assert.equal(item.sourceIn,0);assert.equal(item.sourceOut,duration);assert.ok(Math.abs(item.mainOut-item.mainIn-duration)<1e-12);}
  for(const [index,at,end]of [[0,fit.intro,fit.introEnd],[1,fit.outro,fit.outroEnd]]){assert.equal(adapted.envelopeDbAt(plan.bed[index].envelope,at),-10);assert.equal(adapted.envelopeDbAt(plan.bed[index].envelope,end),-10);assert.ok(Math.abs(adapted.envelopeDbAt(plan.bed[index].envelope,end+.4))<1e-10);}
});
test('adapted plan covers the 4.04s limit with clamped attack, rejects larger or mutated offsets',()=>{
  const fit=baVoicePlacement(4.04,'fit-complete'),config={_studio_ba_voice_fit:'fit-complete',_audio_voice_enabled:true,_audio_voice_in_seconds:0,_audio_voice_out_seconds:4.04,_audio_voice_intro_offset_seconds:fit.intro,_audio_voice_outro_offset_seconds:fit.outro};
  const duck=baVoiceDucking(config)!;assert.equal(duck.intro[0][0],0);assert.ok(Math.abs(duck.outro.at(-1)![0]-72.92)<1e-12);
  assert.throws(()=>baVoicePlacement(4.04001,'fit-complete'),/4,04/);assert.throws(()=>baVoiceDucking({...config,_audio_voice_intro_offset_seconds:1.92}),/changé/);
  assert.equal(baVoiceDucking({...config,_audio_voice_enabled:false,_audio_voice_out_seconds:.04}),undefined);
});
test('export events retain complete passages, 1x speed, translated OUT and shared dynamic duck',()=>{
  const duration=3.526541667,fit=baVoicePlacement(duration,'fit-complete'),data={...adapted.AUDIO_DEFAULTS,_studio_ba_voice_fit:'fit-complete',_out_mode:'duration',_out_duration_seconds:7.6,_audio_voice_in_seconds:0,_audio_voice_out_seconds:duration,_audio_voice_intro_offset_seconds:fit.intro,_audio_voice_outro_offset_seconds:fit.outro};
  const plan=adapted.audioPlan(data),buffer={duration:30},prepared={data,tracks:{},timeline:makeTimeline('BTV_BA_1P',data,7.6),graphic:{audio:{plan,buffers:{bed:{buffer},voice:{buffer}}}}} as unknown as PreparedGraphic;
  const events=audioEvents(prepared,'BTV_BA_1P',false),voices=events.slice(-2);
  assert.equal(voices.length,2);for(const event of voices){assert.ok(Math.abs(event.duration-duration)<1e-12);assert.equal(event.rate,1);assert.equal(event.start,0);}
  assert.equal(voices[0].at,fit.intro);assert.ok(Math.abs(voices[1].at-(7.6+68.48-64.8))<1e-12);
  const bedOut=events[1];assert.ok(Math.abs(bedOut.gain(voices[1].at+duration/2)-10**(-10/20))<1e-12);
});
test('whole voice duration is exact decoded sample count, not rounded container metadata',()=>{
  assert.equal(decodedVoiceDuration({length:169274,sampleRate:48000}),169274/48000);
  assert.notEqual(decodedVoiceDuration({length:169274,sampleRate:48000}),3.53);
  for(const buffer of [{length:0,sampleRate:48000},{length:1.5,sampleRate:48000},{length:48000,sampleRate:0},{length:48000*601,sampleRate:48000}])assert.throws(()=>decodedVoiceDuration(buffer));
});

test('disabled BA replacement with unset marks has no voice insertions; reactivation remains strict in both v2 editions',()=>{
  const silent={...adapted.AUDIO_DEFAULTS,_audio_voice_enabled:false,_audio_voice_url:'',_audio_voice_in_seconds:0,_audio_voice_out_seconds:0};
  const copy=structuredClone(silent);
  assert.throws(()=>native.audioPlan(silent),/sortie source/); // frozen v1 is intentionally untouched
  for(const module of [adapted,portable]){
    const plan=module.audioPlan(silent);assert.deepEqual(plan.voice,[]);assert.equal(plan.bed.length,2);
    assert.throws(()=>module.audioPlan({...silent,_audio_voice_enabled:true}),/sortie source/);
    const active=module.audioPlan({...silent,_audio_voice_enabled:true,_audio_voice_out_seconds:.5});
    assert.equal(active.voice.length,2);for(const insertion of active.voice)assert.equal(insertion.sourceOut,.5);
  }
  assert.deepEqual(silent,copy);
});

test('disabled voice preparation neither loads nor decodes a file; failed reactivation keeps the silent committed configuration',async()=>{
  for(const module of [adapted,portable]){
    const gain=()=>({value:0,setValueAtTime(){},cancelScheduledValues(){},linearRampToValueAtTime(){}});
    const context={state:'suspended',currentTime:0,sampleRate:48000,destination:{},createGain:()=>({gain:gain(),connect(){},disconnect(){}})};
    const engine=new module.AudioEngine({context,baseUrl:'https://studio.example/graphic.mjs'});let loads=0;
    engine._load=async(url:string)=>{loads++;return {url,buffer:{duration:1,length:48000,numberOfChannels:1,sampleRate:48000}};};
    try{
      await engine.prepare({_audio_bed_enabled:false,_audio_voice_enabled:false,_audio_voice_url:'voice.mp3',_audio_voice_in_seconds:0,_audio_voice_out_seconds:0});
      assert.equal(loads,0);assert.deepEqual(engine.plan.voice,[]);assert.deepEqual(engine.buffers,{});
      await assert.rejects(engine.prepare({_audio_voice_enabled:true}),/sortie source/);
      assert.equal(loads,0);assert.equal(engine.config._audio_voice_enabled,false);assert.deepEqual(engine.plan.voice,[]);
      await engine.prepare({_audio_voice_enabled:true,_audio_voice_out_seconds:.5});assert.equal(loads,1);assert.equal(engine.plan.voice.length,2);
    }finally{engine.dispose();}
  }
});
