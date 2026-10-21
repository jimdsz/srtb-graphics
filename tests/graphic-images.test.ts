import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {resolveGraphicImages,installGraphicCompatibility} from '../src/studio/graphic-compatibility';

test('BA image resources resolve from their immutable engine, not the studio page',()=>{
  const data={assets:[{id:'feather',u:'lib/images/',p:'native-body-feather.png',e:0},{id:'embedded',u:'',p:'data:image/png;base64,example',e:1},{id:'comp',layers:[]}]};
  const before=JSON.stringify(data),base='https://studio.test/library/v1.7.0/BTV_BA_1P/graphic.mjs';
  const result=resolveGraphicImages(data,base);
  assert.equal(result.assets[0].p,'https://studio.test/library/v1.7.0/BTV_BA_1P/lib/images/native-body-feather.png');
  assert.equal(result.assets[0].u,'');assert.equal(result.assets[0].e,1);
  assert.deepEqual(result.assets[1],data.assets[1]);assert.deepEqual(result.assets[2],data.assets[2]);
  assert.equal(JSON.stringify(data),before);assert.notEqual(result.assets,data.assets);
});
test('custom sponsors and absolute or local image sources are not prefixed twice',()=>{
  const base='https://studio.test/library/v1.7.0/BTV_BA_1P/graphic.mjs';
  const data={assets:[{u:'unused/',p:'/api/graphics/media/example/content'},{u:'unused/',p:'blob:https://studio.test/example'},{u:'',p:'https://studio.test/already.png'}]};
  const result=resolveGraphicImages(data,base);
  assert.deepEqual(result.assets.map(a=>a.p),['https://studio.test/api/graphics/media/example/content','blob:https://studio.test/example','https://studio.test/already.png']);
  assert.deepEqual(resolveGraphicImages(result,base),result);
});

const originalImage=Object.getOwnPropertyDescriptor(globalThis,'Image');
afterEach(()=>{if(originalImage)Object.defineProperty(globalThis,'Image',originalImage);else Reflect.deleteProperty(globalThis,'Image');});
const base='https://studio.test/library/v1.7.0/BTV_BA_1P/graphic.mjs';
const template={id:'BTV_BA_1P',version:'1.0.3',libraryVersion:'1.7.0',module:base};
const imageData={assets:[{id:'sponsor',u:'lib/images/',p:'img_0.png'},{id:'feather',u:'lib/images/',p:'native-body-feather.png'},{id:'video',p:'data:image/png;base64,embedded'}]};
function fixture(cached=false){
  const images:ControlledImage[]=[],events:string[]=[],decoded:Array<(value?:unknown)=>void>=[];
  class ControlledImage{
    src='';crossOrigin='';loading='';decoding='';fetchPriority='';complete=cached;naturalWidth=cached?1920:0;
    onload:(()=>void)|null=null;onerror:(()=>void)|null=null;removed=false;
    constructor(){images.push(this);events.push('image');}
    decode(){return cached?Promise.resolve():new Promise(resolve=>{decoded[images.indexOf(this)]=resolve;});}
    ready(){this.complete=true;this.naturalWidth=1920;decoded[images.indexOf(this)]?.();}
    removeAttribute(name:string){if(name==='src'){this.src='';this.removed=true;}}
  }
  Object.defineProperty(globalThis,'Image',{configurable:true,value:ControlledImage});
  const graphic={original:imageData,_abort:new AbortController(),builds:[] as unknown[],updates:0,
    async _update(data:unknown,initial?:boolean){events.push('media');this.updates++;return this._build(this.original,{},this._abort.signal);},
    async _build(data:unknown,_media:unknown,_signal:AbortSignal){events.push('build');this.builds.push(data);return data;},
    async dispose(){this._abort.abort();return {};},
  };
  installGraphicCompatibility(graphic,template);
  return {graphic,images,events};
}

test('BA graphics decode before opening videos and remain cached through text-only updates',async()=>{
  const f=fixture(),pending=f.graphic._update({},true);
  assert.deepEqual(f.events,['image','image']);assert.equal(f.graphic.updates,0);
  assert.ok(f.images.every(image=>image.loading==='eager'&&image.fetchPriority==='high'&&image.crossOrigin==='anonymous'));
  // decode() completes without a new load event, as can happen for cache hits.
  for(const image of f.images)image.ready();await pending;
  assert.deepEqual(f.events,['image','image','media','build']);
  await f.graphic._update({_titre_ligne_1:'AUTRE TITRE'});
  assert.equal(f.images.length,2);assert.equal(f.graphic.builds.length,2);
  assert.deepEqual(f.graphic.builds[0],resolveGraphicImages(imageData,base));
  assert.equal(imageData.assets[0].p,'img_0.png');
  await f.graphic.dispose();assert.ok(f.images.every(image=>image.removed));
});

test('already complete images do not wait for a load event; installing twice is harmless',async()=>{
  const f=fixture(true);installGraphicCompatibility(f.graphic,template);
  await f.graphic._update({},true);assert.equal(f.images.length,2);assert.equal(f.graphic.builds.length,1);
  await f.graphic.dispose();
});

test('closing while images are pending cancels every request and never opens the media engine',async()=>{
  const f=fixture(),pending=f.graphic._update({},true);
  await f.graphic.dispose();await assert.rejects(pending,{name:'AbortError'});
  assert.equal(f.graphic.updates,0);assert.equal(f.graphic.builds.length,0);
  assert.ok(f.images.every(image=>image.removed&&image.onload===null&&image.onerror===null));
  for(const image of f.images)image.ready();await Promise.resolve();
  assert.equal(f.graphic.updates,0);
});

test('an image failure names the resource, cancels its sibling, and permits a fresh retry',async()=>{
  const f=fixture(),pending=f.graphic._update({},true);
  f.images[1].onerror?.();await assert.rejects(pending,/native-body-feather\.png.*inaccessible/);
  assert.ok(f.images.every(image=>image.removed));assert.equal(f.graphic.updates,0);
  const retry=f.graphic._update({},true);assert.equal(f.images.length,4);
  for(const image of f.images.slice(2))image.ready();await retry;
  assert.equal(f.graphic.builds.length,1);await f.graphic.dispose();
});

test('a stalled image has a bounded timeout with the exact graphic asset, not a media error',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture(),pending=f.graphic._update({},true);
  t.mock.timers.tick(15000);await assert.rejects(pending,/img_0\.png.*ne se charge pas/);
  assert.equal(f.graphic.updates,0);assert.ok(f.images.every(image=>image.removed));
  await f.graphic.dispose();
});
