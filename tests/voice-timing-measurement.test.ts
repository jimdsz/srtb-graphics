import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {broadcastTemplates,getTemplate,templateDefaults} from '../src/studio/domain';
import type {ProjectData} from '../src/studio/domain';
import {voiceRangePatch,voiceSourcePatch,voiceTimingWarning} from '../src/studio/voice-timing-model';
import {createVoiceTimingMeasurement,sameVoiceTimingTarget} from '../src/studio/voice-timing-measurement';
import type {VoiceTimingMeasureState,VoiceTimingMeasureTarget} from '../src/studio/voice-timing-measurement';
import {beginLocalFile,promoteVerifiedLocalData} from '../src/studio/local-media';
import {baVoicePlacement} from '../src/studio/ba-voice-placement';
import VoiceTimingSettings from '../src/studio/VoiceTimingSettings';

const template=getTemplate('BTV_BA_1P'),source={url:'blob:fixture-voice-a',name:'Synthetic fixture',mimeType:'audio/mpeg'},duration=166765/48000;
function deferred<T=number>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
const data=():ProjectData=>({...templateDefaults(template),_audio_voice_url:source,_audio_voice_enabled:false,_studio_ba_voice_fit:'manual',_audio_voice_in_seconds:0,_audio_voice_out_seconds:0,_audio_voice_intro_offset_seconds:.76,_audio_voice_outro_offset_seconds:68.48});
function harness(measure:Parameters<typeof createVoiceTimingMeasurement>[0]['measure']){
  let target:VoiceTimingMeasureTarget={template,data:data(),disabled:false};const patches:ProjectData[]=[],states:VoiceTimingMeasureState[]=[];
  const task=createVoiceTimingMeasurement({current:()=>target,apply:patch=>{patches.push(patch);target={...target,data:{...target.data,...patch}};},onChange:state=>states.push(state),measure});
  return {task,patches,states,target:()=>target,replace:(next:Partial<VoiceTimingMeasureTarget>)=>{target={...target,...next};}};
}
function browser(run:()=>void){const previous=Object.getOwnPropertyDescriptor(globalThis,'window');Object.defineProperty(globalThis,'window',{configurable:true,value:{}});try{run();}finally{if(previous)Object.defineProperty(globalThis,'window',previous);else Reflect.deleteProperty(globalThis,'window');}}

test('new BA source invalidates only accepted fit, preserves cue offsets and does not activate the new voice',()=>{
  const before={...data(),_studio_ba_voice_fit:'fit-complete',_audio_voice_enabled:true,_audio_voice_in_seconds:.5,_audio_voice_out_seconds:4.1},copy=structuredClone(before),next={...source,url:'blob:fixture-voice-b'};
  const patch=voiceSourcePatch(template,before,next),after={...before,...patch};
  assert.deepEqual(patch,{_audio_voice_url:next,_audio_voice_enabled:false,_audio_voice_in_seconds:0,_audio_voice_out_seconds:0,_studio_ba_voice_fit:'manual'});
  for(const key of ['_audio_voice_intro_offset_seconds','_audio_voice_outro_offset_seconds','_audio_voice_gain','_audio_bed_gain'])assert.equal(after[key],before[key]);
  assert.deepEqual(before,copy);
  for(const mode of ['source','manual'])assert.equal('_studio_ba_voice_fit' in voiceSourcePatch(template,{...before,_studio_ba_voice_fit:mode},next),false);
});

test('same URL is not a replacement, and other models retain their full-file sentinel contract',()=>{
  const before={...data(),_studio_ba_voice_fit:'fit-complete'};assert.deepEqual(voiceSourcePatch(template,before,{...source}),{_audio_voice_url:source});
  for(const other of broadcastTemplates.filter(value=>value.id!==template.id)){
    const patch=voiceSourcePatch(other,templateDefaults(other),source);assert.equal(patch._audio_voice_enabled,false);assert.equal(patch._audio_voice_end_seconds,0);assert.equal('_studio_ba_voice_fit'in patch,false);
  }
});

