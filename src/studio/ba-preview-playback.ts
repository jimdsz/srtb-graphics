import type {BroadcastTemplate} from './domain';
import type {LegacyGraphic} from './video/engine';
import {knownBAPreviewProxy} from './preview-range-probe';

type Track = {active:number; request:number; clips:any[]; rate:number; volume:number; audio:boolean; loop:boolean; playing:boolean; finished:boolean; lastTime:number};
type FrameObserver = {node:HTMLVideoElement; active:boolean; id?:number; count:number; mediaTime?:number};
type ProgressSignal = 'source-clock'|'decoded-frames'|'video-frame-callback';
type Progress = {lastSource:number; decoded:number|null; sampledFrames:number; progressSignal:ProgressSignal; advancedAt:number; healthySince?:number; recoveredAt:number; recoveries:number};
type SavedProgress = Progress & {inactiveAt:number; node:HTMLVideoElement; frames?:Pick<FrameObserver,'count'|'mediaTime'>};
type State = Progress & {abort?:AbortController; request?:number; play?:Promise<void>; node?:HTMLVideoElement; sourceClip?:object; muted:boolean; observer?:FrameObserver; observedVideoFrames:number; correctedAt:number; lastPlayAt:number; seekingAt?:number; waiting:boolean; seeks:number; plays:number; sources:WeakMap<object,SavedProgress>};
class PlaybackFailure extends Error{
  constructor(readonly reason:unknown,readonly current:()=>boolean){super(reason instanceof Error?reason.message:String(reason));this.name=reason instanceof Error?reason.name:'Error';}
}
const installed=new WeakSet<object>();
const cancelled=()=>new DOMException('Lecture interrompue','AbortError');
/** Some engines expose this API but always return zero for detached videos.
 * Zero is unknown, not proof of a stalled decoder. Never read source pixels. */
function decodedFrames(node:HTMLVideoElement):number|null{
  try{const q=node.getVideoPlaybackQuality?.(),frames=q&&q.totalVideoFrames-q.droppedVideoFrames;return typeof frames==='number'&&Number.isSafeInteger(frames)&&frames>0?frames:null;}catch{return null;}
}
/** Only our fixed-rate preview proxies have a known frame cadence. A user VFR
 * video may intentionally hold an image for seconds while its clock advances. */
function fixedRatePreview(url:unknown,baseUrl:string){
  return !!knownBAPreviewProxy(url,baseUrl);
}
function stopFrames(state:State){
  const observer=state.observer;if(!observer)return;
  observer.active=false;
  try{if(observer.id!==undefined)observer.node.cancelVideoFrameCallback?.(observer.id);}catch{/* Invalidation also protects against a late callback. */}
  state.observer=undefined;state.sampledFrames=0;
}
/** Observation only: never gate drawing on compositor callbacks. Detached
 * video elements may expose this API without ever delivering a callback. */
