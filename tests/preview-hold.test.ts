import test from 'node:test';
import assert from 'node:assert/strict';
import {holdPreviewFrame,withHeldPreviewFrame} from '../src/studio/preview-hold';
import type {LegacyGraphic} from '../src/studio/video/engine';

function environment(t:test.TestContext,{images=0,decode=()=>Promise.resolve(),fetchBlob=()=>Promise.resolve(new Response(new Blob(['pixels'])))}={}){
  const nodes=Array.from({length:images},()=>({localName:'image',attributes:new Map([['href','blob:source']]),getAttribute(name:string){return this.attributes.get(name);},getAttributeNS(){return null;},hasAttributeNS(){return false;},setAttribute(name:string,value:string){this.attributes.set(name,value);}}));
  const shadow={append(){},querySelectorAll:()=>nodes};
  let appended=0,removed=0,created=0,revoked=0;
  const hold={setAttribute(){},style:{cssText:''},attachShadow:()=>shadow,remove(){removed++;}};
  const originalDocument=globalThis.document,originalImage=globalThis.Image,originalFetch=globalThis.fetch;
  Object.assign(globalThis,{document:{createElement:()=>hold},Image:class{src='';decode=decode;removeAttribute(){this.src='';}},fetch:fetchBlob});
  t.mock.method(URL,'createObjectURL',()=>`blob:owned-${++created}`);t.mock.method(URL,'revokeObjectURL',()=>{revoked++;});
  t.after(()=>Object.assign(globalThis,{document:originalDocument,Image:originalImage,fetch:originalFetch}));
  const graphic={shadowRoot:{childNodes:[],querySelectorAll:()=>[]},parentElement:{append(){appended++;}}} as unknown as LegacyGraphic;
  return {graphic,nodes,counts:()=>({appended,removed,created,revoked})};
}

test('one retained picture owns duplicate blob references once and releases them exactly once',async t=>{
  const {graphic,nodes,counts}=environment(t,{images:2}),lifetime=new AbortController();
  const release=await holdPreviewFrame(graphic,lifetime.signal);
  assert.ok(release);assert.equal(nodes[0].attributes.get('href'),'blob:owned-1');assert.equal(nodes[1].attributes.get('href'),'blob:owned-1');
  assert.deepEqual(counts(),{appended:1,removed:0,created:1,revoked:0});
  release();release();lifetime.abort();assert.deepEqual(counts(),{appended:1,removed:1,created:1,revoked:1});
});

test('closing a retained picture releases it on the preview lifetime abort',async t=>{
  const {graphic,counts}=environment(t),lifetime=new AbortController();
  await holdPreviewFrame(graphic,lifetime.signal);lifetime.abort();
  assert.equal(counts().removed,1);
});

test('a never-settling image decode is cancelled without appending or leaking its URL',async t=>{
  let started!:()=>void;const decoding=new Promise<void>(resolve=>{started=resolve;});
  const {graphic,counts}=environment(t,{images:1,decode:()=>{started();return new Promise<void>(()=>{});}}),lifetime=new AbortController();
  const hold=holdPreviewFrame(graphic,lifetime.signal);await decoding;lifetime.abort();
  assert.equal(await hold,undefined);assert.deepEqual(counts(),{appended:0,removed:1,created:1,revoked:1});
});

test('optional picture preparation times out after five seconds while engine work remains independent',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let started!:()=>void;const decoding=new Promise<void>(resolve=>{started=resolve;});
  const {graphic,counts}=environment(t,{images:1,decode:()=>{started();return new Promise<void>(()=>{});}}),lifetime=new AbortController();
  const hold=holdPreviewFrame(graphic,lifetime.signal);await decoding;t.mock.timers.tick(5000);
  assert.equal(await hold,undefined);assert.equal(lifetime.signal.aborted,false);assert.deepEqual(counts(),{appended:0,removed:1,created:1,revoked:1});
});

test('an already closed preview cannot append a stale retained picture',async t=>{
  const {graphic,counts}=environment(t),lifetime=new AbortController();lifetime.abort();
  assert.equal(await holdPreviewFrame(graphic,lifetime.signal),undefined);assert.equal(counts().appended,0);
});

test('asynchronous inspection retains the accepted picture until replacement succeeds',async t=>{
  const {graphic,counts}=environment(t),lifetime=new AbortController();
  let complete!:()=>void,started!:()=>void;const running=new Promise<void>(resolve=>{started=resolve;});
  const replacement=withHeldPreviewFrame(graphic,lifetime.signal,()=>{started();return new Promise<void>(resolve=>{complete=resolve;});});
  await running;assert.equal(counts().appended,1);assert.equal(counts().removed,0);
  complete();await replacement;assert.equal(counts().removed,1);
});

test('failed or aborted inspection cannot leak a retained picture or begin a stale replacement',async t=>{
  const {graphic,counts}=environment(t),lifetime=new AbortController();
  await assert.rejects(withHeldPreviewFrame(graphic,lifetime.signal,async()=>{throw Error('inspection refusée');}),/inspection refusée/);
  assert.equal(counts().removed,1);lifetime.abort();let called=false;
  await assert.rejects(withHeldPreviewFrame(graphic,lifetime.signal,async()=>{called=true;}),{name:'AbortError'});
  assert.equal(called,false);assert.equal(counts().appended,1);
});

test('social capture reads the displayed canvas and never clones the hidden TV scene',async t=>{
  const originalDocument=globalThis.document,draws:unknown[][]=[],children:unknown[]=[];
  const social={width:1080,height:1920,style:{cssText:'width:100%;height:100%;object-fit:contain'}};
  const canvas={width:0,height:0,style:{cssText:''},getContext:()=>({drawImage:(...args:unknown[])=>draws.push(args)})};
  const hold={setAttribute(){},style:{cssText:''},attachShadow:()=>({append:(child:unknown)=>children.push(child),querySelectorAll:()=>[]}),remove(){}};
  Object.assign(globalThis,{document:{createElement:(tag:string)=>tag==='canvas'?canvas:hold}});
  t.after(()=>Object.assign(globalThis,{document:originalDocument}));
  const graphic={__socialPreview:{canvas:social},shadowRoot:{get childNodes(){throw Error('Hidden TV scene must not be copied');}},parentElement:{append(){}}} as unknown as LegacyGraphic;
  const release=await holdPreviewFrame(graphic,new AbortController().signal);
  assert.ok(release);assert.deepEqual(draws,[[social,0,0]]);assert.deepEqual(children,[canvas]);
  assert.equal(canvas.width,1080);assert.equal(canvas.height,1920);assert.equal(canvas.style.cssText,social.style.cssText);release();
});