test('whole decoded duration is applied exactly once, with no activation, consent or offset patch',async()=>{
  const result=deferred();let calls=0;
  const h=harness(async(_source,_controller,progress)=>{calls++;progress?.({phase:'reading',bytes:1024,total:2048});progress?.({phase:'decoding',bytes:2048,total:2048});return result.promise;});
  const first=h.task.run(),second=h.task.run();assert.equal(first,second);assert.equal(h.task.snapshot().busy,true);await Promise.resolve();assert.equal(calls,1);
  result.resolve(duration);await first;
  assert.deepEqual(h.patches,[{_audio_voice_in_seconds:0,_audio_voice_out_seconds:duration}]);assert.equal(h.target().data._audio_voice_enabled,false);assert.equal(h.task.snapshot().phase,'success');
  assert.match(h.task.snapshot().message,/3\.474271 s décodées/);assert.equal(h.states.find(state=>state.phase==='reading'&&state.progress)?.progress?.bytes,1024);
  assert.equal(h.states.find(state=>state.phase==='decoding')?.progress?.bytes,2048);
  for(const key of ['_audio_voice_enabled','_audio_voice_intro_offset_seconds','_audio_voice_outro_offset_seconds','humanValidated','attested'])assert.equal(key in h.patches[0],false,key);
});

test('measurement of a previous accepted fit uses the existing manual-range transition without moving cues',async()=>{
  const h=harness(async()=>duration);h.replace({data:{...h.target().data,_studio_ba_voice_fit:'fit-complete'}});await h.task.run();
  assert.equal(h.patches[0]._studio_ba_voice_fit,'manual');assert.equal(h.target().data._audio_voice_intro_offset_seconds,.76);assert.equal(h.target().data._audio_voice_outro_offset_seconds,68.48);
});

test('explicit cancellation keeps all previous marks and cannot start a second decoder while the first settles',async()=>{
  const result=deferred();let controller!:AbortController,calls=0;
  const h=harness(async(_source,task)=>{controller=task;calls++;return result.promise;}),pending=h.task.run();await Promise.resolve();h.task.cancel();
  assert.equal(controller.signal.aborted,true);assert.equal(h.task.snapshot().phase,'cancelling');assert.equal(h.task.run(),pending);
  result.resolve(duration);await pending;assert.equal(calls,1);assert.equal(h.patches.length,0);assert.equal(h.task.snapshot().phase,'cancelled');assert.equal(h.target().data._audio_voice_out_seconds,0);
});

test('changed source, marks, cue, mode, activation or disabled state rejects a late result, even before the React effect checks it',async()=>{
  const changes=[{_audio_voice_url:{...source,url:'blob:voice-b'}},{_audio_voice_out_seconds:1},{_audio_voice_intro_offset_seconds:2},{_studio_ba_voice_fit:'source'},{_audio_voice_enabled:true}];
  for(const change of changes){const result=deferred(),h=harness(async()=>result.promise),pending=h.task.run();h.replace({data:{...h.target().data,...change}});result.resolve(duration);await pending;assert.equal(h.patches.length,0);assert.equal(h.task.snapshot().phase,'cancelled');}
  const result=deferred(),h=harness(async()=>result.promise),pending=h.task.run();h.replace({disabled:true});h.task.check();result.resolve(duration);await pending;assert.equal(h.patches.length,0);
});

test('unrelated text changes preserve the measure, and explicit decode failures preserve previous marks and permit retry',async()=>{
  const result=deferred(),h=harness(async()=>result.promise),pending=h.task.run();h.replace({data:{...h.target().data,_titre_ligne_1:'Retouched title'}});h.task.check();result.resolve(duration);await pending;assert.equal(h.patches.length,1);
  let bad=true;const retry=harness(async()=>{if(bad)throw Error('Audio illisible');return duration;});await retry.task.run();assert.equal(retry.task.snapshot().phase,'error');assert.equal(retry.patches.length,0);assert.match(retry.task.snapshot().message,/Audio illisible/);bad=false;await retry.task.run();assert.equal(retry.patches.length,1);
});

test('unmount cleanup suppresses a late result and waits for decoder settlement',async()=>{
  const result=deferred(),h=harness(async()=>result.promise),pending=h.task.run();await Promise.resolve();let cleaned=false;
  const cleanup=h.task.dispose().then(()=>{cleaned=true;});await Promise.resolve();assert.equal(cleaned,false);const observations=h.states.length;
  result.resolve(duration);await cleanup;await pending;assert.equal(h.patches.length,0);assert.equal(h.states.length,observations);await h.task.run();assert.equal(h.patches.length,0);
});