function observeFrames(state:State,node:HTMLVideoElement,playing:()=>boolean,previous?:Pick<FrameObserver,'count'|'mediaTime'>){
  if(state.observer?.node===node)return;
  stopFrames(state);
  if(typeof node.requestVideoFrameCallback!=='function')return;
  const observer:FrameObserver={node,active:true,count:previous?.count??0,mediaTime:previous?.mediaTime};state.observer=observer;
  const request=()=>{
    if(!observer.active||!playing())return;
    try{observer.id=node.requestVideoFrameCallback((_time,metadata)=>{
      if(!observer.active)return;
      observer.id=undefined;
      if(!playing()){observer.active=false;return;}
      if(Number.isFinite(metadata.mediaTime)&&metadata.mediaTime!==observer.mediaTime){observer.count++;state.observedVideoFrames++;observer.mediaTime=metadata.mediaTime;}
      request();
    });}catch{observer.active=false;}
  };
  request();
}
function shiftProgress(state:Progress,elapsed:number){
  state.advancedAt+=elapsed;state.recoveredAt+=elapsed;
  if(state.healthySince!==undefined)state.healthySince+=elapsed;
}
function saveProgress(state:State,stamp:number){
  if(!state.node||!state.sourceClip)return;
  const {lastSource,decoded,sampledFrames,progressSignal,advancedAt,healthySince,recoveredAt,recoveries}=state;
  const frames=state.observer?.active?{count:state.observer.count,mediaTime:state.observer.mediaTime}:undefined;
  state.sources.set(state.sourceClip,{lastSource,decoded,sampledFrames,progressSignal,advancedAt,healthySince,recoveredAt,recoveries,inactiveAt:stamp,node:state.node,frames});
}
function interruptible<T>(task:Promise<T>,signal:AbortSignal):Promise<T>{
  return new Promise((resolve,reject)=>{
    const abort=()=>reject(signal.reason||cancelled());
    signal.addEventListener('abort',abort,{once:true});
    void task.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
    if(signal.aborted)abort();
  });
}
function seek(node:HTMLVideoElement,time:number,signal:AbortSignal){
  if(Math.abs(node.currentTime-time)<.002&&!node.seeking&&node.readyState>=2)return Promise.resolve();
  return new Promise<void>((resolve,reject)=>{
    let settled=false;
    const events=['seeked','loadeddata','canplay','progress'];
    const finish=(error?:unknown)=>{if(settled)return;settled=true;clearTimeout(timer);for(const event of events)node.removeEventListener(event,check);node.removeEventListener('error',failed);signal.removeEventListener('abort',abort);error?reject(error):resolve();};
    const check=()=>{if(node.error)failed();else if(!node.seeking&&node.readyState>=2)finish();};
    const failed=()=>finish(Error('Vidéo : source inaccessible ou codec non décodable.'));
    const abort=()=>finish(signal.reason||cancelled());
    const timer=setTimeout(()=>finish(Error('La vidéo ne fournit pas l’image demandée. Relancez l’aperçu ou reconnectez le média.')),15000);
    for(const event of events)node.addEventListener(event,check);node.addEventListener('error',failed);signal.addEventListener('abort',abort,{once:true});
    if(signal.aborted){abort();return;}
    try{node.currentTime=time;check();}catch(error){finish(error);}
  });
}

/** Real-time preview only; export's deterministic engine stays untouched.
 * A 120 ms drift previously triggered another seek while a slow decoder was
 * catching up. Awaiting play() also held the sole media-sync slot indefinitely. */
