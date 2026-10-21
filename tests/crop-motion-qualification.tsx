import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {getTemplate,templateDefaults,validateProjectData} from '../src/studio/domain';
import type {ProjectData} from '../src/studio/domain';
import {patchCropMotion,cropMotionMatches,currentCropMotion} from '../src/studio/crop-motion';
import {engineData} from '../src/studio/presentation';
import {prepareGraphic} from '../src/studio/video/engine';
import type {LegacyGraphic} from '../src/studio/video/engine';
import {attachSocialPreview} from '../src/studio/social-preview';
import {installSocialScene} from '../src/studio/social-scene';
import {installTypography} from '../src/studio/typography-engine';
import {studioEngineModule} from '../src/studio/text-editing';
import {installBAMediaReadiness} from '../src/studio/media-readiness';
import {stripSupplementalVoice} from '../src/studio/supplemental-voice';
import {tracksOf} from '../src/studio/media-tracks';
import {sampleProof} from '../src/studio/video/frame-proof';
import MediaCrop from '../src/studio/MediaCrop';
import Fields from '../src/studio/Fields';
import {patchClipCrop,sequenceCropKey} from '../src/studio/sequence-crop';
import '../src/studio/studio.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';

const ensure=(value:unknown,message:string)=>{if(!value)throw Error(message);};
const status=document.querySelector<HTMLElement>('#status')!,result=document.querySelector<HTMLElement>('#result')!,button=document.querySelector<HTMLButtonElement>('#run')!,cancel=document.querySelector<HTMLButtonElement>('#cancel')!;
const ids=['BTV_BA_1P','BTV_BA_TDS','BTV_BA_TDS_SUIVI_DE','BTV_PopUp','BTV_Ce_Soir','BTV_Renvoi','BTV_Evenement','BTV_Semainier'];
let controller:AbortController|undefined;
function fixture(id:string,format:string,url:string,video=false,sequences=false){
  const template=getTemplate(id),data:ProjectData={...templateDefaults(template),_studio_format:format,_out_mode:'manual',_out_duration_seconds:30};
  for(const key of Object.keys(data)){
    if(/_audio.*enabled$/.test(key)||/_(sponsor|mentions|credit|inedit).*visible$/.test(key))data[key]=false;
    if(/^_media_.+_sequence$/.test(key))data[key]='[]';
    if(/^_media_.+_url$/.test(key)){
      const kind=key.slice(7,-4);data[key]={url,name:video?'recette.mp4':'recette.png',mimeType:video?'video/mp4':'image/png'};
      for(const [suffix,value]of [['start_seconds',0],['end_seconds',30],['rate',1],['loop',false]] as const){const name=key.slice(0,-4)+'_'+suffix;if(name in data)data[name]=value;}
      Object.assign(data,patchCropMotion(data,kind,{start:0,end:Number(data[`_media_${kind}_end_seconds`]||0),duration:30,points:[{at:0,x:0,y:20,transition:'smooth'},{at:3,x:100,y:80,transition:'smooth'},{at:5,x:10,y:30,transition:'cut'},{at:15,x:90,y:70,transition:'linear'}]}));
      ensure(cropMotionMatches(data,kind,currentCropMotion(data,kind)!),`Repères inactifs dans la recette ${id} ${kind}`);
    }
  }
  if('_background_visible' in data)data._background_visible=true;
  if('_media_mode' in data)data._media_mode='internal';
  if(sequences)for(const name of Object.keys(template.fields).filter(key=>/^_media_.+_sequence$/.test(key))){
    const kind=name.slice(7,-9),clips=video?[{url:{url,name:'recette.mp4',mimeType:'video/mp4'},start:2,end:7},{url:{url,name:'recette.mp4',mimeType:'video/mp4'},start:11,end:0}]:[{url:{url,name:'recette.png',mimeType:'image/png'},start:0,end:5},{url:{url,name:'recette.png',mimeType:'image/png'},start:0,end:6}];
    data[name]=JSON.stringify(clips);
    clips.forEach((clip,index)=>Object.assign(data,patchClipCrop(data,kind,clip,index,{[`_studio_${kind}_x`]:index?90:10,[`_studio_${kind}_fit`]:'cover',[`_studio_${kind}_crop_motion`]:JSON.stringify({[format]:{start:clip.start,end:clip.end,duration:clip.end?clip.end-clip.start:30,points:[{at:0,x:index?100:0,y:20,transition:'smooth'},{at:4,x:index?0:100,y:80,transition:'linear'}]}})})));
    if(`_media_${kind}_rate` in data)data[`_media_${kind}_rate`]=1.25;
    if(`_media_${kind}_loop` in data)data[`_media_${kind}_loop`]=true;
  }
  return validateProjectData(template,data,true);
}
async function parity(id:string,format:string,url:string,signal:AbortSignal,video=false,sequences=false){
  const template=getTemplate(id),data=fixture(id,format,url,video,sequences),module=await import(/* @vite-ignore */studioEngineModule(template)),tag='crop-check-'+id.toLowerCase().replaceAll('_','-');
  if(!customElements.get(tag))customElements.define(tag,class extends module.default{});
  const host=document.createElement('div');host.style.cssText='position:fixed;left:-20000px;width:432px;height:768px';document.body.append(host);
  const graphic=document.createElement(tag) as LegacyGraphic;host.append(graphic);installSocialScene(graphic,template);installTypography(graphic,template,data);await installBAMediaReadiness(template);
  let prepared:Awaited<ReturnType<typeof prepareGraphic>>|undefined;
  try{
    const loaded=await graphic.load({renderType:'realtime',previewMuted:true,data:stripSupplementalVoice(template,engineData(data,true))});ensure(!(loaded?.statusCode>=400),'Chargement refusé '+id+': '+loaded?.statusMessage);
    await attachSocialPreview(graphic,template,data,signal);prepared=await prepareGraphic(template,data,30,false,signal);
    const samples=[];
    for(const seconds of [2,4.96,5,8,17]){
      signal.throwIfAborted();await graphic.goToTime({seconds});graphic.__socialPreview?.refresh();
      const canvas=host.querySelector('canvas')!,index=Math.round(seconds*25),a=sampleProof(canvas,index),b=sampleProof(await prepared.frame(index,null),index);
      let rgb=0,alpha=0;for(let i=0;i<a.alpha.length;i++){alpha+=Math.abs(a.alpha[i]-b.alpha[i]);for(let j=0;j<3;j++)rgb+=Math.abs(a.rgb[i*4+j]-b.rgb[i*4+j]);}
      const difference={rgb:rgb/(a.alpha.length*3),alpha:alpha/a.alpha.length};ensure(difference.rgb<12&&difference.alpha<1,`Parité ${id} ${format} ${seconds}: ${JSON.stringify(difference)}`);samples.push({seconds,...difference});
    }
    const canvas=host.querySelector('canvas')!,before=sampleProof(canvas,425),tracks=tracksOf(graphic),identities=Object.values(tracks).flatMap(track=>track.clips.map(clip=>clip.node));
    const changed={...data};for(const key of Object.keys(data).filter(key=>key.endsWith('_crop_motion'))){const all=JSON.parse(String(data[key]));if(all[format]){all[format].points=all[format].points.map((point:Record<string,unknown>)=>({...point,x:5,y:95}));changed[key]=JSON.stringify(all);}}
    if(sequences)for(const key of Object.keys(data).filter(key=>key.endsWith('_sequence_crops'))){const all=JSON.parse(String(data[key]));for(const entry of all)if(entry?.[format]){entry[format].x=5;entry[format].y=95;if(entry[format].motion)entry[format].motion.points=entry[format].motion.points.map((point:Record<string,unknown>)=>({...point,x:5,y:95}));}changed[key]=JSON.stringify(all);}
    ensure(await graphic.__socialPreview.updateLive(changed,()=>true),'Recadrage refusé par le chemin immédiat');
    ensure(host.querySelector('canvas')===canvas,'Canevas recréé pendant le déplacement');
    const afterIdentities=Object.values(tracksOf(graphic)).flatMap(track=>track.clips.map(clip=>clip.node));ensure(identities.length===afterIdentities.length&&identities.every((node,i)=>node===afterIdentities[i]),'Médias recréés pendant le déplacement');
    const after=sampleProof(canvas,425);let delta=0;for(let i=0;i<before.rgb.length;i++)delta+=Math.abs(before.rgb[i]-after.rgb[i]);ensure(delta/before.rgb.length>1,'Le déplacement ne change pas réellement les pixels');
    return {id,format,sequences,samples,immediateCrop:{sameCanvas:true,sameMedia:true,pixelDifference:delta/before.rgb.length},pass:true};
  }finally{await prepared?.dispose();await graphic.dispose();host.remove();}
}
button.onclick=async()=>{
  if(location.hostname!=='127.0.0.1')return;
  button.disabled=true;cancel.disabled=false;controller=new AbortController();const rows:unknown[]=[];
  const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;const c=canvas.getContext('2d')!;
  for(let x=0;x<1920;x+=80){c.fillStyle=`hsl(${x/1920*360} 85% 50%)`;c.fillRect(x,0,80,1080);c.fillStyle='#111';c.fillRect(x,40+(x%400),40,60);}
  const blob=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!),'image/png')),url=URL.createObjectURL(blob);
  try{
    const sequences=new URLSearchParams(location.search).get('sequences')==='1';
    for(const id of ids)for(const format of ['portrait','vertical']){status.textContent=`Contrôle ${id} · ${format}`;rows.push(await parity(id,format,url,controller.signal,false,sequences));result.textContent=JSON.stringify(rows,null,2);}
    status.textContent='Contrôle vidéo réelle · TDS · 9:16';const response=await fetch('/preview-media/v1/ba-programme.mp4',{signal:controller.signal});ensure(response.ok,'Vidéo de recette absente');const videoURL=URL.createObjectURL(await response.blob());try{rows.push(await parity('BTV_BA_TDS','vertical',videoURL,controller.signal,true,sequences));}finally{URL.revokeObjectURL(videoURL);}result.textContent=JSON.stringify(rows,null,2);
    status.textContent='PASS — 16 compositions sur image et 1 vidéo / 85 images comparées : aperçu et export cohérents.';
  }catch(error){status.textContent='FAIL — '+String(error);}finally{URL.revokeObjectURL(url);controller=undefined;button.disabled=false;cancel.disabled=true;}
};cancel.onclick=()=>controller?.abort();

