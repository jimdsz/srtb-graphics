import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createPreviewAudioProxy,isPinnedPreviewBed,previewBedProxyAllowed,previewAudioCacheKey,previewAudioProxyManifest as manifest,validatePreviewBedPCM} from '../src/studio/preview-audio-proxy';
import {previewAudioCache} from '../src/studio/preview-audio-cache';
const origin='http://localhost:5193',url=origin+manifest.sourcePath,signal=()=>new AbortController().signal;
const bytes=await readFile('public'+manifest.proxyPath),channels=[new Float32Array(manifest.frames),new Float32Array(manifest.frames)];for(const [frame,left,right]of manifest.probes){channels[0][frame]=left;channels[1][frame]=right;}
const pcm={length:manifest.frames,sampleRate:48000,numberOfChannels:2,getChannelData:(n:number)=>channels[n]},decode=async()=>pcm;
function fallback(){const calls:any[]=[];return {calls,read:async(...args:any[])=>{calls.push(args);return {url:args[0],buffer:pcm};}};}
test('source and lossless proxy binaries match the pinned manifest and native source remains intact',async()=>{
  for(const [path,expected]of [[decodeURIComponent(manifest.sourcePath),manifest.sourceSha256],[manifest.proxyPath,manifest.proxySha256]])assert.equal(createHash('sha256').update(await readFile('public'+path)).digest('hex'),expected);
  assert.equal(manifest.frames,1440000);assert.ok(manifest.proxyBytes<manifest.sourceBytes*.31);
});
test('only the exact embedded bed can use the proxy; voice pointing to it disables substitution',()=>{
  assert.equal(isPinnedPreviewBed(url,origin),true);
  for(const other of [url+'?copy=1',url+'#copy',url.replace('localhost','external'),url.replace('BA1P','BA1P-copy'),'blob:'+origin+'/voice','/api/media/voice'])assert.equal(isPinnedPreviewBed(other,origin),false);
  assert.equal(previewBedProxyAllowed({_audio_voice_url:'sourceassets/BTV_BA1P -23LUFS.wav'},{},origin+'/library/v1.7.0/BTV_BA_1P/graphic.mjs',origin),false);
  assert.equal(previewBedProxyAllowed({}, {_audio_voice_url:{url}},origin+'/',origin),false);
  assert.equal(previewBedProxyAllowed({_audio_voice_url:'voice.wav'},{},origin+'/',origin),true);
});
test('successful proxy preserves canonical URL and exact PCM; reload and credential policy remain explicit',async()=>{
  const requests:any[]=[],native=fallback(),proxy=createPreviewAudioProxy({origin,decode,fetcher:async(input,init)=>{requests.push({input,init});return new Response(bytes);}});
  const result=await proxy.load(url,signal(),true,native.read);assert.equal(result.url,url);assert.equal(result.buffer,pcm);assert.equal(native.calls.length,0);
  assert.equal(requests[0].input,origin+manifest.proxyPath);assert.equal(requests[0].init.cache,'reload');assert.equal(requests[0].init.redirect,'error');assert.equal(requests[0].init.credentials,undefined);proxy.dispose();
});
test('unrelated user audio and disabled policy call only the native loader',async()=>{
  const native=fallback(),proxy=createPreviewAudioProxy({origin,decode,fetcher:async()=>assert.fail('no proxy fetch')});
  await proxy.load('/api/media/private',signal(),false,native.read);await proxy.load(url,signal(),false,native.read,false);assert.equal(native.calls.length,2);proxy.dispose();
});
test('a warm preview proxy cache does not substitute a later explicit native WAV voice',async()=>{
  let requests=0;const native=fallback(),cache=previewAudioCache<typeof pcm>(),proxy=createPreviewAudioProxy({origin,decode,fetcher:async()=>{requests++;return new Response(bytes);}});
  for(const allowed of [true,false,false])await cache.load(previewAudioCacheKey(url,allowed,origin),signal(),false,async()=>(await proxy.load(url,signal(),false,native.read,allowed)).buffer);
  assert.equal(requests,1);assert.equal(native.calls.length,1);assert.equal(previewAudioCacheKey('/api/private',false,origin),'/api/private');proxy.dispose();cache.dispose();
});
for(const failure of ['503','decode','metadata','samples','digest','redirect','size'])test(`${failure} falls back once to native; a text edit does not repeat the failed proxy; reload retries`,async()=>{
  let requests=0;const native=fallback(),proxy=createPreviewAudioProxy({origin,decode:async()=>{if(failure==='decode')throw Error('unsupported');if(failure==='metadata')return {...pcm,length:1};if(failure==='samples')return {...pcm,getChannelData:()=>new Float32Array(manifest.frames)};return pcm;},fetcher:async()=>{
    requests++;if(failure==='503')return new Response('',{status:503});if(failure==='digest')return new Response('wrong');if(failure==='size')return new Response('',{headers:{'content-length':String(manifest.proxyBytes+1)}});const response=new Response(bytes);if(failure==='redirect')Object.defineProperty(response,'redirected',{value:true});return response;
  }});
  assert.equal((await proxy.load(url,signal(),false,native.read)).buffer,pcm);await proxy.load(url,signal(),false,native.read);assert.equal(requests,1);assert.equal(native.calls.length,2);
  await proxy.load(url,signal(),true,native.read);assert.equal(requests,2);assert.equal(native.calls[2][2],true);proxy.dispose();
});
test('sample validation rejects a one-frame displacement despite an identical duration',()=>{
  assert.doesNotThrow(()=>validatePreviewBedPCM(pcm));assert.throws(()=>validatePreviewBedPCM({...pcm,getChannelData:n=>channels[n].subarray(1)}),/échantillons/);
});
for(const when of ['fetch','decode','dispose','timeout'])test(`${when} cancellation settles without native fallback or cache pollution`,async()=>{
  const native=fallback(),abort=new AbortController(),cache=previewAudioCache<typeof pcm>();let decoded!:(value:typeof pcm)=>void,decodeStarted!:()=>void;const started=new Promise<void>(resolve=>{decodeStarted=resolve;});
  const proxy=createPreviewAudioProxy({origin,timeoutMs:when==='timeout'?5:45000,decode:async()=>{decodeStarted();return new Promise(resolve=>{decoded=resolve;});},fetcher:async()=>when==='decode'?new Response(bytes):new Promise(()=>{})});
  const pending=cache.load(url,abort.signal,false,async()=>(await proxy.load(url,abort.signal,false,native.read)).buffer);
  if(when==='decode'){await started;abort.abort();}else if(when==='dispose')proxy.dispose();else if(when==='fetch')abort.abort();
  await assert.rejects(pending,when==='timeout'?/trop longue/:{name:'AbortError'});assert.equal(native.calls.length,0);assert.equal(cache.bytes,0);decoded?.(pcm);proxy.dispose();cache.dispose();
});
