import test from 'node:test';
import assert from 'node:assert/strict';
import {AEPreviewPlayback} from '../src/studio/ae-preview-playback';
// @ts-ignore Read-only frozen source, to reproduce the actual pre-fix lock.
import {positionVideo} from '../public/library/v1.7.0/_shared/ae-live-media.mjs';
class Video extends EventTarget{
  duration=10;currentTime=0;readyState=4;seeking=false;error:null|{message:string}=null;paused=true;plays=0;pauses=0;
  playResult:Promise<void>=Promise.resolve();
  play(){this.plays++;this.paused=false;return this.playResult;}
  pause(){this.pauses++;this.paused=true;}
}
const flush=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
function setup(){let now=0,active=true;const errors:Error[]=[],node=new Video(),playback=new AEPreviewPlayback(error=>errors.push(error),()=>now);return {node,playback,errors,time:(value:number)=>now=value,active:(value:boolean)=>active=value,position:(seconds=0,loop=false)=>playback.position(node as any,seconds,loop,()=>active)};}
test('native play wait locks a render, preview position remains synchronous and Pause stays final',async()=>{
  const s=setup();let resolve!:()=>void;s.node.playResult=new Promise(r=>resolve=r);
  let settled=false;void positionVideo(s.node,0,false,true,false,()=>Promise.resolve()).then(()=>settled=true);await flush();assert.equal(settled,false);
  s.node.pause();assert.equal(s.position(),true);assert.equal(s.position(.04),true);assert.equal(s.node.plays,2);
  s.playback.pause();resolve();await flush();assert.equal(s.node.paused,true);s.playback.dispose();
});
test('missing seek event never locks live position or prevents another medium playing',()=>{
  const s=setup();s.node.seeking=true;assert.equal(s.position(2),false);
  const next=new Video();assert.equal(s.playback.position(next as any,0,false,()=>true),true);assert.equal(next.plays,1);
  s.time(15001);assert.equal(s.position(3),false);assert.equal(s.errors.length,1);assert.equal(s.position(4),false);assert.equal(s.errors.length,1);s.playback.dispose();
});
test('pending play has one request and bounded failure; explicit pause permits a new attempt',async()=>{
  const s=setup();s.node.playResult=new Promise(()=>{});s.position();s.time(14000);s.position();assert.equal(s.node.plays,1);
  s.time(15000);assert.equal(s.position(),false);assert.match(s.errors[0].message,/15 secondes/);s.playback.pause();
  s.node.playResult=Promise.resolve();assert.equal(s.position(),true);await flush();assert.equal(s.node.plays,2);s.playback.dispose();
});
test('buffering and active seeking are not chased with new seeks; ordinary drift is rate limited',async()=>{
  const s=setup();s.position();await flush();s.node.readyState=2;s.time(1000);s.position(2);assert.equal(s.node.currentTime,0);
  s.node.readyState=4;s.position(2);assert.equal(s.node.currentTime,2);s.time(1040);s.position(3);assert.equal(s.node.currentTime,2);
  s.node.seeking=true;s.time(3000);s.position(5);assert.equal(s.node.currentTime,2);
  s.node.seeking=false;s.position(5);assert.equal(s.node.currentTime,5);s.playback.dispose();
});
test('short loops, end holds and source discontinuities retain their target',()=>{
  const s=setup();s.node.duration=.2;s.node.currentTime=.19;s.position(.19,true);s.time(40);s.position(.21,true);assert.ok(Math.abs(s.node.currentTime-.01)<1e-8);
  s.position(.3,false);assert.equal(s.node.paused,true);s.node.duration=10;s.position(5);s.position(1);assert.equal(s.node.currentTime,1);s.playback.dispose();
});
test('superseded or inactive play rejection cannot stop a different passage',async()=>{
  const s=setup();let reject!:(e:Error)=>void;s.node.playResult=new Promise((_,r)=>reject=r);s.position();
  s.active(false);s.playback.sweep();assert.equal(s.node.paused,true);reject(Error('old source'));await flush();assert.deepEqual(s.errors,[]);
  s.active(true);s.node.playResult=Promise.resolve();s.position();await flush();assert.equal(s.node.paused,false);s.playback.dispose();
});
test('current browser rejection is reported once, but disposal ignores late rejection',async()=>{
  const s=setup();s.node.playResult=Promise.reject(Error('codec'));s.position();await flush();assert.equal(s.errors.length,1);assert.match(s.errors[0].message,/codec/);s.position();assert.equal(s.errors.length,1);s.playback.pause();
  let reject!:(e:Error)=>void;s.node.playResult=new Promise((_,r)=>reject=r);s.position();s.playback.dispose();reject(Error('disposed'));await flush();assert.equal(s.errors.length,1);
});
test('precise inspection at a pending live seek must still await its decoded target',async()=>{
  const s=setup(),node=s.node as Video&{__frameReady?:boolean};node.__frameReady=true;
  s.position(2);assert.equal(node.__frameReady,false);s.playback.reset(node as any);
  let ready!:()=>void,settled=false;
  const inspected=positionVideo(node,2,true,false,false,()=>new Promise<void>(resolve=>ready=resolve)).then(()=>settled=true);
  await flush();assert.equal(settled,false);ready();await inspected;assert.equal(node.__frameReady,true);assert.equal(node.currentTime,2);s.playback.dispose();
});
