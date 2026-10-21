import test from 'node:test';
import assert from 'node:assert/strict';
import {installBAPreviewMediaPlayback,installBAPreviewPlayback} from '../src/studio/ba-preview-playback';
import {getTemplate} from '../src/studio/domain';
// Native engine is read-only. The test substitutes only browser video devices.
// @ts-ignore frozen JavaScript module
import {MediaEngine} from '../public/library/v1.7.0/BTV_BA_1P/media.mjs';
class Video extends EventTarget{
  tagName='VIDEO';currentTime=0;readyState=4;seeking=false;error=null;paused=true;playbackRate=1;volume=1;muted=true;playCount=0;pauseCount=0;
  playResult:Promise<void>=Promise.resolve();
  play(){this.playCount++;this.paused=false;return this.playResult;}
  pause(){this.pauseCount++;this.paused=true;}removeAttribute(){}load(){}remove(){}
}
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function callbacks(node:Video){
 let id=0;const pending=new Map<number,VideoFrameRequestCallback>();
 Object.assign(node,{requestVideoFrameCallback:(callback:VideoFrameRequestCallback)=>{pending.set(++id,callback);return id;},cancelVideoFrameCallback:(id:number)=>pending.delete(id),getVideoPlaybackQuality:()=>({totalVideoFrames:0,droppedVideoFrames:0})});
 return {pending,frame:(time:number)=>{const listeners=[...pending.values()];pending.clear();for(const callback of listeners)callback(time*1000,{mediaTime:time,presentedFrames:Math.round(time*25)} as VideoFrameCallbackMetadata);}};
}
function setup(){
  const nodes=[new Video(),new Video()],errors:unknown[]=[],engine=new MediaEngine({baseUrl:'http://localhost/graphic.mjs',onError:(e:unknown)=>errors.push(e)});
  for(const kind of ['intro','body','pack'])engine.tracks[kind]={kind,clips:nodes.map(node=>({node,url:'http://localhost/preview-media/v1/ba-programme.mp4',start:0,end:10,length:10,type:'video'})),active:0,rate:1,volume:1,audio:false,loop:false,length:20,request:0,playing:false};
  engine.ensure=async(track:any,index:number)=>track.clips[index].node;
  return {engine,nodes,errors};
}
test('reproduces native sync lock with a pending browser play; preview keeps syncing and Pause releases immediately',async()=>{
  const {engine,nodes}=setup();let finish!:()=>void;nodes[0].playResult=new Promise(resolve=>finish=resolve);
  let nativeSettled=false;void engine.position('body',0,{playing:true}).then(()=>nativeSettled=true);await flush();assert.equal(nativeSettled,false);
  engine.pause();installBAPreviewMediaPlayback(engine);
  await engine.position('body',0,{playing:true});assert.equal(engine.tracks.body.playing,true);
  await engine.position('body',.04,{playing:true});engine.pause();assert.equal(nodes[0].paused,true);
  finish();await flush();assert.equal(nodes[0].paused,true);engine.dispose();
});
test('buffering and a stalled decoder are not chased with repeated seeks',async()=>{
  const {engine,nodes}=setup();let now=0;installBAPreviewMediaPlayback(engine,()=>now);
  await engine.position('body',0,{playing:true});await flush();
  nodes[0].readyState=2;
  for(let i=1;i<=100;i++){now=i*40;await engine.position('body',i*.04,{playing:true});}
  assert.equal(engine.previewPlaybackStatus()[0].seeks,0);assert.equal(engine.previewPlaybackStatus()[0].waiting,true);
  nodes[0].readyState=4;now=4040;await engine.position('body',4.04,{playing:true});assert.equal(engine.previewPlaybackStatus()[0].seeks,1);assert.equal(nodes[0].currentTime,4.04);engine.dispose();
});
test('small drift is tolerated, real drift correction is rate limited and exact inspection remains exact',async()=>{
  const {engine,nodes}=setup();let now=0;installBAPreviewMediaPlayback(engine,()=>now);
  await engine.position('body',.2,{playing:true});assert.equal(nodes[0].currentTime,0);await flush();
  nodes[0].currentTime=.04;now=40;await engine.position('body',.8,{playing:true});assert.equal(nodes[0].currentTime,.8);
  nodes[0].currentTime=.84;now=80;await engine.position('body',1.5,{playing:true});assert.equal(nodes[0].currentTime,.84);
  await engine.position('body',1.5,{exact:true});assert.equal(nodes[0].currentTime,1.5);assert.equal(nodes[0].paused,true);engine.dispose();
});
test('pending seek is cancellable by Pause and cannot restart afterwards',async()=>{
  const {engine,nodes}=setup();installBAPreviewMediaPlayback(engine);nodes[0].seeking=true;
  const pending=engine.position('body',5,{playing:true,exact:true});await flush();engine.pause();await pending;
  nodes[0].seeking=false;nodes[0].dispatchEvent(new Event('seeked'));await flush();assert.equal(nodes[0].playCount,0);engine.dispose();
});
test('clip changes, wrapping, completion and actual play errors retain native behavior',async()=>{
  const {engine,nodes,errors}=setup();installBAPreviewMediaPlayback(engine);
  await engine.position('body',12,{playing:true});assert.equal(engine.tracks.body.active,1);assert.equal(nodes[1].currentTime,2);await flush();
  engine.tracks.body.loop=true;await engine.position('body',20.5,{playing:true});assert.equal(engine.tracks.body.active,0);assert.equal(nodes[0].currentTime,.5);await flush();
  engine.tracks.body.loop=false;await engine.position('body',22,{playing:true});assert.equal(engine.tracks.body.finished,true);assert.equal(nodes[1].paused,true);
  nodes[1].playResult=Promise.reject(Error('unsupported'));await engine.position('body',13,{playing:true,exact:true});await flush();assert.equal(errors.length,1);engine.dispose();
});
test('short single-clip loops wrap even when their duration is below the drift tolerance',async()=>{
  const {engine,nodes}=setup();const track=engine.tracks.body;track.clips=[{node:nodes[0],start:10,end:10.2,length:.2,type:'video'}];track.length=.2;track.loop=true;
  installBAPreviewMediaPlayback(engine);await engine.position('body',.19,{exact:true});await engine.position('body',.21,{playing:true});assert.ok(Math.abs(nodes[0].currentTime-10.01)<.001);engine.dispose();
});
test('an old pending play promise cannot prevent the next clip from starting',async()=>{
  const {engine,nodes}=setup();nodes[0].playResult=new Promise(()=>{});installBAPreviewMediaPlayback(engine);
  await engine.position('body',0,{playing:true});await engine.position('body',10,{playing:true});assert.equal(nodes[1].playCount,1);engine.dispose();
});
test('a decoder frozen with sufficient data receives bounded recovery, then an error',async()=>{
  const {engine,nodes}=setup();let now=0;installBAPreviewMediaPlayback(engine,()=>now);await engine.position('body',0,{playing:true});await flush();
  now=1600;await engine.position('body',1.6,{playing:true});await flush();assert.equal(nodes[0].playCount,2);
  now=3200;await engine.position('body',3.2,{playing:true});await flush();assert.equal(nodes[0].playCount,3);
  now=4800;await assert.rejects(engine.position('body',4.8,{playing:true}),/deux reprises/);engine.dispose();
});
test('Mute during seek is immediate and a superseded play rejection is ignored',async()=>{
  const {engine,nodes,errors}=setup();engine.tracks.body.audio=true;installBAPreviewMediaPlayback(engine);
  nodes[0].seeking=true;const seek=engine.position('body',1,{playing:true,muted:false,exact:true});await flush();assert.equal(nodes[0].muted,false);
  await engine.position('body',1,{playing:true,muted:true});assert.equal(nodes[0].muted,true);engine.pause();await seek;nodes[0].seeking=false;
  let reject!:(error:Error)=>void;nodes[0].playResult=new Promise((_,r)=>reject=r);await engine.position('body',1,{playing:true});engine.pause();
  nodes[0].playResult=Promise.resolve();await engine.position('body',1,{playing:true});reject(Error('late'));await flush();assert.equal(errors.length,0);assert.equal(nodes[0].paused,false);engine.dispose();
});

