import test from 'node:test';
import assert from 'node:assert/strict';
import {PreviewWebGLGuard} from '../src/studio/preview-webgl-guard';
import {BAPreviewFrame} from '../src/studio/ba-preview-frame';

class Canvas extends EventTarget {
  width=300;height=150;frame=0;
  copies:any[][]=[];clears:any[][]=[];
  context={clearRect:(...args:any[])=>this.clears.push(args),drawImage:(...args:any[])=>{this.copies.push(args);this.frame=args[0].frame??0;}};
  getContext(_kind:string){return this.context as any;}
}
function mockGL(canvas=new Canvas(),maximum=4096){
  let error=0,lost=false,textureFrame=0,uploadError=0,drawError=0;
  const counts={capabilities:0,errors:0,uploads:0,draws:0};
  const uploadedSizes:number[][]=[];
  const api:any={
    canvas,NO_ERROR:0,INVALID_VALUE:1281,INVALID_OPERATION:1282,OUT_OF_MEMORY:1285,CONTEXT_LOST_WEBGL:37442,MAX_TEXTURE_SIZE:3379,
    getParameter:(key:number)=>{assert.equal(key,3379);counts.capabilities++;return maximum;},
    getError:()=>{counts.errors++;const result=error;error=0;return result;},isContextLost:()=>lost,
    getShaderParameter:()=>true,getProgramParameter:()=>true,getUniformLocation:()=>({}),getExtension:()=>null,
    texImage2D:(...args:any[])=>{
      if(args.length!==6)return;counts.uploads++;if(uploadError){error=uploadError;return;}
      const source=args[5],w=source.videoWidth||source.naturalWidth||source.width,h=source.videoHeight||source.naturalHeight||source.height;
      if(w>maximum||h>maximum){error=1281;return;}uploadedSizes.push([w,h]);textureFrame=source.frame??0;
    },
    drawArrays:()=>{counts.draws++;if(drawError){error=drawError;return;}canvas.frame=textureFrame;},
    finish:()=>assert.fail('No GPU finish/readback in preview guard'),readPixels:()=>assert.fail('No GPU finish/readback in preview guard'),
  };
  const gl=new Proxy(api,{get:(target,key)=>key in target?target[key]:(()=>({}))}) as WebGLRenderingContext;
  return {gl,canvas,counts,uploadedSizes,error:(value:number)=>{error=value;},lost:(value:boolean)=>{lost=value;},failUpload:(value:number)=>{uploadError=value;},failDraw:(value:number)=>{drawError=value;}};
}
function documentFor(t:any,create:()=>Canvas){
  const previous=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:(name:string)=>{assert.equal(name,'canvas');return create();}}});
  t.after(()=>{if(previous)Object.defineProperty(globalThis,'document',previous);else delete (globalThis as any).document;});
}
const video=(width=1920,height=1080,frame=1)=>({videoWidth:width,videoHeight:height,frame}) as unknown as HTMLVideoElement;

test('supported video/image/canvas keep their original pixels; capability is read once and errors once per render',()=>{
  const mock=mockGL(),guard=new PreviewWebGLGuard(mock.gl);
  for(const source of [video(),{naturalWidth:400,naturalHeight:300},{width:960,height:540}]){
    assert.equal(guard.source(source as any),source);guard.check();
  }
  assert.deepEqual(mock.counts,{capabilities:1,errors:3,uploads:0,draws:0});guard.dispose();
});

test('over-limit sources alone are reduced, preserving ratio, clear alpha and reusable allocation',t=>{
  const canvases:Canvas[]=[];documentFor(t,()=>{const canvas=new Canvas();canvases.push(canvas);return canvas;});
  const mock=mockGL(),guard=new PreviewWebGLGuard(mock.gl),wide=video(10000,5000);
  const reduced=guard.source(wide) as unknown as Canvas;
  assert.deepEqual([reduced.width,reduced.height],[4096,2048]);assert.deepEqual(reduced.clears,[[0,0,4096,2048]]);
  assert.deepEqual(reduced.copies,[[wide,0,0,4096,2048]]);assert.deepEqual([wide.videoWidth,wide.videoHeight],[10000,5000]);
  const tall=video(2000,6000);assert.equal(guard.source(tall),reduced as any);
  assert.deepEqual([reduced.width,reduced.height],[1365,4096]);assert.ok(Math.abs(reduced.width/reduced.height-1/3)<1/4096);
  const normal=video();assert.equal(guard.source(normal),normal);assert.equal(canvases.length,1);assert.equal(mock.counts.capabilities,1);
  guard.dispose();guard.dispose();assert.deepEqual([reduced.width,reduced.height],[0,0]);assert.throws(()=>guard.source(normal),/processeur graphique/);
});

