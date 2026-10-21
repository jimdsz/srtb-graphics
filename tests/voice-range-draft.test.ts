import test from 'node:test';
import assert from 'node:assert/strict';
import {createVoiceRangeDraft,voiceRangeReady} from '../src/studio/voice-range-draft';
import {fingerprintStream} from '../src/studio/local-fingerprint-stream';

const source={url:'blob:voice-a',name:'Voix.wav',mimeType:'audio/wav'};
function deferred(){let resolve!:(value:number)=>void,reject!:(cause:Error)=>void;const promise=new Promise<number>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}

test('a new voice or changed source never inherits an implicit one-second passage',()=>{
  const draft=createVoiceRangeDraft();assert.equal(draft.snapshot().end,0);assert.equal(voiceRangeReady(draft.snapshot()),false);
  draft.select(source);assert.equal(draft.snapshot().end,0);assert.equal(voiceRangeReady(draft.snapshot()),false);
  draft.manual('end',1);assert.equal(voiceRangeReady(draft.snapshot()),true);
  draft.select({...source,url:'blob:voice-b'});assert.equal(draft.snapshot().start,0);assert.equal(draft.snapshot().end,0);assert.equal(voiceRangeReady(draft.snapshot()),false);
});

test('whole-file intent locks the old passage synchronously, then applies the exact result without human validation',async()=>{
  const draft=createVoiceRangeDraft({source,start:0,end:1}),result=deferred();let calls=0;
  const pending=draft.measure(async()=>{calls++;return result.promise;});
  assert.equal(draft.snapshot().status,'measuring');assert.match(draft.snapshot().message,/suspendues/);assert.equal(voiceRangeReady(draft.snapshot()),false);
  draft.manual('end',2);assert.equal(draft.snapshot().end,1,'A queued input cannot overwrite the pending whole-file request.');
  await draft.measure(async()=>{calls++;return 99;});assert.equal(calls,1);
  result.resolve(172800/48000);await pending;
  assert.equal(draft.snapshot().status,'whole');assert.equal(draft.snapshot().start,0);assert.equal(draft.snapshot().end,3.6);assert.equal(voiceRangeReady(draft.snapshot()),true);
  assert.match(draft.snapshot().message,/3\.600000 s/);assert.match(draft.snapshot().message,/Réécoutez/);
  for(const key of ['heard','attested','humanValidated'])assert.equal(key in draft.snapshot(),false);
});

test('same-source renders preserve in-flight measurement and its visible status',async()=>{
  const draft=createVoiceRangeDraft(),result=deferred();draft.select(source);
  let controller:AbortController|undefined;const pending=draft.measure(async(_source,task)=>{controller=task;return result.promise;});
  const snapshot=draft.snapshot();let notifications=0;const off=draft.subscribe(()=>notifications++);
  for(let n=0;n<10;n++){draft.select({...source});assert.equal(draft.snapshot(),snapshot);}
  assert.equal(controller?.signal.aborted,false);assert.equal(notifications,0);
  result.resolve(3.6);await pending;assert.equal(notifications,1);assert.equal(draft.snapshot().end,3.6);off();
});

test('selecting a different source aborts the old task and ignores its late result',async()=>{
  const draft=createVoiceRangeDraft({source,start:0,end:1}),old=deferred(),next=deferred();let controller:AbortController|undefined;
  const pending=draft.measure(async(_source,task)=>{controller=task;return old.promise;});
  draft.select({...source,url:'blob:voice-b'});assert.equal(controller?.signal.aborted,true);assert.equal(draft.snapshot().end,0);
  const pendingNext=draft.measure(async()=>next.promise);old.resolve(3.6);await pending;
  assert.equal(draft.snapshot().status,'measuring');assert.equal(draft.snapshot().end,0);
  next.resolve(4.5);await pendingNext;assert.equal(draft.snapshot().end,4.5);
});

