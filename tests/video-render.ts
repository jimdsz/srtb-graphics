import {broadcastTemplates,templateDefaults} from '../src/studio/domain';
import {prepareGraphic} from '../src/studio/video/engine';
import {exportBroadcastVideo} from '../src/studio/video/export';
import type {BroadcastTemplate,ProjectData} from '../src/studio/domain';
import {MODEL_COUNT} from './catalogue-matrix';
const select=document.querySelector<HTMLSelectElement>('#template')!,status=document.querySelector<HTMLPreElement>('#status')!;
document.querySelector('#batch')!.textContent=`Tester les ${MODEL_COUNT} modèles TV · MP4 et WebM alpha`;
const profile=document.createElement('button');profile.textContent='Mesurer 12 images';document.querySelector('#cancel')!.after(profile);
profile.addEventListener('click',()=>void(async()=>{
  let prepared;const reports:unknown[]=[];try{const t=broadcastTemplates.find(t=>t.id===select.value)!;prepared=await prepareGraphic(t,templateDefaults(t),Number(templateDefaults(t)._out_duration_seconds),false,new AbortController().signal);
    for(const index of [0,1,2,3,250,251,252,253,1650,1651,1652,1653]){const started=performance.now();const canvas=await prepared.frame(index,null);reports.push({index,total:performance.now()-started,...prepared.timings});status.textContent=JSON.stringify(reports,null,2);if(index===250){const blob=await new Promise<Blob>(r=>canvas.toBlob(b=>r(b!)));await fetch(`/__video-evidence/body-${Date.now()}.png`,{method:'POST',body:blob});}}
  }catch(e){status.textContent=String(e);}finally{await prepared?.dispose();}
})());
for(const t of broadcastTemplates){const o=document.createElement('option');o.value=t.id;o.textContent=t.name;select.append(o);}select.value='BTV_Relais_Antenne';
document.querySelector('#frame')!.addEventListener('click',()=>void(async()=>{
  status.textContent='Calcul…';let g;try{
    const template=broadcastTemplates.find(t=>t.id===select.value)!,data=templateDefaults(template);if(template.id==='BTV_Passerelle_Replay')data._replay_url='https://srtb.bj';
    g=await prepareGraphic(template,data,Number(data._out_duration_seconds),false,new AbortController().signal);
    const canvas=await g.frame(50,null),copy=document.createElement('canvas');copy.width=1920;copy.height=1080;copy.getContext('2d')!.drawImage(canvas,0,0);document.querySelector('#frame-output')!.replaceChildren(copy);
    const pixels=canvas.getContext('2d')!.getImageData(0,0,1920,1080).data;let transparent=0,opaque=0,partial=0;for(let i=3;i<pixels.length;i+=4){if(pixels[i]===0)transparent++;else if(pixels[i]===255)opaque++;else partial++;}
    const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('PNG absent')),'image/png'));
    const r=await fetch(`/__video-evidence/${template.id}-${Date.now()}.png`,{method:'POST',body:blob});if(!r.ok)throw Error(await r.text());
    status.textContent=JSON.stringify({template:template.id,timeline:g.timeline,transparent,opaque,partial},null,2);
  }catch(error){status.textContent=error instanceof Error?`${error.message}\n${error.stack}`:String(error);}finally{await g?.dispose();}
})());
function mediaData(template:BroadcastTemplate):ProjectData{
  const data=templateDefaults(template),movie={url:'/library/v1.7.0/BTV_BA_1P/lib/media/programme.mp4',name:'programme.mp4',mimeType:'video/mp4'};
  const video=(kind:string,start:number,end:number)=>{const p=`_media_${kind}`;data[p+'_url']=movie;data[p+'_start_seconds']=start;data[p+'_end_seconds']=end;data[p+'_loop']=true;data[p+'_audio_enabled']=true;data[p+'_volume']=.25;};
  if(template.id==='BTV_Passerelle_Replay')data._replay_url='https://srtb.bj';
  if(['BTV_Ce_Soir','BTV_Passerelle_Replay','BTV_Relais_Antenne'].includes(template.id))Object.assign(data,{_audio_enabled:true,_audio_url:'/library/v1.7.0/BTV_BA_TDS/lib/audio/BTV_BA TDS -23LUFS.wav',_audio_volume:.3,_audio_loop:true,_audio_end_seconds:4});
  if(template.id==='BTV_Ce_Soir')video('1',3,6);
  if(template.id==='BTV_PopUp'){video('background',3,7);video('popup',10,13);data._media_popup_sequence=JSON.stringify([{url:movie,start:10,end:11},{url:movie,start:20,end:22}]);}
  if(template.id==='BTV_BA_TDS'){data._background_visible=true;video('background',3,7);data._audio_bed_enabled=true;data._audio_voice_enabled=true;data._audio_bed_volume=.3;data._audio_voice_volume=.3;}
  if(template.id==='BTV_BA_TDS_SUIVI_DE'){data._media_mode='internal';video('programme_1',5,12);video('programme_2',20,26);data._audio_bed_enabled=true;data._audio_bed_volume=.3;}
  return data;
}
document.querySelector('#batch')!.addEventListener('click',()=>void(async()=>{
  if(controller)return;controller=new AbortController();const results:unknown[]=[],stamp=Date.now();
  for(const template of broadcastTemplates)for(const format of ['mp4','alpha'] as const){
    if(controller.signal.aborted)break;
    let result;const started=performance.now();
    try{
      const data=mediaData(template);
      result=await exportBroadcastVideo(template,data,{format,manualOut:Number(data._out_duration_seconds),removeBackground:format==='alpha',audio:true,background:'#000000'},controller.signal,p=>status.textContent=`${template.id} ${format} — ${p.percent}% ${p.message}`);
      const name=`batch-${stamp}-${template.id}.${format==='mp4'?'mp4':'webm'}`;
      const response=await fetch('/__video-evidence/'+name,{method:'POST',body:result.blob});if(!response.ok)throw Error(await response.text());
      results.push({id:template.id,...result.report,elapsed:(performance.now()-started)/1000,name,success:true});
    }catch(error){results.push({id:template.id,format,success:false,error:error instanceof Error?error.message:String(error)});}
    finally{await result?.dispose();document.querySelector('#results')!.textContent=JSON.stringify(results,null,2);}
  }
  await fetch(`/__video-evidence/batch-${stamp}.json`,{method:'POST',body:JSON.stringify(results,null,2)});status.textContent=controller.signal.aborted?'Recette interrompue.':'Recette terminée.';controller=undefined;
})());
let controller:AbortController|undefined;
document.querySelector('#cancel')!.addEventListener('click',()=>controller?.abort());
for(const format of ['mp4','alpha'] as const)document.querySelector('#'+format)!.addEventListener('click',()=>void(async()=>{
  controller=new AbortController();const template=broadcastTemplates.find(t=>t.id===select.value)!,data=templateDefaults(template);if(template.id==='BTV_Passerelle_Replay')data._replay_url='https://srtb.bj';
  const stamp=Date.now(),started=performance.now();let result;try{
    result=await exportBroadcastVideo(template,data,{format,manualOut:Number(data._out_duration_seconds),removeBackground:format==='alpha',audio:true,background:'#000000'},controller.signal,p=>status.textContent=`${p.percent}% ${p.message}`,async(blob,proofs)=>{
      await fetch(`/__video-evidence/unverified-${template.id}-${stamp}.${format==='mp4'?'mp4':'webm'}`,{method:'POST',body:blob});
      for(const proof of proofs){const c=document.createElement('canvas');c.width=96;c.height=54;c.getContext('2d')!.putImageData(new ImageData(proof.rgb,96,54),0,0);const png=await new Promise<Blob>(resolve=>c.toBlob(b=>resolve(b!)));await fetch(`/__video-evidence/proof-${template.id}-${stamp}-${proof.frame}.png`,{method:'POST',body:png});}
    });
    const name=`${template.id}-${stamp}.${format==='mp4'?'mp4':'webm'}`;
    const r=await fetch('/__video-evidence/'+name,{method:'POST',body:result.blob});if(!r.ok)throw Error(await r.text());
    const report={...result.report,elapsed:(performance.now()-started)/1000,name};
    await fetch(`/__video-evidence/${template.id}-${stamp}.json`,{method:'POST',body:JSON.stringify(report,null,2)});status.textContent=JSON.stringify(report,null,2);
  }catch(error){status.textContent=error instanceof Error?`${error.message}\n${error.stack}`:String(error);}finally{await result?.dispose();controller=undefined;}
})());
