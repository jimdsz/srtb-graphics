import {test,beforeEach,afterEach,mock} from 'node:test';
import assert from 'node:assert/strict';
import {measureVoiceDuration} from '../src/studio/voice-duration';
import type {VoiceDurationProgress} from '../src/studio/voice-duration';
import {sessionState} from '../src/studio/session-state';

const source={url:'/api/graphics/media/00000000-0000-4000-8000-000000000001/content',name:'Annonce.mp3',mimeType:'audio/mpeg'};
const originalContext=globalThis.AudioContext;
let contexts:number,closed:number,decodedBytes:number;
let decode:()=>Promise<{length:number;sampleRate:number}>;
class Context {
  sampleRate=48000;
  constructor(options:{sampleRate:number}){assert.equal(options.sampleRate,48000);contexts++;}
  async decodeAudioData(bytes:ArrayBuffer){decodedBytes=bytes.byteLength;return decode();}
  async close(){closed++;}
}
beforeEach(()=>{sessionState.open();contexts=closed=decodedBytes=0;decode=async()=>({length:169274,sampleRate:48000});Object.assign(globalThis,{AudioContext:Context});});
afterEach(()=>{mock.restoreAll();Object.assign(globalThis,{AudioContext:originalContext});sessionState.end('logout');});
const response=()=>new Response(new Uint8Array([1,2,3,4]),{headers:{'Content-Type':'audio/mpeg'}});

test('whole-file measurement only reads private bytes, returns exact PCM duration and closes its silent context',async()=>{
  const requests=mock.method(globalThis,'fetch',async(input,init)=>{
    assert.equal(input,source.url);assert.equal(init?.credentials,'same-origin');assert.equal(init?.cache,'no-store');assert.equal(init?.redirect,'error');assert.equal(init?.body,undefined);assert.ok(!init?.method||init.method==='GET');return response();
  });
  assert.equal(await measureVoiceDuration(source,new AbortController()),169274/48000);
  assert.equal(requests.mock.callCount(),1);assert.equal(contexts,1);assert.equal(closed,1);assert.equal(decodedBytes,4);
});

test('measurement rejects remote URLs, HTML fallback and oversized bodies before decoding',async()=>{
  const requests=mock.method(globalThis,'fetch',async()=>new Response('<html/>',{headers:{'Content-Type':'text/html'}}));
  await assert.rejects(measureVoiceDuration({...source,url:'https://other.example/audio.mp3'},new AbortController()),/local ou partagé/);assert.equal(requests.mock.callCount(),0);
  await assert.rejects(measureVoiceDuration(source,new AbortController()),/disponible/);assert.equal(contexts,0);
  requests.mock.mockImplementation(async()=>new Response(null,{headers:{'Content-Type':'audio/mpeg','Content-Length':String(32*1024**2+1)}}));
  await assert.rejects(measureVoiceDuration(source,new AbortController()),/32 Mo/);assert.equal(contexts,0);
});

test('an interrupted decode closes resources, returns no range and remains retryable',async()=>{
  const task=new AbortController();mock.method(globalThis,'fetch',async()=>response());
  decode=async()=>{task.abort(new DOMException('Interrompu','AbortError'));return {length:169274,sampleRate:48000};};
  await assert.rejects(measureVoiceDuration(source,task),{name:'AbortError'});assert.equal(closed,1);
  decode=async()=>({length:169274,sampleRate:48000});
  assert.equal(await measureVoiceDuration(source,new AbortController()),169274/48000);assert.equal(closed,2);
});

test('a stale 401 after a new session cannot end the new session',async()=>{
  const task=new AbortController();mock.method(globalThis,'fetch',async()=>{sessionState.open();return new Response(null,{status:401});});
  await assert.rejects(measureVoiceDuration(source,task),{name:'AbortError'});assert.equal(sessionState.snapshot().ended,false);assert.equal(contexts,0);
});

test('a current 401 closes access, whereas a temporary 503 leaves the valid session intact',async()=>{
  const requests=mock.method(globalThis,'fetch',async()=>new Response(null,{status:503}));
  await assert.rejects(measureVoiceDuration(source,new AbortController()));assert.equal(sessionState.snapshot().ended,false);
  requests.mock.mockImplementation(async()=>new Response(null,{status:401}));
  await assert.rejects(measureVoiceDuration(source,new AbortController()));assert.equal(sessionState.snapshot().ended,true);assert.equal(contexts,0);
});

test('measurement reports actual read bytes then an unestimated decode phase, never a guessed duration',async()=>{
  const progress:VoiceDurationProgress[]=[];mock.method(globalThis,'fetch',async()=>response());
  assert.equal(await measureVoiceDuration(source,new AbortController(),value=>progress.push(value)),169274/48000);
  assert.deepEqual(progress,[{phase:'reading',bytes:0,total:null},{phase:'reading',bytes:4,total:null},{phase:'decoding',bytes:4,total:null}]);
  assert.equal(closed,1);
});