test('a long deliberate pause does not count as a decoder stall on resume',async()=>{
  const {engine}=setup();let now=0;installBAPreviewMediaPlayback(engine,()=>now);
  await engine.position('body',0,{playing:true});await flush();engine.pause();
  now=30000;await engine.position('body',0,{playing:true});await flush();
  assert.equal(engine.previewPlaybackStatus()[0].seeks,0,'Resume must not seek because time was spent paused');engine.dispose();
});

test('a moving source clock without new decoded frames triggers bounded recovery',async()=>{
  const {engine,nodes}=setup();let now=0,decoded=30;
  Object.assign(nodes[0],{getVideoPlaybackQuality:()=>({totalVideoFrames:decoded,droppedVideoFrames:0})});
  installBAPreviewMediaPlayback(engine,()=>now);
  await engine.position('body',0,{playing:true});await flush();
  for(let i=1;i<=40;i++){now=i*40;nodes[0].currentTime=i*.04;await engine.position('body',i*.04,{playing:true});await flush();}
  assert.equal(nodes[0].playCount,2,'currentTime advances but the decoder supplied no new frame');
  for(let i=41;i<=80;i++){now=i*40;nodes[0].currentTime=i*.04;await engine.position('body',i*.04,{playing:true});await flush();}
  await assert.rejects(async()=>{for(let i=81;i<=120;i++){now=i*40;nodes[0].currentTime=i*.04;await engine.position('body',i*.04,{playing:true});await flush();}},/deux reprises/);
  engine.dispose();
});

test('waiting for data is bounded even when no seek is outstanding',async()=>{
  const {engine,nodes}=setup();let now=0;installBAPreviewMediaPlayback(engine,()=>now);
  await engine.position('body',0,{playing:true});await flush();nodes[0].readyState=2;
  now=16000;await assert.rejects(engine.position('body',8,{playing:true}),/données|réseau/i);engine.dispose();
});

test('one delayed decoded frame per recovery seek never erases the retry budget',async()=>{
  const {engine,nodes}=setup();let now=0,decoded=30;
  Object.assign(nodes[0],{getVideoPlaybackQuality:()=>({totalVideoFrames:decoded,droppedVideoFrames:0})});
  installBAPreviewMediaPlayback(engine,()=>now);await engine.position('body',0,{playing:true});await flush();
  for(let i=0;i<2;i++){
    now+=1601;await engine.position('body',now/1000,{playing:true});await flush();
    decoded++;now++;await engine.position('body',now/1000,{playing:true});
  }
  now+=1601;await assert.rejects(engine.position('body',now/1000,{playing:true}),/deux reprises/);engine.dispose();
});

