import test from 'node:test';
import assert from 'node:assert/strict';
import {previewAudioCache} from '../src/studio/preview-audio-cache';
import {previewOperation} from '../src/studio/preview-operation';
import {studioEntry} from '../src/studio/app-version';
const signal=()=>new AbortController().signal;
const buffer=(length=100)=>({length,numberOfChannels:2});

test('preview audio is read once across engine replacements; reload explicitly rereads',async()=>{
  const cache=previewAudioCache(),value=buffer();let reads=0;const read=async()=>{reads++;return value;};
  assert.equal(await cache.load('bed',signal(),false,read),value);
  assert.equal(await cache.load('bed',signal(),false,read),value);assert.equal(reads,1);
  await cache.load('bed',signal(),true,read);assert.equal(reads,2);assert.equal(cache.bytes,800);
});
test('cache is size bounded and evicts least recently used sounds',async()=>{
  const cache=previewAudioCache(1600);let reads=0;const read=async()=>{reads++;return buffer();};
  for(const url of ['a','b','a','c','a'])await cache.load(url,signal(),false,read);
  assert.equal(reads,3);assert.equal(cache.bytes,1600);await cache.load('b',signal(),false,read);assert.equal(reads,4);
});
test('failed/aborted/oversized loads are never cached; disposal releases all sounds',async()=>{
  const cache=previewAudioCache(800),abort=new AbortController();
  await assert.rejects(cache.load('fail',signal(),false,async()=>{throw Error('network');}));assert.equal(cache.bytes,0);
  await assert.rejects(cache.load('cancel',abort.signal,false,async()=>{abort.abort();return buffer();}),{name:'AbortError'});assert.equal(cache.bytes,0);
  await cache.load('large',signal(),false,async()=>buffer(200));assert.equal(cache.bytes,0);
  await cache.load('small',signal(),false,async()=>buffer());cache.dispose();assert.equal(cache.bytes,0);
  await assert.rejects(cache.load('small',signal(),false,async()=>buffer()),{name:'AbortError'});
});
test('a late decoded buffer cannot reenter a disposed preview',async()=>{
  const cache=previewAudioCache();let resolve!:(value:ReturnType<typeof buffer>)=>void;
  const pending=cache.load('a',signal(),false,()=>new Promise(done=>{resolve=done;}));cache.dispose();resolve(buffer());
  await assert.rejects(pending,{name:'AbortError'});assert.equal(cache.bytes,0);
});
test('hung command times out and disposes its owner before UI recovery',async()=>{
  const abort=new AbortController();let stopped=false;
  await assert.rejects(previewOperation(()=>new Promise(()=>{}),abort.signal,()=>{stopped=true;abort.abort();},15),{name:'AbortError'});
  assert.equal(stopped,true);
});
test('cancel releases a command even if its engine settles later',async()=>{
  const abort=new AbortController();let resolve!:(value:number)=>void;
  const pending=previewOperation(()=>new Promise<number>(done=>{resolve=done;}),abort.signal,()=>assert.fail('no timeout'),1000);
  abort.abort();await assert.rejects(pending,{name:'AbortError'});resolve(1);
});
test('successful and rejected commands keep their result and do not time out later',async()=>{
  assert.equal(await previewOperation(async()=>7,signal(),()=>assert.fail(),20),7);
  await assert.rejects(previewOperation(async()=>{throw Error('codec');},signal(),()=>assert.fail(),20),/codec/);
});
test('release identity uses an actual entry script, not a bookmark or login HTML',()=>{
  assert.equal(studioEntry('<script type="module" crossorigin src="/assets/studio-BYrMVwP8.js"></script>'),'/assets/studio-BYrMVwP8.js');
  for(const html of ['<p>/assets/studio-old.js</p>','<script src="https://other.example/assets/studio-old.js"></script>','<h1>Connexion</h1>'])assert.equal(studioEntry(html),null);
});
