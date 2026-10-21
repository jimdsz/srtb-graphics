/** Standalone causal fixture, updated after the authorized UI fix.
 * The initial 7-characterization run is described in the diagnostic report.
 * No file audio, browser or encoder. Not part of tests/*.test.ts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {getTemplate,templateDefaults} from '../src/studio/domain';
import {activateMedia,markedRange} from '../src/studio/media-trim';
import {voiceRangePatch,voiceSourcePatch} from '../src/studio/voice-timing-model';
import {baVoiceDucking,baVoicePlacement} from '../src/studio/ba-voice-placement';
import {decodedVoiceDuration} from '../src/studio/voice-duration';
import {previewData} from '../src/studio/preview-data';
import {engineData} from '../src/studio/presentation';
import {audioEvents} from '../src/studio/video/audio';
import {makeTimeline} from '../src/studio/video/timeline';
import type {PreparedGraphic} from '../src/studio/video/engine';
import VoiceTimingSettings from '../src/studio/VoiceTimingSettings';

const root=resolve(import.meta.dirname,'..'),template=getTemplate('BTV_BA_1P');
const adapted=await import(pathToFileURL(resolve(root,'public/studio-engines/ba-text-v2/audio.mjs')).href);
const generated=JSON.parse(await readFile(resolve(root,'src/studio/ba-editor.generated.json'),'utf8'));
const voiceURL='data:text/javascript;base64,'+Buffer.from(generated.voiceLayout).toString('base64');
const clockURL='data:text/javascript;base64,'+Buffer.from(generated.audioClock).toString('base64');
const portable=await import('data:text/javascript;base64,'+Buffer.from(generated.audio.replace("'./studio-voice-layout.mjs'",JSON.stringify(voiceURL)).replace("'./studio-audio-clock.mjs'",JSON.stringify(clockURL))).toString('base64'));
const fitted=baVoicePlacement(3.6,'fit-complete');
const before={...templateDefaults(template),_out_mode:'manual',_audio_bed_enabled:false,_audio_voice_url:{url:'blob:fixture-before',name:'Fixture before',mimeType:'audio/mpeg'},_audio_voice_enabled:true,
  _studio_ba_voice_fit:'fit-complete',_audio_voice_in_seconds:0,_audio_voice_out_seconds:3.6,_audio_voice_intro_offset_seconds:fitted.intro,_audio_voice_outro_offset_seconds:fitted.outro};
const replacement={url:'blob:fixture-after',name:'Fixture after',mimeType:'audio/mpeg'};
const patch=voiceSourcePatch(template,before,replacement),changed={...before,...patch},active={...changed,...activateMedia('_audio_voice_url')};
// Representative fake PCM counts matching the rounded duration reported by root.
// These are not a new measurement of, or attestation about, the user's MP3.
const decoded={length:166765,sampleRate:48000,duration:166765/48000,numberOfChannels:1},containerDuration=3.47954;
const duration=decodedVoiceDuration(decoded);
function html(data:typeof before|typeof active){
  const old=Object.getOwnPropertyDescriptor(globalThis,'window');Object.defineProperty(globalThis,'window',{configurable:true,value:{}});
  try{return renderToStaticMarkup(createElement(VoiceTimingSettings,{template,data,media:[],onChange(){},disabled:false}));}
  finally{if(old)Object.defineProperty(globalThis,'window',old);else Reflect.deleteProperty(globalThis,'window');}
}
function mockContext(){
  const gain=()=>({value:0,setValueAtTime(){},cancelScheduledValues(){},linearRampToValueAtTime(){}});
  return {state:'suspended',currentTime:0,sampleRate:48000,destination:{},createGain:()=>({gain:gain(),connect(){},disconnect(){}})};
}

test('corrected source replacement disables and zeroes marks, removes old fit consent and preserves cues',()=>{
  assert.deepEqual(patch,{_audio_voice_url:replacement,_audio_voice_in_seconds:0,_audio_voice_out_seconds:0,_audio_voice_enabled:false,_studio_ba_voice_fit:'manual'});
  assert.equal(changed._studio_ba_voice_fit,'manual');assert.equal(changed._audio_voice_intro_offset_seconds,fitted.intro);assert.equal(changed._audio_voice_outro_offset_seconds,fitted.outro);
  assert.doesNotMatch(html(changed),/Placement complet accepté/);
  assert.match(html(active),/Repère OUT de la voix non défini/);
  assert.equal(before._audio_voice_out_seconds,3.6,'Original data is not mutated by these pure diagnostics.');
});

test('reader OUT=0 is an HTML-duration sentinel, but the BA source plan rejects it before decoding',async()=>{
  const reader=await readFile(resolve(root,'src/studio/MediaTrim.tsx'),'utf8');
  assert.match(reader,/end\?timeLabel\(end\):'fin du fichier'/);assert.match(reader,/\(end\|\|duration\)-start/);
  assert.equal((Number(active._audio_voice_out_seconds)||containerDuration)-Number(active._audio_voice_in_seconds),containerDuration);
  for(const module of [adapted,portable]){
    assert.deepEqual(module.audioPlan(changed).voice,[]);
    assert.throws(()=>module.audioPlan(active),{code:'AUDIO_CONFIG'});
  }
});

test('initial muted preview can prepare an image with voice disabled, whereas audible preview and export data reject the same zero OUT',()=>{
  const engine=engineData(active,true);assert.equal(engine._audio_voice_out_seconds,0);assert.equal(engine._studio_ba_voice_fit,'manual');
  const quiet=previewData(engine,true,true,false),audible=previewData(engine,false,true,false),previouslyPrepared=previewData(engine,true,true,true);
  assert.equal(quiet._audio_voice_enabled,false);assert.equal(audible._audio_voice_enabled,true);assert.equal(previouslyPrepared._audio_voice_enabled,true);
  for(const module of [adapted,portable]){
    assert.deepEqual(module.audioPlan(quiet).voice,[]);
    for(const candidate of [audible,previouslyPrepared,engine])assert.throws(()=>module.audioPlan(candidate),{code:'AUDIO_CONFIG'});
  }
});

test('invalid reactivation is transactional: no source load and no audible fallback to a silently corrected passage',async()=>{
  for(const module of [adapted,portable]){
    const engine=new module.AudioEngine({context:mockContext(),baseUrl:'https://fixture.invalid/graphic.mjs'});let loads=0;
    engine._load=async()=>{loads++;throw Error('No actual source may be loaded in this diagnostic.');};
    try{
      await engine.prepare(changed);const committed=engine.config;
      await assert.rejects(engine.prepare(active),{code:'AUDIO_CONFIG'});
      assert.equal(loads,0);assert.equal(engine.config,committed);assert.equal(engine.config._audio_voice_enabled,false);assert.deepEqual(engine.plan.voice,[]);
    }finally{engine.dispose();}
  }
});

test('an exact decoded end and the existing explicit manual-range transition preserve cue positions and full export duration',()=>{
  const resolved={...active,...voiceRangePatch(template,active,{start:0,end:duration})};
  assert.equal(resolved._studio_ba_voice_fit,'manual');assert.equal(resolved._audio_voice_intro_offset_seconds,fitted.intro);assert.equal(resolved._audio_voice_outro_offset_seconds,fitted.outro);
  assert.equal(resolved._audio_voice_out_seconds,duration);assert.notEqual(duration,containerDuration);
  for(const module of [adapted,portable]){
    const plan=module.audioPlan(resolved);assert.equal(plan.voice.length,2);
    const prepared={data:resolved,tracks:{},timeline:makeTimeline('BTV_BA_1P',resolved,{},12),graphic:{audio:{plan,buffers:{voice:{buffer:decoded}}}}} as unknown as PreparedGraphic;
    const voices=audioEvents(prepared,'BTV_BA_1P',false);
    assert.equal(voices.length,2);assert.ok(Math.abs(voices[0].at-fitted.intro)<1e-12);assert.ok(Math.abs(voices[1].at-(12+fitted.outro-64.8))<1e-12);
    for(const voice of voices){assert.equal(voice.start,0);assert.equal(voice.rate,1);assert.ok(Math.abs(voice.duration-duration)<1e-12);}
  }
});

test('container-duration substitution exceeds decoded audio tolerance; frame-rounded Fin ici is not a whole-file substitute either',async()=>{
  assert.ok(containerDuration-duration>0.005);assert.ok(containerDuration-duration>1/decoded.sampleRate);
  assert.equal(markedRange('end',containerDuration,0,0,containerDuration).end,3.44);assert.ok(duration-3.44>0.034);
  for(const module of [adapted,portable]){
    const engine=new module.AudioEngine({context:mockContext(),baseUrl:'https://fixture.invalid/graphic.mjs'});
    engine._load=async(url:string)=>({url,buffer:decoded});
    try{
      const exact={...active,...voiceRangePatch(template,active,{start:0,end:duration})};
      await engine.prepare(exact);assert.equal(engine.config._audio_voice_out_seconds,duration);
      await assert.rejects(engine.prepare({...exact,_audio_voice_out_seconds:containerDuration}),{code:'AUDIO_DURATION'});
      assert.equal(engine.config._audio_voice_out_seconds,duration,'A failed metadata-based proposal cannot replace a valid exact one.');
    }finally{engine.dispose();}
  }
});

test('complete UI validation now reports mismatched stored fit offsets exactly as the shared audio-duck contract',()=>{
  const stale={...active,_studio_ba_voice_fit:'fit-complete',_audio_voice_out_seconds:duration};
  assert.doesNotThrow(()=>baVoicePlacement(duration,'fit-complete',{intro:fitted.intro,outro:fitted.outro}));
  assert.match(html(stale),/Le placement de la voix adaptée a changé/);
  assert.throws(()=>baVoiceDucking(stale),/Le placement de la voix adaptée a changé/);
  for(const module of [adapted,portable])assert.throws(()=>module.audioPlan(stale),/Le placement de la voix adaptée a changé/);
});