test('real sustained decoding resets the recovery budget; an explicit seek starts a fresh attempt',async()=>{
  const {engine,nodes}=setup();let now=0,decoded=30;
  Object.assign(nodes[0],{getVideoPlaybackQuality:()=>({totalVideoFrames:decoded,droppedVideoFrames:0})});
  installBAPreviewMediaPlayback(engine,()=>now);await engine.position('body',0,{playing:true});await flush();
  now=1600;await engine.position('body',1.6,{playing:true});await flush();assert.equal(engine.previewPlaybackStatus()[0].recoveries,1);
  for(let i=1;i<=15;i++){now+=40;decoded++;nodes[0].currentTime=now/1000;await engine.position('body',now/1000,{playing:true});}
  assert.equal(engine.previewPlaybackStatus()[0].recoveries,0);
  now+=1600;await engine.position('body',now/1000,{playing:true});await flush();assert.equal(engine.previewPlaybackStatus()[0].recoveries,1);
  await engine.position('body',2,{exact:true});assert.equal(engine.previewPlaybackStatus()[0].recoveries,0);engine.dispose();
});

test('zero, missing and throwing quality counters do not manufacture decoder stalls',async()=>{
  for(const quality of [undefined,()=>({totalVideoFrames:0,droppedVideoFrames:0}),()=>{throw Error('unsupported');}]){
    const {engine,nodes}=setup();let now=0;Object.assign(nodes[0],{getVideoPlaybackQuality:quality});
    installBAPreviewMediaPlayback(engine,()=>now);
    for(let i=0;i<150;i++){now=i*40;nodes[0].currentTime=i*.04;await engine.position('body',i*.04,{playing:true});await flush();}
    const status=engine.previewPlaybackStatus()[0];assert.equal(status.seeks,0);assert.equal(status.progressSignal,'source-clock');assert.equal(status.decodedFrames,null);engine.dispose();
  }
});

test('slow motion and a deliberate inactive interval do not exhaust recovery attempts',async()=>{
  const {engine,nodes}=setup();let now=0,decoded=30;
  Object.assign(nodes[0],{getVideoPlaybackQuality:()=>({totalVideoFrames:decoded,droppedVideoFrames:0})});
  const track=engine.tracks.body;track.rate=.1;track.length=200;installBAPreviewMediaPlayback(engine,()=>now);
  for(let i=0;i<150;i++){now=i*40;nodes[0].currentTime=i*.004;if(i%10===0)decoded++;await engine.position('body',i*.04,{playing:true});await flush();}
  assert.equal(engine.previewPlaybackStatus()[0].recoveries,0);
  await engine.sync(72.92,{playing:true});now=90000;await engine.position('body',6,{playing:true});assert.equal(engine.previewPlaybackStatus()[0].recoveries,0);engine.dispose();
});

test('unknown and VFR sources may intentionally hold a frame while their source clock advances',async()=>{
  for(const url of ['blob:http://localhost/local-video','https://other.example/preview-media/v1/ba-programme.mp4','http://localhost/local.mp4']){
    const {engine,nodes}=setup();let now=0;engine.tracks.body.clips[0].url=url;
    Object.assign(nodes[0],{getVideoPlaybackQuality:()=>({totalVideoFrames:30,droppedVideoFrames:0})});
    installBAPreviewMediaPlayback(engine,()=>now);
    for(let i=0;i<150;i++){now=i*40;nodes[0].currentTime=i*.04;await engine.position('body',i*.04,{playing:true});await flush();}
    const status=engine.previewPlaybackStatus()[0];assert.equal(status.recoveries,0);assert.equal(status.progressSignal,'source-clock');assert.equal(status.decodedFrames,30);engine.dispose();
  }
});

test('a resolved play request which did not start the device is not retried every animation tick',async()=>{
  const {engine,nodes}=setup();let now=0;nodes[0].play=()=>{nodes[0].playCount++;return Promise.resolve();};
  installBAPreviewMediaPlayback(engine,()=>now);
  for(let i=0;i<25;i++){now=i*40;await engine.position('body',i*.04,{playing:true});await flush();}
  assert.equal(nodes[0].playCount,2);engine.pause();await engine.position('body',.96,{playing:true});assert.equal(nodes[0].playCount,3,'Deliberate resume stays immediate');engine.dispose();
});

test('observed frame callbacks detect a frozen known proxy when quality counters remain zero',async()=>{
 const {engine,nodes}=setup();let now=0;const source=callbacks(nodes[0]);installBAPreviewMediaPlayback(engine,()=>now);
 await engine.position('body',0,{playing:true});await flush();
 for(let i=1;i<=3;i++){now=i*40;nodes[0].currentTime=i*.04;source.frame(i*.04);await engine.position('body',i*.04,{playing:true});await flush();}
 assert.equal(engine.previewPlaybackStatus()[0].progressSignal,'video-frame-callback');
 await assert.rejects(async()=>{for(let i=4;i<=130;i++){now=i*40;nodes[0].currentTime=i*.04;await engine.position('body',i*.04,{playing:true});await flush();}},/deux reprises/);
 assert.equal(engine.previewPlaybackStatus()[0].recoveries,2);engine.dispose();assert.equal(source.pending.size,0);
});

