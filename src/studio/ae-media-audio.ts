import type {LegacyGraphic,Track} from './video/engine';
import {aeMediaFade,aeMediaWindows} from './ae-media-timing';
import {locateClip} from './media-position';
import {TIMINGS} from './video/timeline';

/** Opt-in sound from the selected AE excerpt. The original signature/voice
 * remains independent. Export stays muted and mixes the same windows offline. */
export function installAEMediaAudio(g:LegacyGraphic,id:string){
  const pending=new WeakSet<HTMLMediaElement>();
  const tracks=()=>Object.entries(g.tracks||{}) as [string,Track][];
  const pauseAll=()=>{for(const [key,track]of tracks())if(key!=='audio')for(const clip of track.clips)if(clip.type==='video'&&clip.node){const node=clip.node as HTMLMediaElement;node.muted=true;node.pause();}};
  const sync=(seconds:number,allowPlay=false)=>{
    const timing=TIMINGS[id],outAt=Number.isFinite(g.outAt)?g.outAt:g.data?._out_mode==='duration'?Number(g.data._out_duration_seconds):Infinity;
    if(!timing)return;
    for(const [key,track]of tracks()){
      if(key==='audio')continue;
      const window=aeMediaWindows(id,key,track,outAt,outAt+timing.out,!!g.__aeSocialTimes).find(window=>seconds>=window.at&&seconds<window.until);
      const local=window?window.elapsed+seconds-window.at:0,length=track.length??track.clips.reduce((total,clip)=>total+clip.length,0);
      const enabled=g.playing&&!g.disposed&&!g.muted&&g.data?.[`_media_${key}_audio_enabled`]===true&&!!window&&(track.loop||local<length);
      const position=enabled?locateClip(track.clips,local,track.loop,track.rate):undefined;
      const rendered=id==='BTV_Renvoi'?g.media:g.mediaItems?.get(key)?.node;
      for(const [index,clip]of track.clips.entries()){
        if(clip.type!=='video'||!clip.node)continue;
        const node=clip.node as HTMLMediaElement,active=!!enabled&&position?.index===index&&rendered===node;
        node.muted=!active;node.volume=Math.max(0,Math.min(1,Number(g.data?.[`_media_${key}_volume`]??1)))*aeMediaFade(seconds,outAt,timing.out);
        if(active&&allowPlay&&node.paused&&!node.seeking&&!pending.has(node)){
          pending.add(node);
          void node.play().then(()=>{
            // A pending play promise cannot restart sound after pause/disposal.
            const selected=id==='BTV_Renvoi'?g.media:g.mediaItems?.get(key)?.node;
            if(!g.playing||g.disposed||selected!==node||node.muted){node.muted=true;node.pause();}
          },error=>{const selected=id==='BTV_Renvoi'?g.media:g.mediaItems?.get(key)?.node;if(g.playing&&!g.disposed&&selected===node&&!node.muted){node.muted=true;g.dispatchEvent?.(new CustomEvent('broadcast-media-error',{detail:{message:'Le son de cet extrait ne peut pas démarrer. '+(error instanceof Error?error.message:String(error))}}));}}).finally(()=>pending.delete(node));
        }
      }
    }
  };
  if(typeof g.syncAudio==='function'){const native=g.syncAudio.bind(g);g.syncAudio=(seconds:number,...args:unknown[])=>{const result=native(seconds,...args);sync(seconds);return result;};}
  if(typeof g.pause==='function'){const native=g.pause.bind(g);g.pause=(...args:unknown[])=>{const result=native(...args);pauseAll();return result;};}
  if(typeof g.pauseAction==='function'){const native=g.pauseAction.bind(g);g.pauseAction=(...args:unknown[])=>{const result=native(...args);return Promise.resolve(result).then(value=>{pauseAll();return value;});};}
  if(typeof g.setMuted==='function'){const native=g.setMuted.bind(g);g.setMuted=(value:boolean)=>{const result=native(value);sync(Number(g.elapsed)||0);return result;};}
  if(typeof g._finishOut==='function'){const native=g._finishOut.bind(g);g._finishOut=(...args:unknown[])=>{const result=native(...args);pauseAll();return result;};}
  return {sync,pause:pauseAll};
}
