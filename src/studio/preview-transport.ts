import type {BroadcastTemplate,ProjectData} from './domain';
import type {LegacyGraphic} from './video/engine';
import {TIMINGS,graphicTime} from './video/timeline';
import {inspectPreview,previewTimeline} from './preview-timeline';
import {tracksOf} from './media-tracks';

export type PreviewPhase='ready'|'in'|'onair'|'out'|'paused'|'stopped';
export interface PreviewPosition {seconds:number;phase:PreviewPhase;playing:boolean;outAt:number|undefined}
const ok={statusCode:200,statusMessage:'OK'};
function check(result:any){if(result?.statusCode>=400)throw Error(result.statusMessage||'Le moteur a refusé la lecture.');}

/** Instance adapter for the three frozen 1.7.0 engine families. Pausing never
 * invokes IN, STOP or seek: clocks, Lottie segment, media and OUT stay in place.
 * Only an explicit seek changes the source positions. */
export function installPreviewTransport(g:LegacyGraphic,template:BroadcastTemplate,data:()=>ProjectData,onError:(error:Error)=>void=()=>{},permission:()=>()=>boolean=()=>()=>true){
  const timing=TIMINGS[template.id];
  if(template.libraryVersion!=='1.7.0'||!timing)throw Error('Pause et reprise indisponibles pour cette version du moteur.');
  const kind=timing.kind;
  if(kind==='signature'&&typeof g.pauseAction!=='function'||kind==='ba'&&typeof g._times!=='function'||kind==='legacy'&&(!g.state?.animation||!g.autoOut))throw Error('Ce moteur ne permet pas une reprise fidèle de l’aperçu.');
  let phase:PreviewPhase='ready',playing=false,seconds=0,origin=0,outAt:number|undefined,resumePhase:PreviewPhase='in',disposed=false,generation=0;
  // Clear/IN only rewind the engine; they cannot repair a failed presenter.
  // Keep this latch for the lifetime of this instance, independent of phase.
  let mediaFailure:Error|undefined;
  function usable(){if(mediaFailure)throw mediaFailure;if(disposed)throw Error('Cet aperçu a été fermé.');}
  let baTimes:{main:number;body:number;elapsed:number}|undefined;
  let legacyPaused=false,legacyAnimationPlaying=false,legacySeek=false,legacyAutoActive=false;
  let legacyTracks:string[]=[],legacySound:string[]=[],legacyBed=false;
  const nativeTimes=kind==='ba'?g._times.bind(g):undefined;
  if(nativeTimes)g._times=()=>!g._running&&baTimes?{...baTimes}:nativeTimes();
  // Ferryman treats Lottie's _pause event as segment completion. A user pause
  // must not drain a queued OUT or hide its last image.
  if(kind==='legacy'){
    const drain=g._drainPlayStack.bind(g),trigger=g._triggerPlayStack.bind(g),stop=g._performStopAction.bind(g);
    g._drainPlayStack=(...args:any[])=>{if(!legacyPaused)return drain(...args);};
    g._triggerPlayStack=(...args:any[])=>{if(!legacyPaused)return trigger(...args);};
    g._performStopAction=(...args:any[])=>{
      // Suivi de seeks its jingle before starting OUT. Pause/Clear may arrive
      // while that seek is pending; it must not restart animation afterwards.
      if(disposed||phase==='stopped')return Promise.resolve(ok);
      const completion=stop(...args);
      if(legacyPaused){legacyAnimationPlaying=!g.state.animation.isPaused;g.state.animation.pause();g.state.lottieState='idle';}
      return completion;
    };
  }
  const rawSeconds=()=>kind==='ba'?g._times().elapsed:kind==='signature'?g._time():playing?Math.max(0,(performance.now()-origin)/1000):seconds;
  function snapshot():PreviewPosition{
    if(mediaFailure)return {seconds,phase:'stopped',playing:false,outAt};
    // Engine failures stop its clock but do not emit broadcast-out. Reflect
    // that stop in the UI instead of leaving a misleading advancing counter.
    if(kind==='ba'&&playing&&g.state.phase==='error'){seconds=rawSeconds();playing=false;phase='stopped';}
    if(playing){
      seconds=rawSeconds();
      if(kind!=='legacy'){const nativePhase=kind==='ba'?g.state.phase:g.phase;if(['in','onair','out'].includes(nativePhase))phase=nativePhase;}
      else if(phase!=='out')phase=seconds<timing.entry?'in':'onair';
    }
    return {seconds,phase,playing,outAt};
  }
  const report=(reason:unknown)=>{const error=reason instanceof Error?reason:Error(String(reason));if(!disposed)onError(error);};
  // An asynchronous presenter can fail after the native frame was rendered.
  // Stop media/audio and the UI clock together, not just the image publisher.
  const mediaError=(event:Event)=>{
    // BA's _fail emits this event before setting phase='error'. Intercepting
    // it with pause would mask that terminal state as a resumable pause.
    if(disposed||mediaFailure)return;
    const reason=(event as CustomEvent<{message?:string}>).detail?.message||'La présentation vidéo a échoué. Relancez l’aperçu ; vos réglages sont conservés.';
    if(kind==='ba'){seconds=rawSeconds();playing=false;}
    else void pause(true).catch(report);
    mediaFailure=Error(reason);
    report(reason);
  };
  g.addEventListener('broadcast-media-error',mediaError);
  function launch(promise:Promise<any>){const token=generation;void promise.then(check).catch(error=>{if(!disposed&&token===generation){playing=false;report(error);}});}
  const accepted=async()=>{
    try{await g.__supplementalVoice?.activation;await (kind==='legacy'?g.state.actionChain:g._chain);}
    finally{
      // IN may have been queued when the presenter failed. Stop again after
      // acknowledgement, even if our UI clock never became "playing".
      if(mediaFailure&&kind!=='ba')await pause(true).catch(report);
    }
    usable();
  };
  const out=(event:Event)=>{
    if(mediaFailure)return;
    const detail=(event as CustomEvent).detail;
    if(detail?.phase==='stopping'){seconds=rawSeconds();outAt=seconds;resumePhase='out';if(phase!=='paused')phase='out';}
    else if(detail?.phase==='completed'){seconds=rawSeconds();playing=false;phase='stopped';}
  };
  g.addEventListener('broadcast-out',out);
  function pauseLegacy(){
    legacyPaused=true;legacyAnimationPlaying=!g.state.animation.isPaused;
    legacyAutoActive=!!g.autoOut.active;g.autoOut.cancel('paused');
    legacyTracks=Object.entries(tracksOf(g)).filter(([,track])=>(track as any).running).map(([key])=>key);
    legacySound=Object.entries(g.sound||{}).filter(([,track])=>(track as any).running).map(([key])=>key);
    legacyBed=!!g.audioBed&&!g.audioBed.paused;
    if(g.media)g.media.playbackRequested=false;g.runningMedia=false;
    g.state.animation.pause();
    for(const track of Object.values(tracksOf(g)))(track as any).pause();
    for(const track of Object.values(g.sound||{}))(track as any).pause();
    g.audioBed?.pause();
    g.state.lottieState='idle';
  }
  async function pause(force=false){
    g.__supplementalVoice?.pause();
    if(disposed||!playing&&!force)return;
    seconds=rawSeconds();resumePhase=snapshot().phase;playing=false;phase='paused';
    if(kind==='signature'){check(await g.pauseAction());seconds=g.elapsed;}
    else if(kind==='ba'){
      baTimes={...g._times()};seconds=baTimes!.elapsed;g._elapsed=seconds;g._inspectionBody=baTimes!.body;
      g._running=false;cancelAnimationFrame(g._raf);g.state.phase='paused';g.state.playStatus='pause';g.media.pause();g.audio.stop();
      g._inDone?.resolve({...ok,interrupted:true});
      // A media sync already awaiting a decoded frame must finish before the
      // pause is acknowledged, otherwise it could start a node afterwards.
      await g._mediaTick;g.media.pause();
    }else pauseLegacy();
    g.__typography?.refresh();g.__socialPreview?.refresh();
  }
  async function resume(){
    usable();
    const allowed=permission();if(!allowed())throw Error('Vérifiez la connexion avant de reprendre l’aperçu.');
    if(disposed)throw Error('Cet aperçu a été fermé.');
    if(playing)return;
    if(phase!=='paused')throw Error('Choisissez une image ou lancez IN avant de reprendre la lecture.');
    g.__nativeVoiceFit?.();
    // Keep the frozen playhead until the real device clock advances. A session
    // suspension, clear or disposal during that wait must not resume anything.
    if(kind==='ba'&&!g.muted){
      const token=generation,times=baTimes;await g.audio.unlock();
      if(disposed||token!==generation||phase!=='paused'||baTimes!==times||!allowed())throw Error('La reprise a été interrompue pour vérifier la connexion.');
    }
    if(kind==='legacy'&&g.__supplementalVoice){
      const token=generation;await g.__supplementalVoice.resume(seconds);
      if(disposed||token!==generation||phase!=='paused'||!allowed()){g.__supplementalVoice.pause();throw Error('La reprise a été interrompue.');}
    }
    if(data()._out_mode==='manual'&&resumePhase!=='out')outAt=undefined;
    phase=resumePhase;playing=true;origin=performance.now()-seconds*1000;
    if(kind==='signature'){
      g.elapsed=seconds;g.pausedPhase=resumePhase;g.phase='paused';
      launch(g.playAction());await accepted();
    }else if(kind==='ba'){
      const times=baTimes!;const now=performance.now();g._inAt=now-times.elapsed*1000;
      if(resumePhase==='out'){const dt=times.main-timing.stop;g._outAt=now-dt*1000;g._outBody=times.body-dt;g._elapsedAtOut=times.elapsed-dt;}
      g.state.phase=resumePhase;g.state.playStatus='play';g._elapsed=times.elapsed;g._inspectionBody=null;g._running=true;baTimes=undefined;
      g.scene.container.style.visibility='visible';g.audio.sync(times.main,{playing:true,muted:g.muted,discontinuity:true});g._tick();
    }else{
      g.autoOut.startedAt=origin;g.runStartedAt=origin;
      g.autoOut.active=resumePhase!=='out'&&(legacyAutoActive||legacySeek);g.autoOut.phase=resumePhase==='out'?'stopping':data()._out_mode==='manual'?'manual':'armed';
      if(g.media)g.media.playbackRequested=true;g.runningMedia=true;
      g.state.startPlayed=resumePhase!=='out';g.state.nextCount=1;g.state.playStatus=resumePhase==='out'?'stop':'play';
      legacyPaused=false;
      if(legacySeek){
        const frame=Number(g.state.currentFrame),end=(resumePhase==='out'?timing.stop+timing.out:timing.entry)*25;
        g.state.currentSegment=resumePhase==='out'?'stop':'start';g.state.playStack=[];
        if(resumePhase==='out'){
          const token=generation,completion=g._createDeferredPromise();g.state.stopCompletion=completion;
          void completion.promise.then(()=>{
            if(disposed||token!==generation)return;
            for(const track of Object.values(tracksOf(g)))(track as any).pause();
            for(const track of Object.values(g.sound||{}))(track as any).pause();
            g.audioBed?.pause();if(g.media)g.media.playbackRequested=false;g.runningMedia=false;
            g._setHybridVisible?.(false);g._setMediaVisibility?.(false);g.autoOut.complete();
            g.dispatchEvent(new CustomEvent('broadcast-out',{detail:{phase:'completed',reason:'inspection'}}));
          });
        }
        if(resumePhase==='out'||seconds<timing.entry-.04){g.state.animation.playSegments([frame,end],true);g.state.lottieState='play';}
        else g.state.lottieState='idle';
        if(template.id==='BTV_BA_TDS'){if(g.config._background_visible)g.tracks.background.start();}
        else g._syncMediaAtFrame(g.state.currentFrame);
        for(const track of Object.values(g.sound||{}))(track as any).start(seconds);
      }else{
        if(legacyAnimationPlaying){g.state.animation.play();g.state.lottieState='play';}
        for(const key of legacyTracks)(tracksOf(g)[key] as any)?.start();
        for(const key of legacySound)g.sound[key]?.start(seconds);
        if(legacyBed)void g.audioBed.play().catch(report);
      }
      g.autoOut.schedule();legacySeek=false;
    }
    if(!allowed()){await pause();throw Error('La reprise a été interrompue pour vérifier la connexion.');}
  }
  async function clear(){
    g.__supplementalVoice?.pause();
    generation++;seconds=0;playing=false;phase='stopped';outAt=undefined;
    if(kind==='legacy'){
      pauseLegacy();g.autoOut.cancel('cleared');g.pendingMediaAbort?.abort();
      g.state.playStack=[];g.state.startPlayed=false;g.state.nextCount=1;g.state.currentSegment='stop';g.state.playStatus='stop';
      g.state.animation.hide?.();g._setHybridVisible?.(false);g._setMediaVisibility?.(false);g._completeStopAction();
      // The engine's queue also catches its previous rejection before accepting
      // a new action. An already reported failed edit must not poison Clear and
      // prevent a corrected draft from ever reaching that queue.
      await Promise.resolve(g.state.actionChain).catch(()=>{});legacySeek=false;
    }else{check(await g.stopAction({skipAnimation:true}));baTimes=undefined;}
    seconds=0;playing=false;phase='stopped';outAt=undefined;g.__typography?.refresh();g.__socialPreview?.refresh();
  }
  async function start(){
    usable();
    const allowed=permission();if(!allowed())throw Error('Vérifiez la connexion avant de lancer l’aperçu.');
    await clear();usable();if(!allowed())throw Error('La lecture a été interrompue pour vérifier la connexion.');
    legacyPaused=false;baTimes=undefined;seconds=0;outAt=undefined;phase=resumePhase='in';playing=false;
    launch(g.playAction());await accepted();
    if(disposed)return;playing=true;origin=kind==='legacy'?(g.autoOut.startedAt??performance.now()):performance.now();
    if(!allowed()){await pause();throw Error('La lecture a été interrompue pour vérifier la connexion.');}
  }
  async function stop(){
    usable();
    const allowed=permission();if(!allowed())throw Error('Vérifiez la connexion avant de reprendre l’aperçu.');
    if(!playing&&phase!=='paused')return;
    if(phase==='out'||phase==='paused'&&resumePhase==='out'){if(!playing)await resume();return;}
    if(!playing)await resume();
    if(!allowed()){await pause();throw Error('La sortie a été interrompue pour vérifier la connexion.');}
    if(kind==='legacy'){
      // Manual OUT starts at the operator's current frame, including during IN.
      legacyPaused=true;g.state.animation.pause();g.state.playStack=[];g.state.lottieState='idle';g.state.currentSegment='interrupt';legacyPaused=false;
    }
    launch(g.stopAction());
    // STOP promises settle at the end of OUT. Keep Pause accessible meanwhile.
    // BA/signature queues acknowledge the start separately from that promise.
    if(kind!=='legacy')await accepted();
    if(!allowed()){await pause();throw Error('La sortie a été interrompue pour vérifier la connexion.');}
  }
  async function seek(value:number,actualOutAt?:number){
    usable();
    if(!Number.isFinite(value))throw Error('Indiquez un temps valide.');
    await clear();usable();
    const timeline=previewTimeline(g,template,data(),actualOutAt);
    // Restore the exact saved OUT clock. Rounding an immediate manual OUT can
    // otherwise place its first milliseconds back before the OUT boundary.
    seconds=Math.max(0,Math.min(timeline.duration-.04,actualOutAt===undefined?Math.round(value*25)/25:value));
    // Lottie markers retain their own firstFrame/range after OUT. Absolute seek
    // must restore the full timeline or a request for IN is clamped to OUT.
    if(kind==='legacy')g.state.animation.resetSegments(true);
    check(await inspectPreview(g,template,data(),seconds,actualOutAt));usable();
    outAt=timeline.outAt;resumePhase=seconds>=outAt?'out':seconds<timeline.timing.entry?'in':'onair';phase='paused';playing=false;
    if(kind==='ba'){
      const main=graphicTime(timeline,seconds),body=g.__baSocialDirect?seconds:seconds>=outAt?Math.max(0,outAt-4.36)+seconds-outAt:Math.max(0,seconds-4.36);
      baTimes={main,body,elapsed:seconds};g._elapsed=seconds;g._inspectionBody=body;
    }else if(kind==='signature'){g.elapsed=seconds;g.outAt=outAt;}
    else{
      legacySeek=true;legacyPaused=true;legacyAutoActive=resumePhase!=='out';
      // Suivi's bed keeps advancing during the graphic hold. Only OUT jumps to
      // its native jingle marker; the held IN frame is not an audio position.
      if(g.audioBed)await g._seekAudio(g.audioBed,g._audioPosition(seconds>=timeline.outAt?timing.stop+seconds-timeline.outAt:seconds));
      for(const track of Object.values(g.sound||{}))(track as any).seek(seconds);
    }
    g.__typography?.refresh();g.__socialPreview?.refresh();
  }
  const transport={snapshot,start,pause,resume,out:stop,clear,seek,dispose:()=>{disposed=true;generation++;playing=false;g.__supplementalVoice?.pause();g.removeEventListener('broadcast-out',out);g.removeEventListener('broadcast-media-error',mediaError);delete g.__previewTransport;}};
  g.__previewTransport=transport;return transport;
}
export type PreviewTransport=ReturnType<typeof installPreviewTransport>;
