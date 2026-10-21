import {getTemplate} from '../src/studio/domain';
import {plannerProject} from '../src/studio/day-planner-project';
import type {Plan,PlannerRow} from '../src/studio/day-planner-model';
import {deriveProjects} from '../src/studio/derivation-model';
import {studioEngineModule} from '../src/studio/text-editing';
import {installSocialScene} from '../src/studio/social-scene';
import {installTypography} from '../src/studio/typography-engine';
import {attachSocialPreview} from '../src/studio/social-preview';
import {prepareGraphic,tracksOf} from '../src/studio/video/engine';
import type {LegacyGraphic} from '../src/studio/video/engine';
import {engineData} from '../src/studio/presentation';
import {sampleProof} from '../src/studio/video/frame-proof';

const button=document.querySelector<HTMLButtonElement>('#run')!,status=document.querySelector('#status')!,result=document.querySelector('#result')!,scene=document.querySelector('#scene')!,gallery=document.querySelector('#gallery')!;
function check(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
function difference(a:Uint8ClampedArray|number[],b:Uint8ClampedArray|number[]){check(a.length===b.length,'Sample dimensions');let sum=0;for(let i=0;i<a.length;i++)sum+=Math.abs(a[i]-b[i]);return sum/a.length;}
button.onclick=async()=>{
 button.disabled=true;gallery.replaceChildren();const records:unknown[]=[];
 try{
  check(location.hostname==='127.0.0.1','Local only');
  const media={url:'/preview-media/v1/ba-programme.mp4',name:'Démonstration locale.mp4',mimeType:'video/mp4'};
  // Persistable descriptor for generation; only the local bench substitutes the
  // demo URL AFTER the real production mapping has generated the linked data.
  const local={...media,url:`local-media:${'d'.repeat(64)}:100`};
  const row:PlannerRow={id:'programme',sheet:'LUNDI',cell:'A7',raw:'',title:'Grand entretien',subtitle:'Épisode 31',category:'Magazine',broadcastDate:'2026-09-07',airDate:'2026-09-07',time:'20:30:00',duration:1800,included:true,kinds:['renvoi','event'],formats:['tv'],issues:[],media:local,location:null,excerpt:{source:local.url,start:10,end:12,duration:60}};
  const plan:Plan={kind:'plan',name:'Recette locale',source:'fixture.xlsx',sourceHash:'a'.repeat(64),rows:[row]};
  const t=getTemplate('BTV_PopUp'),mod=await import(/* @vite-ignore */studioEngineModule(t)),tag='linked-popup-excerpt-test';if(!customElements.get(tag))customElements.define(tag,class extends mod.default{});
  for(const kind of ['renvoi','event'] as const)for(const format of ['tv','portrait','vertical'] as const){
   status.textContent=`${kind} → Pop-up · ${format}`;
   const source=plannerProject(plan,{kind,format,rowIds:[row.id]}),child=deriveProjects({templateId:source.template.id,templateVersion:source.template.version,libraryVersion:source.template.libraryVersion,title:source.title,data:source.data},['popup-follow'])[0];
   check(child.data._media_popup_start_seconds===10&&child.data._media_popup_end_seconds===12&&child.data._media_popup_loop===false,'The reviewed source window was lost');
   const data={...child.data,_media_popup_url:media,_studio_format:format},control={...data,_media_popup_start_seconds:10,_media_popup_end_seconds:12,_media_popup_loop:false};
   const g=document.createElement(tag) as LegacyGraphic;scene.style.height=format==='tv'?'270px':format==='portrait'?'600px':'853px';scene.append(g);
   if(format!=='tv')installSocialScene(g,t);installTypography(g,t,data);
   let prepared:Awaited<ReturnType<typeof prepareGraphic>>|undefined,expected:Awaited<ReturnType<typeof prepareGraphic>>|undefined;
   try{
    const loaded=await g.load({renderType:'realtime',previewMuted:true,data:engineData(data,true)});check(!(loaded?.statusCode>=400),loaded?.statusMessage);
    if(format!=='tv')await attachSocialPreview(g,t,data,new AbortController().signal);
    prepared=await prepareGraphic(t,data,12,false,new AbortController().signal);expected=await prepareGraphic(t,control,12,false,new AbortController().signal);
    const samples=[];
    for(const seconds of [1.2,3,6]){
     await g.goToTime({seconds});g.__socialPreview?.refresh();
     const track=tracksOf(g).popup,node=track.clips[0].node as HTMLVideoElement;
     check(track.clips[0].start===10&&track.clips[0].end===12&&!track.loop,'Preview did not prepare the chosen cut');
     check(node.currentTime>=10-.002&&node.currentTime<12,'Preview showed an image outside the selected passage');
     if(seconds===6)check(Math.abs(node.currentTime-11.96)<.002,'Short excerpt did not hold its final frame');
     const frame=await prepared.frame(Math.round(seconds*25),null),proof=sampleProof(frame,Math.round(seconds*25)),reference=sampleProof(await expected.frame(Math.round(seconds*25),null),Math.round(seconds*25));
     check(proof.alpha.some(a=>a>0),'Empty exported graphic');
     const rgb=difference(proof.rgb,reference.rgb),alpha=difference(proof.alpha,reference.alpha);check(rgb<.01&&alpha<.01,'Export differs from explicit 10–12 second control');
     let previewRGB:number|undefined,previewAlpha:number|undefined;
     if(format!=='tv'){const preview=sampleProof(scene.querySelector('canvas')!,Math.round(seconds*25));previewRGB=difference(preview.rgb,proof.rgb);previewAlpha=difference(preview.alpha,proof.alpha);check(previewRGB<12&&previewAlpha<1,'Social preview/export mismatch');}
     samples.push({seconds,previewSourceTime:node.currentTime,rgb,alpha,previewRGB,previewAlpha});
     const thumb=document.createElement('canvas');thumb.width=format==='tv'?320:180;thumb.height=format==='vertical'?320:format==='portrait'?225:180;thumb.getContext('2d')!.drawImage(frame,0,0,thumb.width,thumb.height);thumb.title=`${kind} → pop-up ${format} ${seconds}s`;gallery.append(thumb);
    }
    records.push({kind,format,pass:true,samples});result.textContent=JSON.stringify(records,null,2);
   }finally{await prepared?.dispose();await expected?.dispose();await g.dispose();g.remove();}
  }
  status.textContent='PASS · 6 compositions · passage conservé, dernière image et aperçu/export contrôlés';
 }catch(e){status.textContent='FAIL · '+String(e);}finally{button.disabled=false;}
};
