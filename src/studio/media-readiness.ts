import type {BroadcastTemplate} from './domain';

/** The frozen BA waits only for seeked. On remote files, seeked may arrive
 * before HAVE_CURRENT_DATA, followed by loadeddata/canplay with no second
 * seeked event. Relay only a genuinely ready, non-seeking video to that waiter.
 * This does not change time, bypass codec errors or modify the published engine.
 */
export function relayVideoReadiness(node:HTMLVideoElement,signal:AbortSignal){
  const ready=()=>{if(!signal.aborted&&!node.seeking&&node.readyState>=2&&!node.error)node.dispatchEvent(new Event('seeked'));};
  const events=['loadeddata','canplay','progress'];
  const dispose=()=>{for(const event of events)node.removeEventListener(event,ready);signal.removeEventListener('abort',dispose);};
  if(signal.aborted)return dispose;
  for(const event of events)node.addEventListener(event,ready);
  signal.addEventListener('abort',dispose,{once:true});return dispose;
}
const installed=new WeakSet<object>();
export function shouldReportMediaDecodeError(engine:{disposed:boolean;previewMediaErrorCurrent?:(track:any,node:HTMLVideoElement)=>boolean},track:{clips:any[]},clip:{node:unknown},node:HTMLVideoElement){
  // No preview policy is installed on export engines: their error contract stays
  // unchanged. Playback checks a cached failure again when that clip is selected.
  return !engine.disposed&&clip.node===node&&(!engine.previewMediaErrorCurrent||engine.previewMediaErrorCurrent(track,node));
}
export function waitForVideoData(node:HTMLVideoElement,signal:AbortSignal,label:string,timeoutMs=45000,minimumState=2):Promise<void>{
  return new Promise((resolve,reject)=>{
    const events=['loadedmetadata','loadeddata','canplay','seeked','progress'];
    const finish=(error?:unknown)=>{clearTimeout(timer);for(const event of events)node.removeEventListener(event,check);node.removeEventListener('error',failed);signal.removeEventListener('abort',abort);error?reject(error):resolve();};
    const check=()=>{if(node.error)failed();else if(node.readyState>=minimumState&&!node.seeking)finish();};
    const failed=()=>finish(Error(label+' : source inaccessible ou codec non décodable.'));
    const abort=()=>finish(signal.reason||new DOMException('Chargement annulé','AbortError'));
    const timer=setTimeout(()=>finish(Error(label+' : le réseau ne fournit pas la vidéo assez vite. Réessayez ou reconnectez le fichier local.')),timeoutMs);
    for(const event of events)node.addEventListener(event,check);node.addEventListener('error',failed);signal.addEventListener('abort',abort,{once:true});
    if(signal.aborted)abort();else check();
  });
}
export async function installBAMediaReadiness(template:Pick<BroadcastTemplate,'id'|'version'|'libraryVersion'|'module'>){
  if(template.id!=='BTV_BA_1P'||template.version!=='1.0.3'||template.libraryVersion!=='1.7.0')return;
  const {MediaEngine,MEDIA_DEFAULTS,mediaSource}=await import(/* @vite-ignore */new URL('media.mjs',new URL(template.module,location.href)).href),prototype=MediaEngine.prototype;
  if(installed.has(prototype))return;
  const ensure=prototype.ensure;
  prototype.ensure=function(track:{kind:string;clips:any[]},index:number){
    const clip=track.clips[index];
    if(!clip||clip.type!=='video')return ensure.call(this,track,index);
    if(clip.node)return Promise.resolve(clip.node);if(clip.loading)return clip.loading;
    clip.loading=(async()=>{
      const node=document.createElement('video'),signal=this.abort.signal;
      node.crossOrigin='anonymous';node.muted=true;node.defaultMuted=true;node.playsInline=true;node.preload='auto';node.loop=false;node.src=clip.url;
      const release=()=>{node.pause();node.removeAttribute('src');node.load();node.remove();};
      try{
        await waitForVideoData(node,signal,track.kind+' · métadonnées',45000,1);
        if(this.disposed)throw new DOMException('Média fermé','AbortError');
        if(!Number.isFinite(node.duration)||node.duration<=0||clip.start>=node.duration||clip.end>node.duration+.02)throw Error(track.kind+' : points hors de la vidéo ou durée invalide.');
        relayVideoReadiness(node,signal);
        if(Math.abs(node.currentTime-clip.start)>.002)node.currentTime=clip.start;
        await waitForVideoData(node,signal,track.kind+' · positionnement');
        clip.node=node;node.addEventListener('error',()=>{if(shouldReportMediaDecodeError(this,track,clip,node))this.onError(track.kind+' : erreur de décodage.');});return node;
      }catch(error){release();throw error;}
    })().finally(()=>{clip.loading=null;});return clip.loading;
  };
  // Prepare independent tracks concurrently, and reuse their decoded nodes for
  // metadata validation. The frozen implementation downloaded every first clip
  // twice (metadata node, then playback node), sequentially for all three tracks.
  prototype.prepare=async function(config:Record<string,unknown>,{signal}:{signal?:AbortSignal}={}){
    this.config={...MEDIA_DEFAULTS,...config};const linked=()=>this.abort.abort();signal?.addEventListener('abort',linked,{once:true});if(signal?.aborted)this.abort.abort();
    const bounded=(value:unknown,label:string,min:number,max:number)=>{const n=Number(value);if(!Number.isFinite(n)||n<min||n>max)throw Error(`${label} : valeur attendue entre ${min} et ${max}.`);return n;};
    try{
      await Promise.all(['intro','body','pack'].map(async kind=>{
        const p='_media_'+kind,c=this.config,rate=bounded(c[p+'_rate'],'Vitesse',.0625,4),volume=bounded(c[p+'_volume'],'Volume',0,1);
        if(!['cover','contain'].includes(c[p+'_fit']))throw Error('Cadrage attendu : cover ou contain.');
        if(!['auto','srgb','rec709_gamma24'].includes(c[p+'_color_space']))throw Error('Colorimétrie non prise en charge.');
        let list=c[p+'_sequence'];if(typeof list==='string')list=JSON.parse(list||'[]');
        if(!Array.isArray(list)||list.length>20)throw Error(kind+' : maximum 20 extraits.');
        if(!list.length)list=[{url:c[p+'_url'],start:c[p+'_start_seconds'],end:c[p+'_end_seconds']}];
        const track={kind,rate,volume,loop:!!c[p+'_loop'],audio:!!c[p+'_audio_enabled'],fit:c[p+'_fit'],colorSpace:c[p+'_color_space'],clips:[] as any[],active:-1,lastTime:0,finished:false,playing:false,pending:null,length:0};this.tracks[kind]=track;
        for(const entry of list){
          this.abort.signal.throwIfAborted();if(!entry||typeof entry!=='object')throw Error('Extrait invalide.');
          const clip={...mediaSource(entry.url,this.baseUrl),start:Math.round(bounded(entry.start??0,'Point IN',0,86400)*25)/25,end:Math.round(bounded(entry.end??0,'Point OUT',0,86400)*25)/25,node:null};
          if(clip.type==='image'&&(clip.start!==0||clip.end===0))throw Error(kind+' : une image exige entrée 0 et une durée positive.');
          const index=track.clips.length;track.clips.push(clip);
          const node=await this.ensure(track,index);
          if(clip.type==='video'){
            if(!Number.isFinite(node.duration)||node.duration<=0)throw Error('Vidéo à durée finie requise.');
            clip.duration=node.duration;if(!clip.end)clip.end=node.duration;
            if(clip.start>=node.duration||clip.end>node.duration+.02)throw Error(kind+' : points hors de la vidéo.');
            clip.end=Math.min(clip.end,node.duration);
          }
          if(clip.end-clip.start<.039)throw Error('Extrait inférieur à une image.');clip.length=clip.end-clip.start;
          // Bound resident decoders to current + next, as in the native engine.
          if(index>1){node.pause?.();node.removeAttribute('src');node.load?.();node.remove();clip.node=null;}
        }
        track.length=track.clips.reduce((sum,clip)=>sum+clip.length,0)/rate;track.active=0;
      }));
      return this;
    }catch(error){this.dispose();throw error;}finally{signal?.removeEventListener('abort',linked);}
  };
  installed.add(prototype);
}
