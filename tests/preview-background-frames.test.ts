import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {PreviewBackgroundFrames} from '../src/studio/preview-background-frames';

function images(){
  const created:{src:string;decoding:string;started:boolean;resolve:()=>void;reject:()=>void;decode:()=>Promise<void>;removeAttribute:(key:string)=>void}[]=[];
  const factory=()=>{
    let resolve!:()=>void,reject!:()=>void;
    const decoded=new Promise<void>((yes,no)=>{resolve=yes;reject=()=>no(Error('decode failed'));});
    const image={src:'',decoding:'',started:false,resolve,reject,decode:()=>{image.started=true;return decoded;},removeAttribute:()=>{image.src='';}};
    created.push(image);return image as unknown as HTMLImageElement;
  };
  return {created,factory};
}

test('upcoming PNGs deduplicate holds, retain three distinct images and decode only two at once',async()=>{
  const {created,factory}=images(),cache=new PreviewBackgroundFrames(['a','a','b','b','c','d','e'],factory);
  cache.ahead(0);assert.equal(created.length,3);assert.deepEqual(created.map(image=>image.src),['b','c','']);
  assert.equal(cache.take('b'),undefined);
  created[0].resolve();await setImmediate();assert.deepEqual(created.map(image=>image.src),['b','c','d']);
  created[1].resolve();created[2].resolve();await cache.ready();
  assert.equal(cache.take('b'),created[0]);assert.equal(cache.take('b'),undefined);
  cache.ahead(2);assert.equal(created.length,4);assert.equal(created[3].src,'e');
  cache.ahead(3);assert.equal(created.length,4); // same hold must not allocate or restart
  created[3].resolve();await cache.ready();cache.dispose();
});

test('seeking discards obsolete prefetches without publishing an old decoded image',async()=>{
  const {created,factory}=images(),cache=new PreviewBackgroundFrames(['a','b','c','d','e','f','g'],factory);
  cache.ahead(0);cache.ahead(4);
  assert.deepEqual(created.slice(0,3).map(image=>image.src),['','','']);
  created[0].resolve();created[1].resolve();await setImmediate();
  assert.equal(cache.take('b'),undefined);assert.equal(cache.take('c'),undefined);
  assert.deepEqual(created.slice(3).map(image=>image.src),['f','g']);
  created[3].resolve();created[4].resolve();await cache.ready();assert.equal(cache.take('f'),created[3]);cache.dispose();
});

test('a failed speculative decode leaves the direct engine path available',async()=>{
  const {created,factory}=images(),cache=new PreviewBackgroundFrames(['a','b','c'],factory);
  cache.ahead(0);created[0].reject();created[1].resolve();await cache.ready();
  assert.equal(cache.take('b'),undefined);assert.equal(cache.take('c'),created[1]);cache.dispose();
});

test('dispose resolves readiness, clears sources and never starts queued decodes',async()=>{
  const {created,factory}=images(),cache=new PreviewBackgroundFrames(['a','b','c','d'],factory);
  cache.ahead(0);const ready=cache.ready();cache.dispose();await ready;
  assert.ok(created.every(image=>image.src===''));created[0].resolve();created[1].resolve();await setImmediate();
  assert.equal(created[2].started,false);cache.ahead(0);assert.equal(created.length,3);
});

test('end of sequence needs no speculative image and handles repeated source returns',async()=>{
  const {created,factory}=images(),cache=new PreviewBackgroundFrames(['a','b','a','b','c'],factory);
  cache.ahead(0);assert.equal(created.length,2);created.forEach(image=>image.resolve());await cache.ready();
  cache.ahead(4);assert.equal(cache.take('b'),undefined);assert.ok(created.every(image=>image.src===''));await cache.ready();cache.dispose();
});