test('unavailable or unproven frame callbacks never manufacture a decoder stall',async()=>{
 for(const kind of ['silent','single','same-timestamp','throwing','user-source']){
  const {engine,nodes}=setup();let now=0;const source=callbacks(nodes[0]);
  if(kind==='throwing')Object.assign(nodes[0],{requestVideoFrameCallback:()=>{throw Error('unsupported');}});
  if(kind==='user-source')engine.tracks.body.clips[0].url='blob:http://localhost/user-vfr';
  installBAPreviewMediaPlayback(engine,()=>now);
  for(let i=0;i<150;i++){now=i*40;nodes[0].currentTime=i*.04;if(i===1||kind==='same-timestamp')source.frame(.04);await engine.position('body',i*.04,{playing:true});await flush();}
  const status=engine.previewPlaybackStatus()[0];assert.equal(status.recoveries,0,kind);assert.equal(status.progressSignal,'source-clock',kind);engine.dispose();assert.equal(source.pending.size,0);
 }
});

test('frame observers are released on Pause, clip changes and disposal; late callbacks are harmless',async()=>{
 const {engine,nodes}=setup();const first=callbacks(nodes[0]),second=callbacks(nodes[1]);installBAPreviewMediaPlayback(engine);
 await engine.position('body',0,{playing:true});await flush();const late=[...first.pending.values()][0];assert.equal(first.pending.size,1);
 engine.pause();assert.equal(first.pending.size,0);late(0,{mediaTime:.04} as VideoFrameCallbackMetadata);assert.equal(first.pending.size,0);
 await engine.position('body',0,{playing:true});assert.equal(first.pending.size,1);
 await engine.position('body',10,{playing:true});assert.equal(first.pending.size,0);assert.equal(second.pending.size,1);
 engine.dispose();assert.equal(second.pending.size,0);
});

test('continuous observed frames, including slow motion, do not trigger recovery',async()=>{
 for(const rate of [1,.1]){
  const {engine,nodes}=setup();let now=0;const source=callbacks(nodes[0]);engine.tracks.body.rate=rate;engine.tracks.body.length=200;
  installBAPreviewMediaPlayback(engine,()=>now);
  for(let i=0;i<150;i++){now=i*40;nodes[0].currentTime=i*.04*rate;if(i%(rate===1?1:10)===0)source.frame(nodes[0].currentTime);await engine.position('body',i*.04,{playing:true});await flush();}
  const status=engine.previewPlaybackStatus()[0];assert.equal(status.recoveries,0);assert.equal(status.seeks,0);assert.equal(status.progressSignal,'video-frame-callback');
  await engine.sync(72.92,{playing:true});assert.equal(source.pending.size,0,'Inactive native track releases observation');engine.dispose();
 }
});

test('decoded counters take priority; a callback API that fails later falls back safely',async()=>{
 for(const failure of [false,true]){
  const {engine,nodes}=setup();let now=0;const source=callbacks(nodes[0]);installBAPreviewMediaPlayback(engine,()=>now);
  for(let i=0;i<150;i++){
   now=i*40;nodes[0].currentTime=i*.04;
   if(i===5)Object.assign(nodes[0],failure?{requestVideoFrameCallback:()=>{throw Error('device stopped callback support');}}:{getVideoPlaybackQuality:()=>({totalVideoFrames:now/40+1,droppedVideoFrames:0})});
   source.frame(i*.04);await engine.position('body',i*.04,{playing:true});await flush();
  }
  assert.equal(engine.previewPlaybackStatus()[0].recoveries,0);assert.equal(engine.previewPlaybackStatus()[0].progressSignal,failure?'source-clock':'decoded-frames');assert.equal(source.pending.size,0);engine.dispose();
 }
});

test('one callback per recovery seek is not sustained playback',async()=>{
 const {engine,nodes}=setup();let now=0;const source=callbacks(nodes[0]);installBAPreviewMediaPlayback(engine,()=>now);
 await engine.position('body',0,{playing:true});await flush();
 for(let i=1;i<=3;i++){now=i*40;nodes[0].currentTime=i*.04;source.frame(i*.04);await engine.position('body',i*.04,{playing:true});}
 for(let i=0;i<2;i++){now+=1601;await engine.position('body',now/1000,{playing:true});await flush();now++;source.frame(now/1000);await engine.position('body',now/1000,{playing:true});}
 now+=1601;await assert.rejects(engine.position('body',now/1000,{playing:true}),/deux reprises/);engine.dispose();
});

test('an outgoing seek cannot hold the real-time sync slot or prevent the ready body from starting',async()=>{
  const {engine,nodes}=setup();installBAPreviewMediaPlayback(engine);nodes[0].seeking=true;
  // The body has its own ready decoder, as in the real template.
  const body=new Video();engine.tracks.body.clips=[{node:body,url:'http://localhost/preview-media/v1/ba-programme.mp4',start:0,end:30,length:30,type:'video'}];engine.tracks.body.length=30;
  engine.tracks.intro.active=1; // A source change must await an actual seek.
  let firstSettled=false;void engine.sync(5.4,{playing:true}).then(()=>firstSettled=true);await flush();
  assert.equal(firstSettled,true,'A real-time tick must not await the outgoing decoder');
  await engine.sync(5.64,{playing:true});await flush();
  assert.equal(engine.tracks.intro.playing,false);assert.equal(body.paused,false);assert.equal(body.playCount,1);
  nodes[0].seeking=false;nodes[0].dispatchEvent(new Event('seeked'));await flush();
  assert.equal(nodes[0].playCount,0,'An inactive seek cannot restart its old source');engine.dispose();
});

