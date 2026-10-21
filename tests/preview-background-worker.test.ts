import test from 'node:test';
import assert from 'node:assert/strict';
import {extractPreviewBackgrounds,installPreviewBackgrounds} from '../src/studio/preview-backgrounds';
import type {LegacyGraphic} from '../src/studio/video/engine';
import type {BroadcastTemplate} from '../src/studio/domain';

test('archive worker transfers the source buffer and terminates on success, failure or abort',async context=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'Worker'),workers:FakeWorker[]=[];
  class FakeWorker {
    onmessage?: (event:unknown)=>void;onerror?:()=>void;onmessageerror?:()=>void;
    terminated=false;source?:ArrayBuffer;transfer?:Transferable[];
    constructor(public url:URL,public options:WorkerOptions){workers.push(this);}
    postMessage(source:ArrayBuffer,transfer:Transferable[]){this.source=source;this.transfer=transfer;}
    terminate(){this.terminated=true;}
  }
  Object.defineProperty(globalThis,'Worker',{value:FakeWorker,configurable:true});
  context.after(()=>{if(descriptor)Object.defineProperty(globalThis,'Worker',descriptor);else Reflect.deleteProperty(globalThis,'Worker');});
  const source=new ArrayBuffer(8),signal=new AbortController(),request=extractPreviewBackgrounds(source,signal.signal),worker=workers[0];
  assert.match(worker.url.href,/preview-backgrounds\.worker\.ts$/);assert.equal(worker.options.type,'module');assert.equal(worker.source,source);assert.deepEqual(worker.transfer,[source]);
  const entries={'index.json':new Uint8Array([1,2,3])};worker.onmessage?.({data:{entries}});assert.equal(await request,entries);assert.equal(worker.terminated,true);
  const abort=new AbortController(),cancelled=extractPreviewBackgrounds(new ArrayBuffer(1),abort.signal);abort.abort();await assert.rejects(cancelled,{name:'AbortError'});assert.equal(workers[1].terminated,true);
  const failed=extractPreviewBackgrounds(new ArrayBuffer(1),new AbortController().signal);workers[2].onerror?.();await assert.rejects(failed,/préparation/);assert.equal(workers[2].terminated,true);
  assert.throws(()=>extractPreviewBackgrounds(new ArrayBuffer(1),abort.signal),{name:'AbortError'});assert.equal(workers.length,3);
});

test('shared archive fetch survives one preview closing and aborts when the last preview closes',async context=>{
  const signals:AbortSignal[]=[];
  context.mock.method(globalThis,'fetch',(_url:string,options:RequestInit)=>new Promise((_resolve,reject)=>{
    const signal=options.signal!;signals.push(signal);signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
  }));
  const template={id:'BTV_BA_TDS',libraryVersion:'1.7.0'} as BroadcastTemplate;
  const graphic=()=>({state:{lottieTemplate:{btvAutomation:{backgroundSequence:{firstFrame:0,lastFrame:1}}}},dispose:async()=>{},_setBackgroundFrame:()=>{}}) as unknown as LegacyGraphic;
  const a=graphic(),b=graphic();installPreviewBackgrounds(a,template,()=>{});installPreviewBackgrounds(b,template,()=>{});
  const first=a._loadBackgroundSequence(),second=b._loadBackgroundSequence();assert.equal(signals.length,1);
  await a.dispose();assert.equal(signals[0].aborted,false);await b.dispose();assert.equal(signals[0].aborted,true);
  await Promise.all([assert.rejects(first,{name:'AbortError'}),assert.rejects(second,{name:'AbortError'})]);
  const retry=graphic();installPreviewBackgrounds(retry,template,()=>{});const retried=retry._loadBackgroundSequence();assert.equal(signals.length,2);
  await retry.dispose();await assert.rejects(retried,{name:'AbortError'});
});