test('decode errors stay visible and cannot fall back to the old passage without an explicit manual edit',async()=>{
  const draft=createVoiceRangeDraft({source,start:0,end:1});await draft.measure(async()=>{throw Error('Fichier illisible');});
  assert.equal(draft.snapshot().status,'error');assert.equal(draft.snapshot().message,'Fichier illisible');assert.equal(draft.snapshot().end,1);assert.equal(voiceRangeReady(draft.snapshot()),false);
  draft.manual('end',2.5);assert.equal(draft.snapshot().status,'manual');assert.equal(voiceRangeReady(draft.snapshot()),true);
  await draft.measure(async()=>3.6);assert.equal(draft.snapshot().status,'whole');assert.equal(draft.snapshot().end,3.6);
});

test('explicit interruption or session abortion is visible, non-validating and retryable',async()=>{
  const draft=createVoiceRangeDraft({source,start:0,end:1}),result=deferred();let controller:AbortController|undefined;
  const pending=draft.measure(async(_source,task)=>{controller=task;return result.promise;});
  draft.cancel();assert.equal(controller?.signal.aborted,true);assert.equal(draft.snapshot().status,'error');assert.equal(voiceRangeReady(draft.snapshot()),false);
  result.resolve(3.6);await pending;assert.equal(draft.snapshot().status,'error');assert.equal(draft.snapshot().end,1);
  await draft.measure(async(_source,task)=>{task.abort();return 3.6;});assert.equal(draft.snapshot().status,'error');assert.match(draft.snapshot().message,/interrompue/);
  await draft.measure(async()=>3.6);assert.equal(draft.snapshot().end,3.6);
});

test('invalid values and missing sources never permit audition',async()=>{
  const draft=createVoiceRangeDraft();let called=false;await draft.measure(async()=>{called=true;return 3.6;});assert.equal(called,false);
  draft.select(source);
  for(const value of [0,-1,NaN,Infinity]){await draft.measure(async()=>value);assert.equal(voiceRangeReady(draft.snapshot()),false);assert.equal(draft.snapshot().status,'error');}
  draft.manual('end',3.6);draft.manual('start',-1);assert.equal(voiceRangeReady(draft.snapshot()),false);
});

test('real local fingerprint completion does not replace the selected descriptor or pending decoded-range intent',async()=>{
  const previousWorker=Object.getOwnPropertyDescriptor(globalThis,'Worker'),previousWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
  const events=new EventTarget(),hashGate=deferred(),result=deferred();
  class HashWorker{
    onmessage:((event:{data:{progress?:number;hash?:string}})=>void)|null=null;onerror:((cause:unknown)=>void)|null=null;
    controller=new AbortController();
    postMessage(message:{type:string;file:File}){if(message.type!=='hash')return;void hashGate.promise.then(()=>fingerprintStream(message.file,progress=>this.onmessage?.({data:{progress}}),this.controller.signal,async()=>{})).then(hash=>this.onmessage?.({data:{hash}}),cause=>this.onerror?.(cause));}
    terminate(){this.controller.abort();}
  }
  Object.defineProperty(globalThis,'Worker',{configurable:true,value:HashWorker});Object.defineProperty(globalThis,'window',{configurable:true,value:events});
  try{
    const media=await import('../src/studio/local-media');
    const selection=media.beginLocalFile(new File(['synthetic bytes'],'voix.wav',{type:'audio/wav'}),()=>{}),draft=createVoiceRangeDraft();
    draft.select(selection.descriptor);const pending=draft.measure(async()=>result.promise),snapshot=draft.snapshot();
    let renders=0;const unsubscribe=media.subscribeLocalMedia(()=>{renders++;assert.equal(draft.snapshot(),snapshot);});
    hashGate.resolve(0);const verified=await selection.verified;unsubscribe();
    assert.ok(renders>0);assert.match(verified.url,/^local-media:/);assert.match(draft.snapshot().source!.url,/^blob:/);assert.equal(draft.snapshot(),snapshot);assert.equal(voiceRangeReady(draft.snapshot()),false);
    assert.equal(media.localURL(verified.url),selection.descriptor.url);
    result.resolve(3.6);await pending;assert.equal(draft.snapshot().end,3.6);
    events.dispatchEvent(new Event('srtb-local-media-clear'));
  }finally{
    if(previousWorker)Object.defineProperty(globalThis,'Worker',previousWorker);else Reflect.deleteProperty(globalThis,'Worker');
    if(previousWindow)Object.defineProperty(globalThis,'window',previousWindow);else Reflect.deleteProperty(globalThis,'window');
  }
});
