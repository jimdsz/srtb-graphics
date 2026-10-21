import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createFingerprintQueue} from '../src/studio/local-fingerprint';
import type {FingerprintWorker} from '../src/studio/local-fingerprint';
import {fingerprintStream} from '../src/studio/local-fingerprint-stream';

const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}
class ManualWorker implements FingerprintWorker{
  onmessage:FingerprintWorker['onmessage']=null;onerror:FingerprintWorker['onerror']=null;
  messages:unknown[]=[];terminated=false;
  postMessage(message:unknown){this.messages.push(message);}
  terminate(){this.terminated=true;}
  complete(hash='a'.repeat(64)){this.onmessage?.({data:{hash}});}
}
test('background queue allows one reader, foreground priority nests, cancellation advances the queue',async()=>{
  const workers:ManualWorker[]=[],queue=createFingerprintQueue(()=>{const worker=new ManualWorker();workers.push(worker);return worker;});
  const release=queue.prioritize(),releaseAgain=queue.prioritize(),firstAbort=new AbortController(),cancelQueued=new AbortController();
  const states:string[]=[];
  const first=queue.hash(new File(['a'],'a.mp4'),()=>{},firstAbort.signal,value=>states.push(value));
  const second=queue.hash(new File(['b'],'b.mp4'),()=>{});
  const third=queue.hash(new File(['c'],'c.mp4'),()=>{},cancelQueued.signal);
  const firstRejected=assert.rejects(first,{name:'AbortError'}),thirdRejected=assert.rejects(third,{name:'AbortError'});
  cancelQueued.abort();await tick();assert.equal(workers.length,0);
  release();await tick();assert.equal(workers.length,0);releaseAgain();await tick();assert.equal(workers.length,1);
  const foreground=queue.prioritize();assert.deepEqual(workers[0].messages.at(-1),{type:'pause'});assert.equal(states.at(-1),'paused');
  foreground();assert.deepEqual(workers[0].messages.at(-1),{type:'resume'});
  firstAbort.abort();await firstRejected;assert.equal(workers[0].terminated,true);assert.equal(workers.length,2);
  workers[1].complete();assert.equal(await second,'a'.repeat(64));assert.equal(workers[1].terminated,true);await thirdRejected;
});
test('clearing pending fingerprints never starts another reader and rejects malformed digests',async()=>{
  const workers:ManualWorker[]=[],queue=createFingerprintQueue(()=>{const worker=new ManualWorker();workers.push(worker);return worker;});
  const promises=Array.from({length:3},()=>queue.hash(new File(['a'],'a.mp4'),()=>{}));
  const rejected=promises.map(promise=>assert.rejects(promise,{name:'AbortError'}));await tick();assert.equal(workers.length,1);
  queue.cancelAll();await Promise.all(rejected);assert.equal(workers.length,1);
  const invalid=queue.hash(new File(['b'],'b.mp4'),()=>{});await tick();workers.at(-1)!.complete('not-a-sha');await assert.rejects(invalid,/invalide/);
});
test('slow streamed bytes use full SHA-256, pause between reads, and release the reader',async()=>{
  const tail=deferred(),entered=deferred(),allow=deferred();let reads=0,first=true;
  const stream=new ReadableStream<Uint8Array>({async pull(controller){reads++;if(reads===1){controller.enqueue(new TextEncoder().encode('abc'));entered.resolve();}else{await tail.promise;controller.enqueue(new TextEncoder().encode('def'));controller.close();}}},{highWaterMark:0});
  const values:number[]=[];let complete=false;
  const digest=fingerprintStream({size:6,stream:()=>stream},value=>values.push(value),undefined,async()=>{if(first){first=false;return;}await allow.promise;}).then(hash=>{complete=true;return hash;});
  await entered.promise;await tick();assert.equal(complete,false);assert.equal(reads,1);allow.resolve();await tick();assert.equal(reads,2);assert.equal(complete,false);
  tail.resolve();assert.equal(await digest,createHash('sha256').update('abcdef').digest('hex'));assert.equal(values.at(-1),1);assert.equal(stream.locked,false);
});
test('abort cancels an outstanding network-style read and releases its lock',async()=>{
  const controller=new AbortController(),entered=deferred();let cancelled=false;
  const stream=new ReadableStream<Uint8Array>({pull(){entered.resolve();return new Promise(()=>{});},cancel(){cancelled=true;}},{highWaterMark:0});
  const pending=fingerprintStream({size:6,stream:()=>stream},()=>{},controller.signal);await entered.promise;controller.abort();await assert.rejects(pending,{name:'AbortError'});
  assert.equal(cancelled,true);assert.equal(stream.locked,false);
});
test('a truncated file is never assigned a content identity',async()=>{
  const stream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array([1]));controller.close();}});
  await assert.rejects(fingerprintStream({size:2,stream:()=>stream},()=>{}),/incomplète/);assert.equal(stream.locked,false);
});
