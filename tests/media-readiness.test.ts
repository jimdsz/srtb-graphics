import test from 'node:test';
import assert from 'node:assert/strict';
import {relayVideoReadiness,waitForVideoData,shouldReportMediaDecodeError} from '../src/studio/media-readiness';
import {installBAPreviewMediaPlayback} from '../src/studio/ba-preview-playback';
test('late decoded data wakes the frozen BA seeker only when a valid frame is ready',()=>{
  const node=Object.assign(new EventTarget(),{readyState:1,seeking:false,error:null as object|null}),abort=new AbortController();let wake=0;
  node.addEventListener('seeked',()=>wake++);relayVideoReadiness(node as unknown as HTMLVideoElement,abort.signal);
  node.dispatchEvent(new Event('loadeddata'));assert.equal(wake,0);
  node.readyState=2;node.seeking=true;node.dispatchEvent(new Event('canplay'));assert.equal(wake,0);
  node.seeking=false;node.dispatchEvent(new Event('loadeddata'));assert.equal(wake,1);
  node.error={code:3};node.dispatchEvent(new Event('progress'));assert.equal(wake,1);
  node.error=null;abort.abort();node.dispatchEvent(new Event('canplay'));assert.equal(wake,1);
});
test('video preparation accepts late readiness and keeps bounded failures and cancellation',async()=>{
  const node=Object.assign(new EventTarget(),{readyState:1,seeking:false,error:null as object|null}) as unknown as HTMLVideoElement,controller=new AbortController();
  const waiting=waitForVideoData(node,controller.signal,'test',1000);
  node.dispatchEvent(new Event('seeked'));Object.assign(node,{readyState:2});node.dispatchEvent(new Event('loadeddata'));await waiting;
  Object.assign(node,{readyState:1});await assert.rejects(waitForVideoData(node,controller.signal,'test',5),/réseau/);
  const cancelled=waitForVideoData(node,controller.signal,'test',1000);controller.abort();await assert.rejects(cancelled,{name:'AbortError'});
  Object.assign(node,{error:{code:3}});await assert.rejects(waitForVideoData(node,new AbortController().signal,'test',1000),/codec/);
});

test('only the preview defers inactive decoder failures; export keeps reporting them',()=>{
  const node={} as HTMLVideoElement,clip={node},track={clips:[clip],playing:false,finished:false,active:0};
  const engine={disposed:false,pause(){},dispose(){},sync(){},previewMediaErrorCurrent:undefined as undefined|((track:any,node:HTMLVideoElement)=>boolean)};
  assert.equal(shouldReportMediaDecodeError(engine,track,clip,node),true,'Export/default contract');
  installBAPreviewMediaPlayback(engine);
  assert.equal(shouldReportMediaDecodeError(engine,track,clip,node),false,'Paused preview');
  track.playing=true;assert.equal(shouldReportMediaDecodeError(engine,track,clip,node),true,'Current playing video');
  track.active=1;assert.equal(shouldReportMediaDecodeError(engine,track,clip,node),false,'Outgoing/future decoder');
  track.active=0;track.finished=true;assert.equal(shouldReportMediaDecodeError(engine,track,clip,node),false,'Finished track');
  engine.disposed=true;assert.equal(shouldReportMediaDecodeError(engine,track,clip,node),false);
});