test('missing or non-audio source and invalid decoded duration never apply a guessed range',async()=>{
  let calls=0;const h=harness(async()=>{calls++;return duration;});h.replace({data:{...data(),_audio_voice_url:''}});await h.task.run();assert.equal(calls,0);assert.equal(h.task.snapshot().phase,'error');
  for(const invalid of [NaN,Infinity,-1,0,.01,601]){const h=harness(async()=>invalid);await h.task.run();assert.equal(h.patches.length,0);assert.equal(h.task.snapshot().phase,'error');}
});

test('real fingerprint promotion preserves pending measurement instead of treating the verified reference as another file',async()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'Worker'),hash=deferred<string>(),decoded=deferred();
  class HashWorker{onmessage:((event:{data:{hash:string}})=>void)|null=null;onerror=null;postMessage(message:{type:string}){if(message.type==='hash')void hash.promise.then(hash=>this.onmessage?.({data:{hash}}));}terminate(){}}
  Object.defineProperty(globalThis,'Worker',{configurable:true,value:HashWorker});
  try{
    const file=new File(['timing-test-synthetic'],'fixture.wav',{type:'audio/wav'}),selection=beginLocalFile(file,()=>{}),h=harness(async()=>decoded.promise);
    h.replace({data:{...data(),_audio_voice_url:selection.descriptor}});const baseline=h.target(),pending=h.task.run();await Promise.resolve();
    hash.resolve(createHash('sha256').update('timing-test-synthetic').digest('hex'));await selection.verified;
    h.replace({data:promoteVerifiedLocalData(template,h.target().data)});assert.equal(sameVoiceTimingTarget(baseline,h.target()),true);h.task.check();
    decoded.resolve(duration);await pending;assert.equal(h.patches.length,1);assert.match(String((h.target().data._audio_voice_url as typeof source).url),/^local-media:/);
  }finally{if(previous)Object.defineProperty(globalThis,'Worker',previous);else Reflect.deleteProperty(globalThis,'Worker');}
});

test('BA warning distinguishes undefined OUT and checks stale accepted-fit offsets with the same duck contract as the engine',()=>{
  assert.match(voiceTimingWarning(template,data()),/Repère OUT.*non défini/);assert.doesNotMatch(voiceTimingWarning(template,data()),/au moins 0,04/);
  const fit=baVoicePlacement(3.6,'fit-complete'),stale={...data(),_audio_voice_enabled:true,_studio_ba_voice_fit:'fit-complete',_audio_voice_out_seconds:duration,_audio_voice_intro_offset_seconds:fit.intro,_audio_voice_outro_offset_seconds:fit.outro};
  assert.match(voiceTimingWarning(template,stale),/placement.*changé/);assert.equal(voiceTimingWarning(template,{...stale,...voiceRangePatch(template,stale,{end:duration})}),'');
});

test('React UI offers stable explicit decode action and labels BA source audition separately; non-BA retains zero sentinel',()=>browser(()=>{
  const html=renderToStaticMarkup(createElement(VoiceTimingSettings,{template,data:data(),media:[],onChange(){},disabled:false}));
  assert.match(html,/Utiliser le fichier entier \(durée décodée\)/);assert.match(html,/OUT = 0 signifie/);assert.doesNotMatch(html,/Placement complet accepté/);
  const trim=readFileSync(new URL('../src/studio/MediaTrim.tsx',import.meta.url),'utf8');assert.match(trim,/explicitEnd&&end===0/);assert.match(trim,/Écouter le fichier source/);assert.match(trim,/métadonnées/);
  const component=readFileSync(new URL('../src/studio/VoiceTimingSettings.tsx',import.meta.url),'utf8');assert.match(component,/selectionAction=/);assert.match(component,/task.current\?\.check\(\)/);assert.match(component,/old\?\.dispose\(\)/);assert.match(component,/voiceSourcePatch\(template,latest.current.data,next\)/);
  const fields=readFileSync(new URL('../src/studio/Fields.tsx',import.meta.url),'utf8');assert.match(fields,/name==='_audio_voice_url'\?voiceSourcePatch/);
  for(const other of broadcastTemplates.filter(value=>value.id!==template.id))assert.match(renderToStaticMarkup(createElement(VoiceTimingSettings,{template:other,data:templateDefaults(other),media:[],onChange(){},disabled:false})),/fin réellement décodée/);
}));
