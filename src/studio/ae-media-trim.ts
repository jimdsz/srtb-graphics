import type {BroadcastTemplate,ProjectData} from './domain';
import type {LegacyGraphic,Track} from './video/engine';
import {aeClipWindow,aeSourceTime,aeTrimTemplate} from './ae-media-window';
import {aeMontagePlans,prepareAEMontage} from './ae-montage';
import {installAEMediaAudio} from './ae-media-audio';
export {aeClipWindow,aeSourceTime,aeTrimTemplate} from './ae-media-window';

/** Explicit source windows; no edit of the frozen AE animation or its clock. */
const installed=new WeakSet<object>();
export function installAEMediaTrim(g:LegacyGraphic,t:Pick<BroadcastTemplate,'id'|'version'|'libraryVersion'>){
  if(!aeTrimTemplate(t.id)||t.version!=='1.0.0'||t.libraryVersion!=='1.7.0'||installed.has(g))return;
  const renvoi=t.id==='BTV_Renvoi',method=renvoi?'prepareMedia':'prepareTracks';
  const prepare=g[method].bind(g),render=g.renderMedia.bind(g);
  const audio=installAEMediaAudio(g,t.id);
  const trimmed=new Set<string>(),montages=new Map<string,Awaited<ReturnType<typeof prepareAEMontage>>>();
  let lifetime=new AbortController();installed.add(g);
  const clear=()=>{lifetime.abort();for(const montage of montages.values())montage.dispose();montages.clear();};
  if(typeof g.teardown==='function'){const teardown=g.teardown.bind(g);g.teardown=()=>{clear();return teardown();};}
  g[method]=async()=>{
    const data=g.data as ProjectData;
    clear();lifetime=new AbortController();const signal=lifetime.signal;
    trimmed.clear();const plans=aeMontagePlans(data),originals=new Map<string,ProjectData[string]>();
    // Native preparation still owns each layer, canvas and activation clock.
    // It initially opens the first excerpt even if the primary was deselected.
    for(const [key,clips]of plans){const field=`_media_${key}_url`;originals.set(field,data[field]);data[field]=clips[0].url;}
    try{await prepare();signal.throwIfAborted();}finally{for(const [field,value]of originals)if(value===undefined)delete data[field];else data[field]=value;}
    try{
    for(const [key,track]of Object.entries(g.tracks) as [string,Track][]){
      const spec=g.mediaItems?.get(key)?.spec;
      if(spec){track.activeStart=spec.activeStart;track.activeEnd=spec.activeEnd;}
      const plan=plans.get(key);
      if(plan){
        const first=track.clips[0];if(!first?.node)throw Error('La première image du montage est inaccessible.');
        const montage=await prepareAEMontage(plan,first,signal,(clip,index)=>{
          (track as Track&{montageIndex:number}).montageIndex=index;
          if(renvoi){
            if(g.media!==clip.node){g.media?.pause?.();g.media=clip.node;g.mediaPainted=false;}
          }else{
            const item=g.mediaItems.get(key);if(item.node!==clip.node){item.node.pause?.();Object.assign(item,{node:clip.node,video:clip.type==='video',url:clip.url,duration:clip.end,presented:false,painted:false});}
          }
        });
        signal.throwIfAborted();montages.set(key,montage);track.clips=montage.clips;track.length=montage.length;track.loop=false;track.rate=1;continue;
      }
      const clip=track.clips[0];if(key==='audio'||clip?.type!=='video')continue;
      const start=Number(data[`_media_${key}_start_seconds`]??0),end=Number(data[`_media_${key}_end_seconds`]??0);
      if(start===0&&end===0)continue; // Old projects keep their native playback.
      Object.assign(clip,aeClipWindow(clip.end,start,end));track.length=clip.length;track.loop=false;trimmed.add(key);
    }
    }catch(error){clear();throw error;}
  };
  const mapped=(key:string,seconds:number,precise:boolean)=>{
    if(!trimmed.has(key))return {seconds,precise};
    const at=aeSourceTime(g.tracks[key],seconds);
    return {seconds:at.seconds,precise:precise||at.ended};
  };
  const soundAfter=(result:unknown,precise:boolean)=>{
    if(result&&typeof (result as Promise<unknown>).then==='function')return Promise.resolve(result).then(value=>{audio.sync(Number(g.elapsed)||0,!precise);return value;});
    audio.sync(Number(g.elapsed)||0,!precise);return result;
  };
  if(renvoi)g.renderMedia=(seconds:number,precise=false)=>{
    const montage=montages.get('renvoi');if(montage)return montage.select(seconds).then(at=>at?soundAfter(render(at.seconds,precise||at.ended),precise||at.ended):undefined);
    const at=mapped('renvoi',seconds,precise);return soundAfter(render(at.seconds,at.precise),at.precise);
  };
  else g.renderMedia=(key:string,seconds:number,precise=false)=>{
    const montage=montages.get(key);if(montage)return montage.select(seconds).then(at=>at?soundAfter(render(key,at.seconds,precise||at.ended),precise||at.ended):undefined);
    const at=mapped(key,seconds,precise);return soundAfter(render(key,at.seconds,at.precise),at.precise);
  };
}