test('empty sources, exhausted memory and other GL errors fail before accepting a frame',()=>{
  const mock=mockGL(),guard=new PreviewWebGLGuard(mock.gl);
  for(const source of [video(0,1080),video(Infinity,100),{naturalWidth:0,naturalHeight:0,width:1920,height:1080}])assert.throws(()=>guard.source(source as any),/n’est pas disponible/);
  mock.error(1285);assert.throws(()=>guard.check(),/Mémoire graphique insuffisante/);
  mock.error(1281);assert.throws(()=>guard.check(),/refusé.*0x501/);
  mock.error(1282);assert.throws(()=>guard.check(),/refusé.*0x502/);
  mock.error(37442);assert.throws(()=>guard.check(),/processeur graphique ne répond plus/);
  assert.equal(mock.counts.errors,4);guard.dispose();
});

test('both immediate loss and a context-loss event reject rendering, without relying on an exception from GL',()=>{
  const mock=mockGL(),guard=new PreviewWebGLGuard(mock.gl);mock.lost(true);
  assert.throws(()=>guard.source(video()),/processeur graphique/);assert.throws(()=>guard.check(),/processeur graphique/);
  assert.equal(mock.counts.errors,0);mock.lost(false);mock.canvas.dispatchEvent(new Event('webglcontextlost'));
  assert.throws(()=>guard.source(video()),/processeur graphique/);guard.dispose();
  for(const maximum of [0,NaN,Infinity])assert.throws(()=>new PreviewWebGLGuard(mockGL(new Canvas(),maximum).gl),/processeur graphique/);
});

function rendererFixture(t:any){
  const mock=mockGL();let created=0;
  mock.canvas.getContext=()=>mock.gl;
  documentFor(t,()=>created++===0?mock.canvas:new Canvas());
  const renderer=new BAPreviewFrame(new Uint8Array(64**3*3));
  const draw=(source:HTMLVideoElement)=>renderer.draw(source,960,540,'body',{x:1,y:0,width:1920,height:1080},true);
  return {...mock,renderer,draw};
}

test('real BA renderer never returns the old texture after a silent upload failure or draw failure',t=>{
  const fixture=rendererFixture(t),published:number[]=[];
  const publish=(frame:number)=>{published.push((fixture.draw(video(1920,1080,frame)) as unknown as Canvas).frame);};
  publish(1);fixture.failUpload(1285);assert.throws(()=>publish(2),/Mémoire graphique insuffisante/);
  assert.equal(fixture.canvas.frame,1,'mock retained the old texture, just as a refused GL upload does');
  assert.deepEqual(published,[1],'old canvas never reaches publication');
  fixture.failUpload(0);fixture.failDraw(1282);assert.throws(()=>publish(3),/refusé/);
  assert.deepEqual(published,[1]);assert.equal(fixture.counts.errors,4,'initialization plus exactly one check per render');
  fixture.renderer.dispose();
});

test('real BA renderer bounds over-limit source uploads and stops before upload on context loss',t=>{
  const fixture=rendererFixture(t);
  const frame=fixture.draw(video(8192,4608,25)) as unknown as Canvas;assert.equal(frame.frame,25);
  assert.deepEqual(fixture.uploadedSizes,[[4096,2304]]);
  const uploads=fixture.counts.uploads;fixture.lost(true);
  assert.throws(()=>fixture.draw(video(1920,1080,26)),/processeur graphique/);assert.equal(fixture.counts.uploads,uploads);
  fixture.renderer.dispose();
});

test('a failed initial GPU allocation releases its context and never exposes a renderer',t=>{
  const mock=mockGL();let released=0;mock.canvas.getContext=()=>mock.gl;
  (mock.gl as any).getExtension=()=>({loseContext:()=>released++});mock.error(1285);
  documentFor(t,()=>mock.canvas);
  assert.throws(()=>new BAPreviewFrame(new Uint8Array(64**3*3)),/Mémoire graphique insuffisante/);
  assert.equal(released,1);assert.equal(mock.counts.errors,1);
});

test('a shader failure also releases the partially constructed fused renderer',t=>{
  const mock=mockGL();let released=0;mock.canvas.getContext=()=>mock.gl;
  (mock.gl as any).getShaderParameter=()=>false;(mock.gl as any).getShaderInfoLog=()=>'shader unavailable';
  (mock.gl as any).getExtension=()=>({loseContext:()=>released++});documentFor(t,()=>mock.canvas);
  assert.throws(()=>new BAPreviewFrame(new Uint8Array(64**3*3)),/shader unavailable/);assert.equal(released,1);
});