export function installBAPreviewMediaPlayback(engine:any,now:()=>number=()=>performance.now()){
  if(installed.has(engine))return;installed.add(engine);
  const states=new Map<Track,State>();
  const preloadAttempts=new WeakSet<object>();
  const stateFor=(track:Track)=>{let state=states.get(track);if(!state){state={muted:true,lastSource:NaN,decoded:null,sampledFrames:0,observedVideoFrames:0,progressSignal:'source-clock',advancedAt:now(),correctedAt:-Infinity,recoveredAt:-Infinity,lastPlayAt:-Infinity,waiting:false,seeks:0,plays:0,recoveries:0,sources:new WeakMap()};states.set(track,state);}return state;};
  // The readiness loader also observes device error events. A cached future or
  // outgoing decoder must not stop the currently selected, healthy passage.
  // The foreground position() below still checks errors, including inspection.
  engine.previewMediaErrorCurrent=(track:Track,node:HTMLVideoElement)=>track.playing&&!track.finished&&track.clips[track.active]?.node===node;
  const pause=engine.pause.bind(engine),dispose=engine.dispose.bind(engine);
  let generation=0;
  function finishSeeking(state:State){if(state.seekingAt!==undefined){shiftProgress(state,now()-state.seekingAt);state.seekingAt=undefined;}}
  function cancelTrack(state:State){finishSeeking(state);state.abort?.abort();state.abort=undefined;state.play=undefined;state.waiting=false;state.sources=new WeakMap();stopFrames(state);}
  function cancel(){generation++;for(const state of states.values())cancelTrack(state);}
  engine.pause=()=>{cancel();pause();};
  engine.dispose=()=>{cancel();dispose();states.clear();};
  const sync=engine.sync.bind(engine);
  engine.sync=(...args:any[])=>{
    const token=generation;
    const task=sync(...args);
    // The native engine pauses inactive tracks synchronously, without pause().
    for(const [track,state] of states)if(!track.playing){
      // An inactive native track increments request without calling position.
      // A paused/exact active track also has playing=false, but owns its seek.
      if(state.request!==track.request)cancelTrack(state);else stopFrames(state);
    }
    // A slow outgoing source must not reserve the graphic's only sync slot and
    // prevent the next ready source from starting. position() already bounds
    // work to one request per track. Exact/paused inspection remains awaited.
    if(args[1]?.playing&&!args[1]?.exact){
      void task.catch((error:unknown)=>{if(!engine.disposed&&generation===token&&(!(error instanceof PlaybackFailure)||error.current()))engine.onError(error instanceof PlaybackFailure?error.reason:error);});
      return Promise.resolve();
    }
    return task;
  };
  engine.previewPlaybackStatus=()=>[...states].map(([track,s])=>({kind:(track as any).kind,waiting:s.waiting,pendingPlay:!!s.play,seeks:s.seeks,playRequests:s.plays,recoveries:s.recoveries,sourceSeconds:Number.isFinite(s.lastSource)?s.lastSource:null,decodedFrames:s.decoded,observedVideoFrames:s.observedVideoFrames,progressSignal:s.progressSignal,withoutProgressMs:track.playing?Math.round(Math.max(0,now()-s.advancedAt)):0}));
  engine.position=async(kind:string,elapsed:number,{playing=false,muted=true,exact=false}={})=>{
    const track:Track=engine.tracks[kind];if(!track||engine.disposed)return;
    const state=stateFor(track),next=engine.locate(track,elapsed),changed=next.index!==track.active;
    state.muted=muted;
    // Never continually restart an unfinished seek at a later wall-clock time.
    // Completion is not another tick: cancel the obsolete seek before it can play.
    if(state.abort&&!exact&&!changed&&playing&&!next.finished){const node=track.clips[track.active]?.node;if(node?.tagName==='VIDEO')node.muted=state.muted||!track.audio;return;}
    finishSeeking(state);state.abort?.abort();const controller=new AbortController();state.abort=controller;
    const abort=()=>controller.abort();engine.abort.signal.addEventListener('abort',abort,{once:true});
    const request=track.request=(track.request||0)+1,current=()=>!engine.disposed&&!controller.signal.aborted&&track.request===request;
    state.request=request;
    const lastElapsed=track.lastTime,wasPlaying=track.playing;
    if(!wasPlaying||!playing||exact)state.sources=new WeakMap();
    track.lastTime=elapsed;track.finished=next.finished;track.playing=playing&&!next.finished;
    if(changed){
      // Automatic sequence transitions are not evidence of decoder recovery.
      // Preserve each decoder's active time, excluding its off-screen interval.
      if(wasPlaying&&playing&&!exact)saveProgress(state,now());
      stopFrames(state);state.node=undefined;state.play=undefined;
      const old=track.clips[track.active]?.node;if(old?.tagName==='VIDEO')old.pause();track.active=next.index;
    }
    if(!track.playing){stopFrames(state);const node=track.clips[track.active]?.node;if(node?.tagName==='VIDEO')node.pause();}
    try{
      const node=await interruptible(Promise.resolve(engine.ensure(track,next.index)),controller.signal);if(!current())return;
      preloadAttempts.delete(track.clips[next.index]);
      if(node.tagName==='VIDEO'){
        if(node.error)throw Error('Vidéo : source inaccessible ou codec non décodable.');
        node.playbackRate=track.rate;node.volume=track.volume;node.muted=state.muted||!track.audio||track.finished||!playing;
        const stamp=now(),decoded=decodedFrames(node);
        const clip=track.clips[next.index],changedNode=state.node!==node,saved=changedNode?state.sources.get(clip):undefined;
        if(changedNode){
          stopFrames(state);state.node=node;state.sourceClip=clip;state.play=undefined;state.lastPlayAt=-Infinity;
          if(saved){
            const {inactiveAt,frames:_,node:previous,...progress}=saved;Object.assign(state,progress);shiftProgress(state,stamp-inactiveAt);
            // Sequences with three or more clips evict old devices. A newly
            // loaded device has fresh counters, but is not proven recovery yet.
            if(previous!==node){state.lastSource=node.currentTime;state.decoded=decoded;state.sampledFrames=0;}
          }
        }
        // A one-frame excerpt may legitimately repeat its sole decoded image.
        const singleFrame=track.clips[next.index]?.length<=1/25+.000001;
        const reset=changedNode&&!saved||!wasPlaying||!playing||exact||singleFrame;
        const speed=Math.min(1,Math.max(.0625,track.rate)),healthyMs=500/speed;
        // currentTime may keep advancing while the decoder produces no image.
        // For known fixed-rate proxies only, prefer measured decoded frames.
        const known=fixedRatePreview(track.clips[next.index]?.url,engine.baseUrl);
        if(known&&decoded===null&&track.playing)observeFrames(state,node,()=>!engine.disposed&&track.playing&&track.clips[track.active]?.node===node,saved&&saved.node===node?saved.frames:undefined);
        else stopFrames(state);
        // Require two distinct frame timestamps before trusting a callback API.
        // A single callback (e.g. on seek), zero quality counters or an unsupported
        // API is not proof that a decoder subsequently stalled.
        const observed=state.observer?.active&&(state.observer.count>=2);
        const signal:ProgressSignal=known&&decoded!==null?'decoded-frames':observed?'video-frame-callback':'source-clock';
        const signalChanged=signal!==state.progressSignal;
        const progressed=signal==='decoded-frames'&&state.decoded!==null?(decoded??0)>state.decoded:signal==='video-frame-callback'?(state.observer?.count??0)>state.sampledFrames:Math.abs(node.currentTime-state.lastSource)>.001;
        state.progressSignal=signal;
        if(reset||decoded!==null&&state.decoded!==null&&decoded<state.decoded){state.advancedAt=stamp;state.recoveries=0;state.recoveredAt=-Infinity;state.healthySince=undefined;state.lastPlayAt=-Infinity;}
        else if(signalChanged){if(!saved)state.advancedAt=stamp;state.healthySince=undefined;}
        else if(progressed){
          if(state.healthySince===undefined||stamp-state.advancedAt>healthyMs)state.healthySince=stamp;
          if(stamp-state.healthySince>=healthyMs)state.recoveries=0;
          state.advancedAt=stamp;
        }else if(stamp-state.advancedAt>healthyMs)state.healthySince=undefined;
        state.lastSource=node.currentTime;state.decoded=decoded;state.sampledFrames=state.observer?.count??0;
        // Slow-motion media intentionally supplies fewer new source frames.
        const stallMs=1500/speed,idleMs=stamp-state.advancedAt;
        state.waiting=playing&&!next.finished&&(node.readyState<3||node.seeking||!!state.play&&node.paused||idleMs>healthyMs);
        if(playing&&!next.finished&&idleMs>=Math.max(15000,stallMs*2)&&(node.readyState<3||node.seeking))throw Error('La vidéo ne reçoit plus de données. Vérifiez le réseau ou reconnectez le média, puis relancez l’aperçu. Vos réglages sont conservés.');
        const wrapped=track.loop&&Math.floor(elapsed/(track as any).length)>Math.floor((lastElapsed||0)/(track as any).length);
        // A decoder can stall with HAVE_ENOUGH_DATA too. Try a bounded restart,
        // then surface an actionable failure instead of an endless frozen image.
        const stalled=playing&&!next.finished&&idleMs>=stallMs&&node.readyState>=3&&!node.seeking&&stamp-state.recoveredAt>=stallMs;
        if(stalled){if(state.recoveries>=2)throw Error('La vidéo reste bloquée malgré deux reprises. Relancez l’aperçu ou reconnectez le média. Vos réglages sont conservés.');state.recoveries++;state.recoveredAt=stamp;node.pause();state.play=undefined;state.lastPlayAt=-Infinity;}
        const correction=!state.waiting&&Math.abs(node.currentTime-next.time)>.35&&stamp-state.correctedAt>=1000;
        if(exact||changed||wrapped||stalled||!playing&&Math.abs(node.currentTime-next.time)>.002||playing&&correction){
          state.seeks++;state.correctedAt=stamp;state.seekingAt=now();await seek(node,next.time,controller.signal);if(!current())return;
          // Time awaiting an ordinary loop/transition seek is not an opportunity
          // to play a subsequent source frame. The seek itself has its own limit.
          finishSeeking(state);
          // A seek can decode one frame without restarting playback. Do not
          // mistake that single frame for successful sustained recovery.
          state.lastSource=node.currentTime;state.decoded=decodedFrames(node);state.sampledFrames=state.observer?.count??0;
          // Loop/drift seeks are not proof that a new image arrived. In a short
          // loop, resetting this timer at every wrap hid a frozen decoder forever.
          if(reset||stalled){state.advancedAt=now();state.healthySince=undefined;}
          // With measured frames, ordinary wraps must also preserve proven
          // healthy playback; sub-500 ms loops otherwise never renew the budget.
        }
        if(playing&&!next.finished){
          if(node.paused&&!state.play&&stamp-state.lastPlayAt>=500){
            state.plays++;state.lastPlayAt=stamp;
            // A browser can keep play() pending until data arrives. Observe both
            // outcomes without locking sync; a late result must respect Pause.
            const pending=Promise.resolve(node.play());state.play=pending;
            void pending.then(()=>{if(engine.disposed||!track.playing||track.clips[track.active]?.node!==node)node.pause();},error=>{if(state.play===pending&&!engine.disposed&&track.playing&&track.clips[track.active]?.node===node&&error?.name!=='AbortError')engine.onError(error);}).finally(()=>{if(state.play===pending)state.play=undefined;});
          }
        }else{node.pause();state.waiting=false;}
      }
      const neighbour=(next.index+1)%track.clips.length;
      const future=track.clips[neighbour];
      if(future&&!future.node&&!preloadAttempts.has(future)&&neighbour!==next.index&&(track.loop||next.index+1<track.clips.length)){
        preloadAttempts.add(future);
        // One speculative attempt, not one rejection handler/retry per frame.
        // A failure is retried/reported when this clip is actually requested.
        void Promise.resolve().then(()=>engine.ensure(track,neighbour)).then(()=>preloadAttempts.delete(future),()=>{});
      }
      for(let i=0;i<track.clips.length;i++)if(i!==next.index&&i!==neighbour&&track.clips[i].node){const old=track.clips[i].node;old.pause?.();old.removeAttribute('src');old.load?.();old.remove();track.clips[i].node=null;}
    }catch(error){if(!controller.signal.aborted)throw new PlaybackFailure(error,current);}
    finally{engine.abort.signal.removeEventListener('abort',abort);if(state.abort===controller){finishSeeking(state);state.abort=undefined;}}
  };
}

export function installBAPreviewPlayback(g:LegacyGraphic,template:BroadcastTemplate){
  if(template.id!=='BTV_BA_1P'||template.version!=='1.0.3'||template.libraryVersion!=='1.7.0')return;
  // _update exposes its replacement media engine before awaiting old audio
  // disposal. Install before that exposure, not after a possibly slow close().
  const build=g._build?.bind(g);
  if(build)g._build=(...args:any[])=>{installBAPreviewMediaPlayback(args[1]);return build(...args);};
  const update=g._update.bind(g);
  g._update=async(...args:any[])=>{const result=await update(...args);installBAPreviewMediaPlayback(g.media);return result;};
  g.__previewPlaybackStats=()=>g.media?.previewPlaybackStatus?.()??[];
}
