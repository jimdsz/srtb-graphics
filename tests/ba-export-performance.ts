import {getTemplate,templateDefaults} from '../src/studio/domain';
import {simpleBaDefaults} from '../src/studio/presentation';
import {studioEngineModule} from '../src/studio/text-editing';
import {exportBroadcastVideo} from '../src/studio/video/export';
import {ExportProfile} from '../src/studio/video/export-profile';
import {NATIVE_ONLY_EXPORT} from '../src/studio/video/release-profile';

const run=document.querySelector<HTMLButtonElement>('#run')!,cancel=document.querySelector<HTMLButtonElement>('#cancel')!,status=document.querySelector<HTMLElement>('#status')!,progress=document.querySelector<HTMLProgressElement>('#progress')!,summary=document.querySelector<HTMLElement>('#summary')!,resultNode=document.querySelector<HTMLElement>('#result')!,downloads=document.querySelector<HTMLElement>('#downloads')!;
const template=getTemplate('BTV_BA_1P'),data={...simpleBaDefaults(templateDefaults(template)),_studio_format:'tv',_jour_1:'Aujourd’hui',_heure_1:'',_out_mode:'manual',_out_duration_seconds:12,_audio_voice_enabled:false};
let controller:AbortController|undefined,previous:Awaited<ReturnType<typeof exportBroadcastVideo>>|undefined,urls:string[]=[],runs=0;
const digest=async(bytes:BufferSource)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
const percentile=(values:number[],fraction:number)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.floor(sorted.length*fraction))]??0;};
function download(blob:Blob,name:string,label:string){const link=document.createElement('a'),url=URL.createObjectURL(blob);urls.push(url);link.href=url;link.download=name;link.textContent=label;downloads.append(link);}
if(location.hostname!=='127.0.0.1'||!import.meta.env.VITE_STUDIO_QUALIFICATION||!NATIVE_ONLY_EXPORT)status.textContent='Banc refusé : utiliser uniquement le serveur de qualification native local 5199. Aucun calcul lancé.';
else{run.disabled=false;status.textContent='Prêt · démarrage manuel uniquement. Aucune autre exportation simultanée.';}
cancel.addEventListener('click',()=>controller?.abort(new DOMException('Mesure annulée par l’opérateur.','AbortError')));
window.addEventListener('beforeunload',()=>controller?.abort());
run.addEventListener('click',()=>void(async()=>{
  if(controller)return;controller=new AbortController();run.disabled=true;cancel.disabled=false;progress.value=0;summary.textContent=resultNode.textContent='';downloads.replaceChildren();
  for(const url of urls)URL.revokeObjectURL(url);urls=[];await previous?.dispose();previous=undefined;
  const profile=new ExportProfile(),started=performance.now(),visibility=[{atMs:0,state:document.visibilityState}],recordVisibility=()=>visibility.push({atMs:performance.now()-started,state:document.visibilityState});
  document.addEventListener('visibilitychange',recordVisibility);let success=false,error:string|undefined;
  try{
    previous=await exportBroadcastVideo(template,data,{format:'mp4',manualOut:12,removeBackground:false,audio:true,background:'#000000'},controller.signal,event=>{progress.value=event.percent;status.textContent=`${event.percent} % · ${event.message}`;},undefined,undefined,profile);
    success=true;download(previous.blob,`ba-native-performance-${Date.now()}.mp4`,'Télécharger le MP4 contrôlé');
  }catch(reason){error=reason instanceof Error?reason.message:String(reason);status.textContent=`Mesure interrompue : ${error}`;}
  finally{
    profile.endFrame();document.removeEventListener('visibilitychange',recordVisibility);const trace=profile.snapshot();
    const report={success,error,run:++runs,visibility,elapsedMs:performance.now()-started,template:template.id,engineModule:studioEngineModule(template),parametersSHA256:await digest(new TextEncoder().encode(JSON.stringify(data))),nativeOnly:NATIVE_ONLY_EXPORT,export:previous?.report,trace};
    const phaseFrames=Object.fromEntries(['intro','body','out'].map(phase=>{const frames=trace.frames.filter(frame=>frame.phase===phase),values=frames.map(frame=>frame.stages['frame.total']?.ms??0);return [phase,{frames:frames.length,renderP50Ms:percentile(values,.5),renderP95Ms:percentile(values,.95),stages:trace.phases[phase as 'intro'|'body'|'out']}];}));
    summary.textContent=JSON.stringify({...report,trace:undefined,stages:trace.stages,counters:trace.counters,phaseFrames,accounting:trace.accounting},null,2);
    const json=JSON.stringify(report,null,2);resultNode.textContent=json;download(new Blob([json],{type:'application/json'}),`ba-native-performance-${Date.now()}.json`,'Télécharger les mesures JSON');
    if(success)status.textContent='Terminé · MP4 contrôlé et mesures disponibles. Les vérifications image, audio et débit sont restées actives.';
    controller=undefined;run.disabled=false;cancel.disabled=true;
  }
})());