const template=getTemplate('BTV_BA_TDS');
function Editor(){
  const [width,setWidth]=useState(420),[theme,setTheme]=useState('dark');
  const [data,setData]=useState<ProjectData>(()=>({...templateDefaults(template),_studio_format:'vertical',_media_background_url:{url:'/preview-media/v1/ba-programme.mp4',name:'recette.mp4',mimeType:'video/mp4'},_media_background_start_seconds:1.24,_media_background_end_seconds:6.24,_media_background_rate:1,_media_background_loop:false}));
  const patch=(value:ProjectData)=>setData(previous=>({...previous,...value}));
  const sequences=new URLSearchParams(location.search).get('sequences')==='1';
  return <section style={{marginTop:30}}><h2>Gestes réels — vidéo locale de démonstration</h2><div className="row"><label>Largeur<select value={width} onChange={event=>setWidth(Number(event.target.value))}><option value={420}>420 px</option><option value={280}>280 px</option></select></label><label>Thème<select value={theme} onChange={event=>{setTheme(event.target.value);document.documentElement.dataset.theme=event.target.value;}}><option value="dark">Sombre</option><option value="light">Clair</option></select></label><label>Format<select value={String(data._studio_format)} onChange={event=>patch({_studio_format:event.target.value})}><option value="vertical">9:16</option><option value="portrait">4:5</option></select></label></div>
    <div style={{width,maxWidth:'100%',padding:12,border:'1px solid var(--line)'}}>{sequences?<Fields template={template} data={data} media={[]} onChange={setData}/>:<MediaCrop template={template} value={data._media_background_url} kind="background" data={data} start={Number(data._media_background_start_seconds)} onPatch={patch}/>}</div>
    <output aria-label="Réglages de cadrage" style={{display:'block',whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify({_studio_format:data._studio_format,x:data._studio_background_x,y:data._studio_background_y,repères:JSON.parse(String(data._studio_background_crop_motion)),passages:JSON.parse(String(data._media_background_sequence)),cadrages:JSON.parse(String(data[sequenceCropKey('background')]))},null,2)}</output>
  </section>;
}
createRoot(document.getElementById('root')!).render(<Editor/>);
