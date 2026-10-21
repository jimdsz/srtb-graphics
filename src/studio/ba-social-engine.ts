import type {ProjectData} from './domain';
import type {LegacyGraphic} from './video/engine';
import {makeTimeline,socialExcerptEnd} from './video/timeline';

const ok={statusCode:200,statusMessage:'OK'};
// The frozen loader requires three slots. Inactive slots get a tiny in-memory
// transparent image, never the user's TV rushes or a network placeholder.
const emptyImage='data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/%3E';
export function baSocialNativeData(data:ProjectData):ProjectData{
  const next={...data,_audio_social_direct_enabled:true,_audio_bed_enabled:false,_out_duration_seconds:Math.max(7.6,Number(data._out_duration_seconds)||7.6)};
  for(const kind of ['intro','pack'])Object.assign(next,{[`_media_${kind}_url`]:emptyImage,[`_media_${kind}_sequence`]:'[]',[`_media_${kind}_start_seconds`]:0,[`_media_${kind}_end_seconds`]:1,[`_media_${kind}_rate`]:1,[`_media_${kind}_audio_enabled`]:false});
  return next;
}

/** Instance-scoped direct clock. Installed only on the pinned social BA engine.
 * Existing media readiness, cancellation, queues, pause/resume and audio stay in
 * use; native library modules and all saved TV choices remain untouched. */
export function installBASocialDirect(g:LegacyGraphic){
  const update=g._update.bind(g),finish=g._finishOut.bind(g),play=g.playAction.bind(g);
  const configured=new WeakSet<object>();
  let data:ProjectData={},due=Infinity;
  g.__baSocialDirect=true;
  // There is no separate IN to skip. Both public play modes start at excerpt 0.
  g.playAction=(args:any={})=>play({...args,skipAnimation:false});
  g._update=async(raw:ProjectData,...args:any[])=>{
    const next={...data,...raw},result=await update(baSocialNativeData(next),...args);
    if(!args[1]?.validateOnly){
      data=next;
      g.__baSocialData={...data,_studio_format:'portrait'};
      const socialData={...data,_studio_format:'portrait'},lengths={body:g.media.tracks.body.length};
      due=data._out_mode==='manual'?socialExcerptEnd('BTV_BA_1P',socialData,lengths):makeTimeline('BTV_BA_1P',socialData,lengths,0,false).outAt;
      const media=g.media;
      if(!configured.has(media)){
        const sync=media.sync.bind(media);
        media.sync=(_main:number,options:any={})=>sync(10,{...options,bodySeconds:options.bodySeconds??g._times().body});
        configured.add(media);
      }
      // One optional announcement on the excerpt, never a repeated closing VO.
      g.audio.plan.voice=g.audio.plan.voice.filter((item:{id:string})=>!item.id.endsWith('outro'));
    }
    return result;
  };
  g._times=()=>{
    const elapsed=g._running?Math.max(0,(performance.now()-g._inAt)/1000):g._elapsed||0;
    return {main:elapsed,body:elapsed,elapsed};
  };
  g._finishOut=()=>{
    const elapsed=g._times().elapsed;g._elapsed=elapsed;
    finish();g.state.currentFrame=Math.floor(elapsed*25);
    // An in-flight media position must not restart playback after completion.
    const media=g.media;void g._mediaTick?.finally(()=>{if(!g._running)media.pause();});
  };
  g._beginOut=(reason:string)=>{
    g._outDone={promise:Promise.resolve(ok),resolve:()=>{}};
    g._outReason=reason;g._inDone?.resolve(ok);
    g.dispatchEvent(new CustomEvent('broadcast-out',{detail:{phase:'stopping',reason}}));
    g._finishOut();
  };
  g._tick=()=>{
    if(!g._running||g.state.disposed)return;
    try{
      const times=g._times();g._elapsed=times.elapsed;g.state.currentFrame=Math.floor(times.elapsed*25);
      if(g.state.phase==='in'){g.state.phase='onair';g._inDone?.resolve(ok);}
      if(times.elapsed>=due){g._beginOut(String(data._out_mode));return;}
      g.audio.sync(times.elapsed,{playing:true,muted:g.muted});
      if(!g._mediaTick){const media=g.media;g._mediaTick=media.sync(times.elapsed,g._mediaArgs(times,true)).catch((error:unknown)=>{if(media===g.media&&!g.state.disposed&&g._running)g._fail(error);}).finally(()=>{g._mediaTick=null;});}
      g._raf=requestAnimationFrame(g._tick);
    }catch(error){g._fail(error);}
  };
  g.goToTime=({seconds}:{seconds:number})=>{
    if(!Number.isFinite(seconds)||seconds<0)return Promise.reject(Error('Position de lecture invalide.'));
    const token=++g._seekGeneration;g._running=false;cancelAnimationFrame(g._raf);g.audio?.stop();g.media?.pause();g._inDone?.resolve(ok);g._outDone?.resolve(ok);
    return g._queue(async()=>{
      if(token!==g._seekGeneration)return ok;
      g._offset={intro:0,body:0,pack:0};
      await g.media.sync(seconds,{bodySeconds:seconds,playing:false,muted:true,exact:true});
      if(token!==g._seekGeneration)return ok;
      g._elapsed=seconds;g._inspectionBody=seconds;g.state.phase='inspection';g.state.currentFrame=Math.round(seconds*25);
      return {...ok,frame:g.state.currentFrame,seconds};
    });
  };
}