test('exact sync still awaits the requested frame and Pause releases it',async()=>{
  const {engine,nodes}=setup();installBAPreviewMediaPlayback(engine);nodes[0].seeking=true;
  let settled=false;const pending=engine.sync(1,{playing:false,exact:true}).then(()=>settled=true);await flush();
  assert.equal(settled,false);engine.pause();await pending;assert.equal(settled,true);assert.equal(nodes[0].playCount,0);engine.dispose();
});

test('real-time sync reports an active failure once but ignores failures after Pause or disposal',async()=>{
  for(const ending of ['active','pause','dispose']){
    const {engine,errors}=setup();installBAPreviewMediaPlayback(engine);let reject!:(error:Error)=>void;
    engine.ensure=()=>new Promise((_,r)=>reject=r);
    await engine.sync(1,{playing:true});await flush();
    if(ending==='pause')engine.pause();if(ending==='dispose')engine.dispose();
    reject(Error('source lost'));await flush();assert.equal(errors.length,ending==='active'?1:0,ending);engine.dispose();
  }
});

test('automatic short-loop seeks cannot manufacture frame progress or postpone recovery forever',async()=>{
  for(const signal of ['quality','callbacks']){
    const {engine,nodes}=setup();let now=0;const track=engine.tracks.body;
    track.clips=[{...track.clips[0],end:1,length:1}];track.length=1;track.loop=true;
    const observed=signal==='callbacks'?callbacks(nodes[0]):undefined;
    if(!observed)Object.assign(nodes[0],{getVideoPlaybackQuality:()=>({totalVideoFrames:30,droppedVideoFrames:0})});
    installBAPreviewMediaPlayback(engine,()=>now);
    try{
      await assert.rejects(async()=>{for(let i=0;i<250;i++){
        now=i*40;nodes[0].currentTime=(i*.04)%1;if(i<3)observed?.frame(nodes[0].currentTime);
        await engine.position('body',i*.04,{playing:true});await flush();
      }},/deux reprises/,signal);
      assert.equal(engine.previewPlaybackStatus()[0].recoveries,2);
    }finally{engine.dispose();}
  }
});

test('healthy short-loop decoding continues without recovery',async()=>{
  const {engine,nodes}=setup();let now=0,decoded=30;const track=engine.tracks.body;
  track.clips=[{...track.clips[0],end:1,length:1}];track.length=1;track.loop=true;
  Object.assign(nodes[0],{getVideoPlaybackQuality:()=>({totalVideoFrames:decoded,droppedVideoFrames:0})});installBAPreviewMediaPlayback(engine,()=>now);
  for(let i=0;i<250;i++){now=i*40;decoded++;nodes[0].currentTime=(i*.04)%1;await engine.position('body',i*.04,{playing:true});await flush();}
  assert.equal(engine.previewPlaybackStatus()[0].recoveries,0);engine.dispose();
});

test('sustained real frames across short wraps renew the recovery budget after a stall',async()=>{
  for(const signal of ['quality','callbacks']){
    const {engine,nodes}=setup();let now=0,decoded=30;const track=engine.tracks.body;
    track.clips=[{...track.clips[0],end:.2,length:.2}];track.length=.2;track.loop=true;
    const observed=signal==='callbacks'?callbacks(nodes[0]):undefined;
    if(!observed)Object.assign(nodes[0],{getVideoPlaybackQuality:()=>({totalVideoFrames:decoded,droppedVideoFrames:0})});
    installBAPreviewMediaPlayback(engine,()=>now);
    const tick=async(healthy:boolean)=>{now+=40;nodes[0].currentTime=(now/1000)%.2;if(healthy){decoded++;observed?.frame(nodes[0].currentTime);}await engine.position('body',now/1000,{playing:true});await flush();};
    try{
      for(let i=0;i<5;i++)await tick(true);
      for(let cycle=0;cycle<3;cycle++){
        for(let i=0;i<40;i++)await tick(false);
        assert.equal(engine.previewPlaybackStatus()[0].recoveries,1,`${signal}: one recovery per freeze`);
        for(let i=0;i<250;i++)await tick(true);
        assert.equal(engine.previewPlaybackStatus()[0].recoveries,0,`${signal}: actual decoding through wraps is healthy`);
      }
    }finally{engine.dispose();}
  }
});

test('a replacement media engine is adapted before exposure while old audio is still closing',async()=>{
  const {engine,nodes}=setup();nodes[0].playResult=new Promise(()=>{});let closeAudio!:()=>void;
  const closing=new Promise<void>(resolve=>closeAudio=resolve);
  const graphic:any={media:undefined,_build:async(_data:unknown,_media:unknown)=>({}),async _update(){await this._build({},engine);this.media=engine;await closing;return {statusCode:200};}};
  installBAPreviewPlayback(graphic,getTemplate('BTV_BA_1P'));const update=graphic._update();await flush();
  try{
    assert.equal(graphic.media,engine);assert.equal(typeof engine.previewPlaybackStatus,'function','Adapt before awaiting old audio disposal');
    let settled=false;void engine.sync(1,{playing:true}).then(()=>settled=true);await flush();assert.equal(settled,true);
    engine.pause();assert.equal(nodes[0].paused,true);
  }finally{closeAudio();await update;engine.dispose();}
});

