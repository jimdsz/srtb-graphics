import test from 'node:test';
import assert from 'node:assert/strict';
import {previewCanvasContext,checkPreviewCanvas} from '../src/studio/preview-canvas-guard';

function fixture(supportsQuery=true){
 const canvas=new EventTarget();let unavailable=false,calls=0,settings:unknown,subscriptions=0;
 const context={...(supportsQuery?{isContextLost:()=>unavailable}:{}),canvas} as unknown as CanvasRenderingContext2D;
 const add=canvas.addEventListener.bind(canvas);canvas.addEventListener=(...args:Parameters<typeof add>)=>{subscriptions++;return add(...args);};
 Object.assign(canvas,{getContext:(_type:string,options:unknown)=>{calls++;settings=options;return context;}});
 return {canvas:canvas as HTMLCanvasElement,context,lose:()=>{unavailable=true;},restore:()=>{unavailable=false;},get calls(){return calls;},get settings(){return settings;},get subscriptions(){return subscriptions;}};
}

test('healthy contexts are unchanged, options preserved, only one listener attached',()=>{
 const f=fixture();const options={willReadFrequently:true};assert.equal(previewCanvasContext(f.canvas,options),f.context);
 assert.equal(f.settings,options);assert.equal(previewCanvasContext(f.canvas),f.context);checkPreviewCanvas(f.context);
 assert.equal(f.subscriptions,1);assert.equal(f.calls,2);
});
test('initially unavailable 2D context gives an actionable error',()=>{
 const f=fixture();Object.assign(f.canvas,{getContext:()=>null});assert.throws(()=>previewCanvasContext(f.canvas),/surface d’image.*réglages sont conservés/);
});
test('API-reported loss fails immediately and remains failed after a restoration',()=>{
 const f=fixture();previewCanvasContext(f.canvas);f.lose();assert.throws(()=>checkPreviewCanvas(f.context),/Relancez/);
 f.restore();assert.throws(()=>previewCanvasContext(f.canvas),/Relancez/);
 assert.doesNotThrow(()=>previewCanvasContext(fixture().canvas),'a rebuilt preview owns a fresh surface');
});
test('contextlost covers engines without isContextLost and does not prevent native restoration',()=>{
 const f=fixture(false);previewCanvasContext(f.canvas);const event=new Event('contextlost',{cancelable:true});f.canvas.dispatchEvent(event);
 assert.equal(event.defaultPrevented,false);assert.throws(()=>checkPreviewCanvas(f.context),/surface d’image/);
 f.canvas.dispatchEvent(new Event('contextrestored'));assert.throws(()=>previewCanvasContext(f.canvas),/Relancez/);
});
