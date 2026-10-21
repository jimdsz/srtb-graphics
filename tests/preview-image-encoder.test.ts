import test from 'node:test';
import assert from 'node:assert/strict';
import {PreviewImageEncoder} from '../src/studio/preview-image-encoder';

test('preview worker is lazy, bounds requests, transfers pixels and releases work on disposal',async()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'Worker');
  const workers:FakeWorker[]=[];
  class FakeWorker {
    onmessage?: (event:any)=>void;onerror?:()=>void;terminated=false;
    messages:{data:any;transfers:any[]}[]=[];
    constructor(public url:URL,public options:any){workers.push(this);}
    postMessage(data:any,transfers:any[]){this.messages.push({data,transfers});}
    terminate(){this.terminated=true;}
  }
  Object.defineProperty(globalThis,'Worker',{configurable:true,value:FakeWorker});
  const pixels=new Uint8ClampedArray(16),canvas={width:2,height:2,getContext:()=>({getImageData:()=>({data:pixels})})} as unknown as HTMLCanvasElement;
  const encoder=new PreviewImageEncoder();
  try{
    assert.equal(workers.length,0);
    const first=encoder.encode(canvas),worker=workers[0];
    assert.equal(worker.options.type,'module');assert.match(worker.url.pathname,/preview-png.worker.ts$/);
    assert.equal(worker.messages.length,1);assert.equal(worker.messages[0].transfers[0],pixels.buffer);
    await assert.rejects(encoder.encode(canvas),/déjà/);
    worker.onmessage!({data:{id:999,png:new ArrayBuffer(3)}});
    await assert.rejects(encoder.encode(canvas),/déjà/);
    worker.onmessage!({data:{id:1,png:new Uint8Array([1,2,3]).buffer}});
    const blob=await first;assert.equal(blob.type,'image/png');assert.equal(blob.size,3);
    const pending=encoder.encode(canvas);encoder.dispose();
    await assert.rejects(pending,/fermé/);assert.equal(worker.terminated,true);
    // A message arriving after cancellation cannot revive the publisher.
    worker.onmessage!({data:{id:2,png:new ArrayBuffer(3)}});
    await assert.rejects(encoder.encode(canvas),/fermé/);
  }finally{encoder.dispose();if(previous)Object.defineProperty(globalThis,'Worker',previous);else Reflect.deleteProperty(globalThis,'Worker');}
});

test('preview worker errors reject the active frame and allow a clean worker restart',async()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'Worker'),workers:any[]=[];
  class FakeWorker {onmessage?: (event:any)=>void;onerror?:()=>void;terminated=false;constructor(){workers.push(this);}postMessage(){}terminate(){this.terminated=true;}}
  Object.defineProperty(globalThis,'Worker',{configurable:true,value:FakeWorker});
  const canvas={width:1,height:1,getContext:()=>({getImageData:()=>({data:new Uint8ClampedArray(4)})})} as unknown as HTMLCanvasElement;
  const encoder=new PreviewImageEncoder();
  try{
    const failed=encoder.encode(canvas);workers[0].onerror();await assert.rejects(failed,/échoué/);assert.equal(workers[0].terminated,true);
    const next=encoder.encode(canvas);assert.equal(workers.length,2);
    workers[1].onmessage({data:{id:2,error:'Données invalides'}});await assert.rejects(next,/Données invalides/);
  }finally{encoder.dispose();if(previous)Object.defineProperty(globalThis,'Worker',previous);else Reflect.deleteProperty(globalThis,'Worker');}
});