test('speculative preload failure never stops the current clip, after Pause or after skipping it',async()=>{
  for(const ending of ['playing','pause','skip']){
    const {engine,nodes,errors}=setup();let reject!:(error:Error)=>void;
    const third=new Video(),track=engine.tracks.body;
    track.clips.push({...track.clips[0],node:third});track.length=30;
    track.clips[1].node=null;
    const failure=new Promise((_,r)=>reject=r);
    engine.ensure=async(t:any,index:number)=>index===1?failure:(t.clips[index].node??=index===2?third:nodes[0]);
    installBAPreviewMediaPlayback(engine);
    try{
      await engine.position('body',0,{playing:true});await flush();
      if(ending==='pause')engine.pause();
      if(ending==='skip')await engine.position('body',20,{playing:true});
      reject(Error('Future clip unavailable'));await flush();
      assert.equal(errors.length,0,ending);
      assert.equal((ending==='skip'?third:nodes[0]).paused,ending==='pause');
      if(ending!=='pause')await assert.rejects(engine.position('body',10,{playing:true}),/Future clip/,'Selecting the failed clip must still report its failure');
    }finally{engine.dispose();}
  }
});

test('a failed neighbour is not retried on every tick, but selecting it can retry',async()=>{
  const {engine,errors}=setup();let reads=0;
  engine.tracks.body.clips[1].node=null;
  engine.ensure=async(t:any,index:number)=>{if(index===1){reads++;throw Error('network down');}return t.clips[index].node;};
  installBAPreviewMediaPlayback(engine);
  try{
    for(let i=0;i<25;i++){await engine.position('body',i*.04,{playing:true});await flush();}
    assert.equal(reads,1,'Only one speculative attempt during this passage');assert.equal(errors.length,0);
    await assert.rejects(engine.position('body',10,{playing:true}),/network down/);assert.equal(reads,2,'The requested clip gets a fresh foreground attempt');
  }finally{engine.dispose();}
});

test('passing a clip end cancels its old pending seek and cannot restart finished media',async()=>{
  const {engine,nodes}=setup(),track=engine.tracks.body;track.clips=[track.clips[0]];track.length=10;
  installBAPreviewMediaPlayback(engine);nodes[0].seeking=true;
  const old=engine.position('body',9,{playing:true,exact:true});await flush();
  const end=engine.position('body',11,{playing:true});await flush();
  try{
    assert.equal(track.finished,true);assert.equal(track.playing,false);
    nodes[0].seeking=false;nodes[0].dispatchEvent(new Event('seeked'));await Promise.all([old,end]);await flush();
    assert.equal(nodes[0].playCount,0);assert.equal(nodes[0].paused,true);
  }finally{engine.dispose();await Promise.all([old,end]);}
});

test('an already failed selected video cannot masquerade as a ready frame',async()=>{
  const {engine,nodes}=setup();installBAPreviewMediaPlayback(engine);
  Object.assign(nodes[0],{error:{code:3}});
  try{await assert.rejects(engine.position('body',0,{playing:true}),/codec|décodage/);assert.equal(nodes[0].playCount,0);}
  finally{engine.dispose();}
});

test('a source-clock-only short loop cannot hide a stationary decoder through its own seeks',async()=>{
  const {engine}=setup();let now=0;const track=engine.tracks.body;
  track.clips=[{...track.clips[0],end:.2,length:.2}];track.length=.2;track.loop=true;
  installBAPreviewMediaPlayback(engine,()=>now);
  try{
    await assert.rejects(async()=>{for(let i=0;i<500;i++){now=i*40;await engine.position('body',i*.04,{playing:true});await flush();}},/deux reprises/);
    assert.equal(engine.previewPlaybackStatus()[0].progressSignal,'source-clock');
  }finally{engine.dispose();}
});

test('a mute change during a pending load is retained when the video becomes ready',async()=>{
  const {engine,nodes}=setup();const track=engine.tracks.body;track.audio=true;track.clips=[{...track.clips[0],node:null}];track.length=10;
  let complete!:(node:Video)=>void;engine.ensure=()=>new Promise(resolve=>complete=resolve);installBAPreviewMediaPlayback(engine);
  const loading=engine.position('body',0,{playing:true,muted:false});await flush();
  await engine.position('body',.04,{playing:true,muted:true});
  try{complete(nodes[0]);await loading;await flush();assert.equal(nodes[0].muted,true);assert.equal(nodes[0].playCount,1);}
  finally{engine.dispose();}
});

test('healthy short-loop clocks progress naturally at normal, slow and fast playback rates',async()=>{
  for(const length of [.04,.2,1])for(const rate of [.0625,.1,1,4]){
    const {engine,nodes}=setup();let now=0;const track=engine.tracks.body;
    track.clips=[{...track.clips[0],end:length,length}];track.length=length/rate;track.rate=rate;track.loop=true;
    installBAPreviewMediaPlayback(engine,()=>now);
    try{
      for(let i=0;i<500;i++){now=i*40;nodes[0].currentTime=(now/1000*rate)%length;await engine.position('body',now/1000,{playing:true});await flush();}
      assert.equal(engine.previewPlaybackStatus()[0].recoveries,0,`${length}s @ ${rate}x`);
    }finally{engine.dispose();}
  }
});

