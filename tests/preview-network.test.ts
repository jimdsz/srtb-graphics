import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreviewResourceCache,publicPreviewResourceURL,previewMediaReady,assertPreviewMedia,previewAnimationReady,previewFont} from '../src/studio/preview-network';
const origin='http://localhost:5193',url=origin+'/library/v1.7.0/BTV_Semainier/source/animation.json';
const controller=()=>new AbortController();
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}

test('transient HTTP 503 and malformed JSON are evicted, so the same page retries successfully',async()=>{
  let calls=0;const cache=createPreviewResourceCache({origin,fetcher:async()=>++calls===1?new Response('unavailable',{status:503}):calls===2?new Response('not json'):new Response('{"ready":true}')});
  await assert.rejects(cache.load(url,'json',controller().signal),/503/);
  await assert.rejects(cache.load(url,'json',controller().signal),SyntaxError);
  assert.deepEqual(await cache.load(url,'json',controller().signal),{ready:true});assert.equal(calls,3);
  const value=await cache.load(url,'json',controller().signal);value.ready=false;
  assert.deepEqual(await cache.load(url,'json',controller().signal),{ready:true});assert.equal(calls,3);cache.clear();
});
test('two instances share a public request; cancelling only one leaves the other alive',async()=>{
  const response=deferred<Response>();let calls=0,requestSignal:AbortSignal|undefined;
  const cache=createPreviewResourceCache({origin,fetcher:async(_url,options)=>{calls++;requestSignal=options?.signal as AbortSignal;return response.promise;}});
  const a=controller(),b=controller(),first=cache.load(url,'json',a.signal),second=cache.load(url,'json',b.signal);
  a.abort();await assert.rejects(first,{name:'AbortError'});assert.equal(requestSignal!.aborted,false);assert.equal(calls,1);
  response.resolve(new Response('{"ok":1}'));assert.deepEqual(await second,{ok:1});assert.equal(cache.stats.pending,0);cache.clear();
});
test('last cancellation aborts the request immediately, and a late result cannot poison a new retry',async()=>{
  const response=deferred<Response>();let calls=0,requestSignal:AbortSignal|undefined;
  const cache=createPreviewResourceCache({origin,fetcher:async(_url,options)=>{calls++;if(calls>1)return new Response('{"fresh":1}');requestSignal=options?.signal as AbortSignal;return response.promise;}});
  const a=controller(),first=cache.load(url,'json',a.signal);a.abort();await assert.rejects(first,{name:'AbortError'});
  assert.equal(requestSignal!.aborted,true);assert.equal(cache.stats.pending,0);
  assert.deepEqual(await cache.load(url,'json',controller().signal),{fresh:1});response.resolve(new Response('{"stale":1}'));
  await new Promise(resolve=>setTimeout(resolve,0));assert.deepEqual(await cache.load(url,'json',controller().signal),{fresh:1});assert.equal(calls,2);cache.clear();
});
test('request timeout releases the pending cache and allows a new attempt',async()=>{
  let calls=0;const cache=createPreviewResourceCache({origin,timeoutMs:10,fetcher:async(_url,options)=>{
    if(++calls>1)return new Response('{}');const signal=options?.signal as AbortSignal;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  }});
  await assert.rejects(cache.load(url,'json',controller().signal),/dépassé/);assert.equal(cache.stats.pending,0);
  assert.deepEqual(await cache.load(url,'json',controller().signal),{});cache.clear();
});
test('only exact same-origin engine resources can enter the bounded session cache',async()=>{
  let calls=0;const cache=createPreviewResourceCache({origin,maxBytes:8,fetcher:async()=>{calls++;return new Response('12345');}});
  for(const rejected of ['/api/graphics/media/private/content','/library/v1.7.0/BTV_Semainier/source/images/img_1.png',url+'?private=1','https://example.com'+new URL(url).pathname,'blob:http://localhost:5193/test']){
    assert.throws(()=>publicPreviewResourceURL(rejected,origin),/cache public/);
  }
  await cache.load(url,'text',controller().signal);await cache.load(origin+'/library/v1.7.0/BTV_Evenement/source/animation.json','text',controller().signal);
  assert.equal(cache.stats.bytes,5);assert.equal(cache.stats.entries,1);assert.equal(calls,2);cache.clear();assert.deepEqual(cache.stats,{bytes:0,entries:0,pending:0});
});
test('resource byte limit rejects oversized responses without retaining them',async()=>{
  const cache=createPreviewResourceCache({origin,maxResourceBytes:3,fetcher:async()=>new Response('1234')});
  await assert.rejects(cache.load(url,'text',controller().signal),/volumineuse/);assert.equal(cache.stats.bytes,0);assert.equal(cache.stats.pending,0);
});
test('HTTP errors and excessive content-length abort the remaining response body',async()=>{
  for(const response of [new Response('later body',{status:503}),new Response('1234',{headers:{'content-length':'4'}})]){
    let requestSignal:AbortSignal|undefined;const cache=createPreviewResourceCache({origin,maxResourceBytes:3,fetcher:async(_url,options)=>{requestSignal=options?.signal as AbortSignal;return response;}});
    await assert.rejects(cache.load(url,'text',controller().signal));assert.equal(requestSignal!.aborted,true);assert.deepEqual(cache.stats,{bytes:0,entries:0,pending:0});
  }
});
test('a public resource request refuses redirects and cannot retain a private redirected response',async()=>{
  const response=new Response('{"private":true}');Object.defineProperty(response,'redirected',{value:true});let options:RequestInit|undefined;
  const cache=createPreviewResourceCache({origin,fetcher:async(_url,init)=>{options=init;return response;}});
  await assert.rejects(cache.load(url,'json',controller().signal),/Redirection/);assert.equal(options?.redirect,'error');assert.equal(options?.credentials,undefined);assert.deepEqual(cache.stats,{bytes:0,entries:0,pending:0});
});
test('a font downloaded with HTTP 200 but rejected by the decoder is evicted before retry',async()=>{
  const names=['fetch','location','FontFace','document'],saved=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));let requests=0,decodes=0,added=0;
  try{
    Object.defineProperties(globalThis,{
      fetch:{configurable:true,writable:true,value:async()=>{requests++;return new Response('font bytes');}},
      location:{configurable:true,value:{origin}},
      FontFace:{configurable:true,value:class{async load(){if(++decodes===1)throw Error('invalid font');return this;}}},
      document:{configurable:true,value:{fonts:{add(){added++;}}}},
    });
    const fontURL=origin+'/library/v1.7.0/BTV_Renvoi/lib/fonts/BeninSemiBold-Regular.otf';
    await assert.rejects(previewFont('Benin Semi Bold',fontURL,controller().signal),/invalid font/);
    await previewFont('Benin Semi Bold',fontURL,controller().signal);assert.equal(requests,2);assert.equal(added,1);
    await previewFont('Benin Semi Bold',fontURL,controller().signal);assert.equal(requests,2);
  }finally{for(const name of names){const descriptor=saved.get(name);if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);}}
});
class Media extends EventTarget {src='http://local/test.mp4';paused=0;loaded=0;removed=0;pause(){this.paused++;}load(){this.loaded++;}remove(){this.removed++;}removeAttribute(name:string){if(name==='src')this.src='';}}
test('stop during a pending media load releases its source and rejects immediately',async()=>{
  const node=new Media(),a=controller(),waiting=previewMediaReady(node as unknown as HTMLVideoElement,'loadeddata',a.signal);a.abort();
  await assert.rejects(waiting,{name:'AbortError'});assert.equal(node.src,'');assert.equal(node.loaded,1);assert.equal(node.paused,1);node.dispatchEvent(new Event('loadeddata'));assert.equal(node.removed,1);
});
test('cancel between media readiness and track commit still releases the uncommitted node',async()=>{
  const node=new Media(),a=controller(),waiting=previewMediaReady(node as unknown as HTMLVideoElement,'loadeddata',a.signal);node.dispatchEvent(new Event('loadeddata'));await waiting;a.abort();
  assert.throws(()=>assertPreviewMedia(node as unknown as HTMLVideoElement,a.signal),{name:'AbortError'});assert.equal(node.src,'');assert.equal(node.loaded,1);
});
test('media and animation errors/timeouts can settle only once and stop their listeners',async()=>{
  const node=new Media(),a=controller(),waiting=previewMediaReady(node as unknown as HTMLVideoElement,'loadeddata',a.signal,5);await assert.rejects(waiting,/trop de temps/);a.abort();assert.equal(node.removed,1);
  const animation=new EventTarget(),b=controller(),pending=previewAnimationReady(animation,b.signal);b.abort();await assert.rejects(pending,{name:'AbortError'});animation.dispatchEvent(new Event('DOMLoaded'));
});
