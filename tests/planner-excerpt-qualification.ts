import {getTemplate,templateDefaults} from '../src/studio/domain';
import {studioEngineModule} from '../src/studio/text-editing';
import {installAEMediaTrim} from '../src/studio/ae-media-trim';
import {installPreviewMediaSurfaces} from '../src/studio/preview-media-surfaces';
import {installSocialScene} from '../src/studio/social-scene';
import {installTypography} from '../src/studio/typography-engine';
import {attachSocialPreview} from '../src/studio/social-preview';
import {prepareGraphic} from '../src/studio/video/engine';
import type {LegacyGraphic,Track} from '../src/studio/video/engine';
import {engineData,locateClip} from '../src/studio/presentation';
import {socialTrackTimes} from '../src/studio/social-renderer';
import {sampleProof} from '../src/studio/video/frame-proof';
import portableRuntime from '../src/studio/supplemental-voice-runtime.generated.json';

const button=document.querySelector<HTMLButtonElement>('#run')!,status=document.querySelector('#status')!,result=document.querySelector('#result')!,scene=document.querySelector('#scene')!,gallery=document.querySelector('#gallery')!;
const source='/preview-media/v1/ba-programme.mp4';
function check(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
function pixels(source:CanvasImageSource){const c=document.createElement('canvas');c.width=64;c.height=36;c.getContext('2d')!.drawImage(source,0,0,64,36);return c.getContext('2d')!.getImageData(0,0,64,36).data;}
function difference(a:Uint8ClampedArray,b:Uint8ClampedArray){let sum=0;for(let i=0;i<a.length;i++)if(i%4!==3)sum+=Math.abs(a[i]-b[i]);return sum/(a.length*.75);}
async function seek(video:HTMLVideoElement,time:number){if(Math.abs(video.currentTime-time)<1e-6&&video.readyState>=2)return;const done=new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Reference seek timeout')),15000);video.addEventListener('seeked',()=>{clearTimeout(timer);resolve();},{once:true});});video.currentTime=time;await done;}
button.onclick=async()=>{
 button.disabled=true;const records:unknown[]=[];gallery.replaceChildren();
 const reference=document.createElement('video');reference.muted=true;reference.preload='auto';reference.src=source;
 try{
  check(location.hostname==='127.0.0.1','Local only');await new Promise<void>((resolve,reject)=>{reference.onloadeddata=()=>resolve();reference.onerror=()=>reject(Error('Reference load'));reference.load();});
  const portable=new URLSearchParams(location.search).has('portable');let installTrim=installAEMediaTrim;
  if(portable){const url=URL.createObjectURL(new Blob([portableRuntime.code],{type:'text/javascript'}));try{installTrim=(await import(/* @vite-ignore */url)).installAEMediaTrim;}finally{URL.revokeObjectURL(url);}}
  for(const id of ['BTV_Renvoi','BTV_Evenement','BTV_Semainier'])for(const format of ['tv','portrait','vertical']){
   status.textContent=id+' · '+format;const t=getTemplate(id),data={...templateDefaults(t),_studio_format:format};
   let n=0;for(const key of Object.keys(data)){if(/_audio.*enabled$/.test(key))data[key]=false;if(/^_media_.+_url$/.test(key)&&!key.includes('logo')){data[key]=source;data[key.replace(/_url$/,'_start_seconds')]=10+n;data[key.replace(/_url$/,'_end_seconds')]=12+n;n++;}}
   const mod=await import(/* @vite-ignore */studioEngineModule(t)),tag='excerpt-'+id.toLowerCase().replaceAll('_','-');if(!customElements.get(tag))customElements.define(tag,class extends mod.default{});
   const g=document.createElement(tag) as LegacyGraphic;scene.append(g);if(!portable)await installPreviewMediaSurfaces(g,t,format!=='tv');installTrim(g,t);if(format!=='tv')installSocialScene(g,t);installTypography(g,t,data);
   let prepared:Awaited<ReturnType<typeof prepareGraphic>>|undefined;
   try{
    const loaded=await g.load({renderType:'realtime',previewMuted:true,data:engineData(data,true)});check(!(loaded?.statusCode>=400),loaded?.statusMessage);if(format!=='tv')await attachSocialPreview(g,t,data,new AbortController().signal);
    prepared=await prepareGraphic(t,data,12,false,new AbortController().signal);const samples=[];
    for(const seconds of id==='BTV_Renvoi'?[1,4]:id==='BTV_Evenement'?[1,8]:[1,8,21]){
     await g.goToTime({seconds});g.__socialPreview?.refresh();const active=format==='tv'?Object.entries(g.tracks as Record<string,Track>).filter(([k,tr])=>k!=='audio'&&seconds>=(tr.activeStart||0)&&(tr.activeEnd===undefined||seconds<tr.activeEnd)).map(([k,tr])=>[k,Math.max(0,seconds-(tr.activeStart||0))] as const):Object.entries(socialTrackTimes(id,seconds,prepared.timeline.outAt));
     const mediaChecks=[];
     for(const [key,local]of active){const tr=g.tracks[key] as Track|undefined;if(!tr||tr.clips[0]?.type!=='video')continue;const expected=locateClip(tr.clips,local,tr.loop,tr.rate)!.time,node=tr.clips[0].node as HTMLVideoElement;await seek(reference,expected);check(Math.abs(node.currentTime-expected)<.002,`${id}/${format}/${key}: ${node.currentTime} != ${expected}`);const canvas=id==='BTV_Renvoi'?g.mediaCanvas:g.mediaItems.get(key).canvas;const diff=difference(pixels(canvas),pixels(reference));check(diff<3,'Source pixels differ '+diff);mediaChecks.push({key,expected,actual:node.currentTime,meanRGB:diff});}
     check(mediaChecks.length,'No active selected video');const output=await prepared.frame(Math.round(seconds*25),null),proof=sampleProof(output,Math.round(seconds*25));check(proof.alpha.some(a=>a>0),'Empty exported frame');
     let parity:number|undefined;if(format!=='tv'){const preview=sampleProof(scene.querySelector('canvas')!,Math.round(seconds*25));parity=difference(preview.rgb,proof.rgb);check(parity<12,`Preview/export pixels ${id}/${format}: ${parity}`);}else for(const [key,local]of active){const tr=prepared.tracks[key];if(tr?.clips[0]?.type==='video')check(Math.abs((tr.clips[0].node as HTMLVideoElement).currentTime-locateClip(tr.clips,local,tr.loop,tr.rate)!.time)<.002,'TV export ignored the selected cut');}
     samples.push({seconds,mediaChecks,parity});const thumb=document.createElement('canvas');thumb.width=format==='tv'?320:180;thumb.height=format==='vertical'?320:format==='portrait'?225:180;thumb.getContext('2d')!.drawImage(output,0,0,thumb.width,thumb.height);thumb.title=`${id} ${format} ${seconds}s`;gallery.append(thumb);
    }
    records.push({id,format,samples,pass:true});result.textContent=JSON.stringify(records,null,2);
   }finally{await prepared?.dispose();await g.dispose();g.remove();}
  }
  status.textContent=`PASS · 9 compositions · ${portable?'adaptateur HTML livré':'aperçu'} · fenêtres source, images et pipeline export`;
 }catch(e){status.textContent='FAIL · '+String(e);}finally{reference.pause();reference.removeAttribute('src');reference.load();button.disabled=false;}
};