test('one pending future load has one observer and may preload again after foreground success and eviction',async()=>{
  const {engine,nodes,errors}=setup();const track=engine.tracks.body;track.loop=true;track.clips[1].node=null;
  let reads=0,reject!:(e:Error)=>void;const pending=new Promise((_,r)=>reject=r);
  engine.ensure=async(t:any,index:number)=>{if(index===1){reads++;if(reads===1)return pending;}return t.clips[index].node??=nodes[index];};
  installBAPreviewMediaPlayback(engine);
  try{
    for(let i=0;i<25;i++){await engine.position('body',i*.04,{playing:true});await flush();}
    assert.equal(reads,1);reject(Error('transient'));await flush();assert.equal(errors.length,0);
    await engine.position('body',10,{playing:true});assert.equal(reads,2);assert.equal(nodes[1].paused,false);
    track.clips[1].node=null;
    await engine.position('body',20,{playing:true});await flush();assert.equal(reads,3);
  }finally{engine.dispose();}
});

test('automatic short sequences retain each frozen decoder budget across source changes',async()=>{
  for(const signal of ['quality','callbacks','clock','pending-play']){
    const {engine,nodes}=setup();let now=0;const track=engine.tracks.body;
    track.clips=track.clips.map((clip:any)=>({...clip,end:.2,length:.2}));track.length=.4;track.loop=true;
    const observations=signal==='callbacks'?nodes.map(callbacks):undefined;
    if(signal==='quality')for(const node of nodes)Object.assign(node,{getVideoPlaybackQuality:()=>({totalVideoFrames:30,droppedVideoFrames:0})});
    if(signal==='pending-play')for(const node of nodes)node.play=()=>{node.playCount++;return new Promise(()=>{});};
    installBAPreviewMediaPlayback(engine,()=>now);
    try{
      await assert.rejects(async()=>{for(let i=0;i<1500;i++){
        now=i*40;const next=engine.locate(track,now/1000),node=nodes[next.index];
        if(signal==='quality'||signal==='callbacks')node.currentTime=next.time;
        if(i<20)observations?.[next.index].frame(next.time);
        await engine.position('body',now/1000,{playing:true});await flush();
      }},/deux reprises/,signal);
      assert.ok(nodes.reduce((count,node)=>count+node.playCount,0)<80,'A new passage cannot grant unlimited new play attempts');
    }finally{engine.dispose();}
  }
});

test('healthy video between visits cannot erase the other decoder recovery budget',async()=>{
  const {engine,nodes}=setup();let now=0,healthyFrames=30;const track=engine.tracks.body;
  track.clips=track.clips.map((clip:any)=>({...clip,end:.2,length:.2}));track.length=.4;track.loop=true;
  Object.assign(nodes[0],{getVideoPlaybackQuality:()=>({totalVideoFrames:30,droppedVideoFrames:0})});
  Object.assign(nodes[1],{getVideoPlaybackQuality:()=>({totalVideoFrames:healthyFrames,droppedVideoFrames:0})});
  installBAPreviewMediaPlayback(engine,()=>now);
  try{
    await assert.rejects(async()=>{for(let i=0;i<1500;i++){
      now=i*40;const next=engine.locate(track,now/1000);
      if(next.index===1){healthyFrames++;nodes[1].currentTime=next.time;}
      await engine.position('body',now/1000,{playing:true});await flush();
      if(next.index===1)assert.equal(engine.previewPlaybackStatus()[0].recoveries,0,'The healthy source keeps its own budget');
    }},/deux reprises/);
    assert.equal(track.active,0,'Only the repeatedly frozen decoder fails');
  }finally{engine.dispose();}
});

test('evicting and recreating decoders in a three-clip sequence is not recovery by itself',async()=>{
  for(const healthy of [false,true]){
    const {engine}=setup();let now=0,created=0;const track=engine.tracks.body;
    track.clips=[0,1,2].map(()=>({...track.clips[0],node:null,end:.2,length:.2}));track.length=.6;track.loop=true;
    engine.ensure=async(t:any,index:number)=>{
      const clip=t.clips[index];if(clip.node)return clip.node;
      const node=Object.assign(new Video(),{frames:30,getVideoPlaybackQuality(){return {totalVideoFrames:this.frames,droppedVideoFrames:0};}});
      created++;clip.node=node;return node;
    };
    installBAPreviewMediaPlayback(engine,()=>now);
    const run=async()=>{for(let i=0;i<1500;i++){
      now=i*40;
      if(healthy)for(const clip of track.clips)if(clip.node&&!clip.node.paused){clip.node.currentTime+=.04;clip.node.frames++;}
      await engine.position('body',now/1000,{playing:true});await flush();
      if(healthy)assert.equal(engine.previewPlaybackStatus()[0].recoveries,0);
    }};
    try{
      if(healthy)await run();else await assert.rejects(run,/deux reprises/);
      assert.ok(created>3,'The native current/next policy recreated devices');
    }finally{engine.dispose();}
  }
});

