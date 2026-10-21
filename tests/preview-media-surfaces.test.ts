import test from 'node:test';
import assert from 'node:assert/strict';
import {previewSurfaceSize,paintPreviewMedia,explicitlyHiddenCanvas} from '../src/studio/preview-media-surfaces';

test('preview budget bounds both dimensions without upscaling',()=>{
  assert.deepEqual(previewSurfaceSize(3840,2160),{width:1280,height:720});
  assert.deepEqual(previewSurfaceSize(2160,3840),{width:720,height:1280});
  assert.deepEqual(previewSurfaceSize(640,360),{width:640,height:360});
  assert.equal(previewSurfaceSize(0,0),undefined);assert.equal(previewSurfaceSize(Infinity,10),undefined);
});
test('live preview skips explicitly hidden video targets but repaints on reveal and always paints inspection/images',()=>{
  class Video {videoWidth=1920;videoHeight=1080;readyState=2;seeking=false;error=null;}
  Object.defineProperty(globalThis,'HTMLVideoElement',{value:Video,configurable:true});
  try{
    function canvas(){const calls:unknown[][]=[],context={clearRect(){},drawImage(...args:unknown[]){calls.push(args);}};return Object.assign(new EventTarget(),{width:1920,height:1080,parentElement:null as unknown,calls,getContext:()=>context});}
    const hidden={style:{display:'none',opacity:''},getAttribute:()=>null,parentElement:null};
    const node=new Video(),source=canvas(),target=canvas();target.parentElement=hidden;
    assert.equal(explicitlyHiddenCanvas(target as any),true);
    paintPreviewMedia(node as any,source as any,[target as any],1280,true);
    assert.equal(source.calls.length,1);assert.equal(target.calls.length,0);
    hidden.style.display='';
    paintPreviewMedia(node as any,source as any,[target as any],1280,true);assert.equal(target.calls.length,1);
    hidden.style.opacity='0';
    paintPreviewMedia(node as any,source as any,[target as any],1280,true);assert.equal(target.calls.length,1);
    paintPreviewMedia(node as any,source as any,[target as any],1280,false);assert.equal(target.calls.length,2);
    const still={naturalWidth:1920,naturalHeight:1080};
    paintPreviewMedia(still as any,source as any,[target as any],1280,true);assert.equal(target.calls.length,3);
    hidden.style.opacity='0.5';assert.equal(explicitlyHiddenCanvas(target as any),false);
    target.parentElement={style:{},getAttribute:(name:string)=>name==='opacity'?'0':null,parentElement:null};assert.equal(explicitlyHiddenCanvas(target as any),true);
  }finally{Reflect.deleteProperty(globalThis,'HTMLVideoElement');}
});
test('preview paint preserves cover crop, scales surfaces once, skips undecoded frames and TV targets in social',()=>{
  class Video {videoWidth=3840;videoHeight=2160;readyState=2;seeking=false;error=null;}
  Object.defineProperty(globalThis,'HTMLVideoElement',{value:Video,configurable:true});
  try{
    function canvas(width:number,height:number){const calls:any[][]=[],context={clearRect(){},drawImage(...args:any[]){calls.push(args);}};return Object.assign(new EventTarget(),{width,height,calls,getContext:()=>context});}
    const node=new Video(),source=canvas(1,1),target=canvas(1080,1920);
    assert.equal(paintPreviewMedia(node as any,source as any,[target as any]),true);
    assert.equal(source.width,1280);assert.equal(source.height,720);assert.equal(target.width,720);assert.equal(target.height,1280);
    assert.ok(target.calls[0][1]<0);assert.equal(target.calls[0][2],0);
    paintPreviewMedia(node as any,source as any,[target as any]);assert.equal(target.width,720);
    const count=target.calls.length;paintPreviewMedia(node as any,source as any,[]);assert.equal(target.calls.length,count);
    node.seeking=true;assert.equal(paintPreviewMedia(node as any,source as any,[target as any]),false);assert.equal(target.calls.length,count);
  }finally{Reflect.deleteProperty(globalThis,'HTMLVideoElement');}
});
