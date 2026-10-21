import type {ProjectData} from './domain';
import type {CropClip} from './sequence-crop';
import type {Clip} from './video/engine';
import {aeClipWindow} from './ae-media-window';
import {frameTime,mediaKind} from './media-trim';
import {locateClip} from './media-position';
import {montageClipIssue,montageSource,parseMontage} from './montage-model';

export function aeMontagePlans(data:ProjectData):Map<string,CropClip[]>{
  const plans=new Map<string,CropClip[]>();
  for(const [key,value]of Object.entries(data)){
    const match=key.match(/^_media_(.+)_sequence$/);if(!match)continue;
    const clips=parseMontage(value);if(!clips)throw Error('Montage illisible : vérifiez la liste des extraits.');
    for(const clip of clips){const issue=montageClipIssue(clip);if(issue)throw Error(issue);}
    if(clips.length)plans.set(match[1],clips);
  }
  return plans;
}

export function releaseAEMontageNode(clip:Clip){
  const node=clip.node;clip.node=null;
  if(!node)return;
  if('pause'in node){node.muted=true;node.pause();}node.removeAttribute('src');if('load'in node)node.load();
}

/** Same-origin policy of the pinned native AE engines, including local blobs.
 * Resolution uses the page base so portable HTML keeps its relative media. */
export function aeMontageURL(source:string,base:string):string{
  const url=new URL(source,base),origin=new URL(base).origin;
  if(url.origin===origin&&['http:','https:','blob:'].includes(url.protocol))return url.href;
  throw Error('Média externe refusé : choisissez un fichier local ou partagé dans Graphics.');
}

export async function openAEMontageClip(spec:CropClip,signal:AbortSignal,full=true):Promise<Clip>{
  signal.throwIfAborted();
  const url=aeMontageURL(montageSource(spec.url),location.href),video=mediaKind(spec.url)==='video'||/\.(mov|m4v)(?:[?#]|$)/i.test(url);
  const node=document.createElement(video?'video':'img'),clip:Clip={type:video?'video':'image',source:url,url,node,start:0,end:0,length:0};
  node.crossOrigin='anonymous';
  if(node instanceof HTMLVideoElement){node.preload=full?'auto':'metadata';node.muted=true;node.defaultMuted=true;node.playsInline=true;}
  try{
    await new Promise<void>((resolve,reject)=>{
      const event=video?(full?'loadeddata':'loadedmetadata'):'load';
      const finish=(error?:unknown)=>{clearTimeout(timer);node.removeEventListener(event,ready);node.removeEventListener('error',failed);signal.removeEventListener('abort',abort);error?reject(error):resolve();};
      const ready=()=>finish(),failed=()=>finish(Error('Un extrait du montage est inaccessible ou illisible. Vérifiez son fichier.')),
        abort=()=>finish(signal.reason||new DOMException('Montage fermé.','AbortError'));
      const timer=setTimeout(()=>finish(Error('Le chargement d’un extrait du montage a dépassé 30 secondes.')),30000);
      node.addEventListener(event,ready,{once:true});node.addEventListener('error',failed,{once:true});signal.addEventListener('abort',abort,{once:true});
      if(signal.aborted)abort();else node.src=url;
    });
    signal.throwIfAborted();
    clip.end=video?(node as HTMLVideoElement).duration:spec.end;clip.length=clip.end;return clip;
  }catch(error){releaseAEMontageNode(clip);throw error;}
}

type OpenClip=(spec:CropClip,signal:AbortSignal,full?:boolean)=>Promise<Clip>;
function windowed(clip:Clip,spec:CropClip):Clip{
  const issue=montageClipIssue(spec);if(issue)throw Error(issue);
  return Object.assign(clip,aeClipWindow(clip.type==='image'?frameTime(spec.end):clip.end,frameTime(spec.start),frameTime(spec.end)));
}

/** Keep only the current and following video decoder. Still images are retained
 * for the social offline renderer, which accesses them directly by clip index. */
export async function prepareAEMontage(specs:CropClip[],first:Clip,signal:AbortSignal,activate:(clip:Clip,index:number)=>void,open:OpenClip=openAEMontageClip){
  const clips:Clip[]=[],pending=new Map<number,Promise<Clip>>();let selected=0,request=0,closed=false;
  const current=()=>!closed&&!signal.aborted;
  const dispose=()=>{if(closed)return;closed=true;request++;for(const clip of clips)releaseAEMontageNode(clip);};
  const prune=()=>{for(const [index,clip]of clips.entries())if(clip.type==='video'&&index!==selected&&index!==selected+1&&!pending.has(index))releaseAEMontageNode(clip);};
  signal.addEventListener('abort',dispose,{once:true});
  try{
    signal.throwIfAborted();clips.push(first);windowed(first,specs[0]);
    for(let index=1;index<specs.length;index++){
      const loaded=await open(specs[index],signal,index<2);clips.push(loaded);signal.throwIfAborted();
      windowed(loaded,specs[index]);if(index>1&&loaded.type==='video')releaseAEMontageNode(loaded);
    }
    const length=clips.reduce((sum,clip)=>sum+clip.length,0);
    async function ensure(index:number):Promise<Clip>{
      if(!current())throw signal.reason||new DOMException('Montage fermé.','AbortError');
      if(clips[index].node)return clips[index];
      const previous=pending.get(index);if(previous)return previous;
      const loading=open(specs[index],signal,true).then(loaded=>{
        if(!current()){releaseAEMontageNode(loaded);throw signal.reason||new DOMException('Montage fermé.','AbortError');}
        try{windowed(loaded,specs[index]);}catch(error){releaseAEMontageNode(loaded);throw error;}
        Object.assign(clips[index],loaded);return clips[index];
      }).finally(()=>{pending.delete(index);prune();});
      pending.set(index,loading);return loading;
    }
    return {clips,length,dispose:()=>{signal.removeEventListener('abort',dispose);dispose();},
      select:async(seconds:number)=>{
        const token=++request,at=locateClip(clips,seconds,false);if(!at)return;
        // Reserve the requested slot before loading so prune retains its node.
        selected=at.index;const clip=await ensure(at.index);
        if(!current()||token!==request)return;
        activate(clip,at.index);prune();
        // The next source is speculative. If it fails, selecting it reports the
        // real error; background preparation never fails the current picture.
        if(at.index+1<clips.length&&!clips[at.index+1].node)void ensure(at.index+1).catch(()=>{});
        return {index:at.index,seconds:at.time,ended:Math.max(0,seconds)>=length-.04};
      },
    };
  }catch(error){signal.removeEventListener('abort',dispose);dispose();throw error;}
}