test('short healthy sequences and legitimate one-frame excerpts work at all preview rates',async()=>{
  for(const length of [.04,.2,1])for(const rate of [.0625,.1,1,4])for(const signal of ['clock','quality']){
    const {engine,nodes}=setup();let now=0;const track=engine.tracks.body,frames=[30,30];
    track.clips=track.clips.map((clip:any)=>({...clip,end:length,length}));track.length=2*length/rate;track.rate=rate;track.loop=true;
    if(signal==='quality')nodes.forEach((node,index)=>Object.assign(node,{getVideoPlaybackQuality:()=>({totalVideoFrames:frames[index],droppedVideoFrames:0})}));
    installBAPreviewMediaPlayback(engine,()=>now);
    try{
      for(let i=0;i<1500;i++){
        now=i*40;
        for(let index=0;index<nodes.length;index++)if(!nodes[index].paused){
          nodes[index].currentTime+=.04*rate;
          if(length>.04)frames[index]++;
        }
        await engine.position('body',now/1000,{playing:true});await flush();
        assert.equal(engine.previewPlaybackStatus()[0].recoveries,0,`${signal}: ${length}s @ ${rate}x`);
      }
    }finally{engine.dispose();}
  }
});

test('time outside a decoder and time awaiting a cancelled seek are not playback opportunities',async()=>{
  const {engine,nodes}=setup();let now=0;const track=engine.tracks.body;
  track.clips=track.clips.map((clip:any)=>({...clip,end:1,length:1}));track.length=2;track.loop=true;
  for(const node of nodes)Object.assign(node,{getVideoPlaybackQuality:()=>({totalVideoFrames:30,droppedVideoFrames:0})});
  installBAPreviewMediaPlayback(engine,()=>now);
  try{
    await engine.position('body',0,{playing:true});await flush();
    now=100;await engine.position('body',1,{playing:true});await flush();
    now=200;nodes[0].seeking=true;const pending=engine.position('body',2,{playing:true});await flush();
    now=10000;await engine.position('body',3,{playing:true});await pending;await flush();
    nodes[0].seeking=false;nodes[0].dispatchEvent(new Event('seeked'));
    now=10100;await engine.position('body',4,{playing:true});await flush();
    assert.equal(engine.previewPlaybackStatus()[0].recoveries,0);
    assert.ok(engine.previewPlaybackStatus()[0].withoutProgressMs<500);
    engine.pause();now+=60000;await engine.position('body',4,{playing:true});
    assert.equal(engine.previewPlaybackStatus()[0].recoveries,0,'A deliberate resume starts a fresh attempt');
  }finally{engine.dispose();}
});

test('a held VFR frame, a still-image passage and an explicit seek keep their intended behavior',async()=>{
  const {engine,nodes}=setup();let now=0;const track=engine.tracks.body;
  track.clips=track.clips.map((clip:any)=>({...clip,url:'blob:http://localhost/user-vfr',end:.2,length:.2}));track.length=.4;track.loop=true;
  for(const node of nodes)Object.assign(node,{getVideoPlaybackQuality:()=>({totalVideoFrames:30,droppedVideoFrames:0})});
  installBAPreviewMediaPlayback(engine,()=>now);
  try{
    for(let i=0;i<1500;i++){
      now=i*40;for(const node of nodes)if(!node.paused)node.currentTime+=.04;
      await engine.position('body',now/1000,{playing:true});await flush();
    }
    assert.equal(engine.previewPlaybackStatus()[0].recoveries,0,'A moving VFR clock can legitimately hold decoded pixels');
    const image=new Video();image.tagName='IMG';track.clips[1]={...track.clips[1],node:image,type:'image',end:30,length:30};track.length=30.2;
    await engine.position('body',0,{playing:false,exact:true});
    await engine.position('body',0,{playing:true});now+=200;await engine.position('body',.2,{playing:true});
    now+=30000;await engine.position('body',30.2,{playing:true});
    assert.equal(engine.previewPlaybackStatus()[0].recoveries,0,'Displaying a still image is not stalled video time');
    for(let i=0;i<40;i++){now+=40;await engine.position('body',0,{playing:true});await flush();}
    assert.equal(engine.previewPlaybackStatus()[0].recoveries,1);
    await engine.position('body',0,{playing:false,exact:true});now+=30000;
    await engine.position('body',0,{playing:true});
    assert.equal(engine.previewPlaybackStatus()[0].recoveries,0,'Inspection deliberately resets previous playback attempts');
  }finally{engine.dispose();}
});

test('an intro failure already in transit cannot stop the next body, which still reports its own failure',async()=>{
  const {engine,nodes,errors}=setup();const body=new Video();
  engine.tracks.body.clips=[{...engine.tracks.body.clips[0],node:body,end:30,length:30}];engine.tracks.body.length=30;
  let reject!:(error:Error)=>void;const loading=new Promise((_,r)=>reject=r);
  engine.ensure=(track:any,index:number)=>track.kind==='intro'?loading:Promise.resolve(track.clips[index].node);
  installBAPreviewMediaPlayback(engine);
  try{
    await engine.sync(5.4,{playing:true});await flush();reject(Error('old intro failure'));
    // Let position reject while Promise.all is still forwarding its failure.
    for(let i=0;i<3;i++)await Promise.resolve();
    assert.equal(errors.length,0);await engine.sync(5.64,{playing:true});await flush();
    assert.equal(engine.tracks.intro.playing,false);assert.equal(body.paused,false);assert.equal(errors.length,0);
    Object.assign(body,{error:{code:3}});await engine.sync(5.68,{playing:true});await flush();
    assert.equal(errors.length,1);assert.match(String(errors[0]),/codec|décodage/);
  }finally{engine.dispose();}
});
