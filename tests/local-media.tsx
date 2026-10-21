import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {getTemplate,templateDefaults,validateProjectData} from '../src/studio/domain';
import type {ProjectData} from '../src/studio/domain';
import {LocalFileButton} from '../src/studio/LocalMedia';
import LocalMedia from '../src/studio/LocalMedia';
import Preview from '../src/studio/Preview';
import {resolveLocalData} from '../src/studio/local-media';
import '../src/studio/studio.css';
const template=getTemplate('BTV_PopUp');
function Test(){
  const [data,setData]=useState<ProjectData>(()=>{try{return JSON.parse(sessionStorage.getItem('srtb-local-media-qa')||'null')||templateDefaults(template);}catch{return templateDefaults(template);}}),[report,setReport]=useState('Prêt.'),[running,setRunning]=useState(false);
  return <main style={{padding:24}}><h1>Recette des médias locaux</h1><p>Choisir un fichier ne l’envoie pas. Test sur ce navigateur et ce poste uniquement.</p><LocalFileButton onChoose={value=>{const next={...data,_media_popup_url:value,_media_popup_start_seconds:0,_media_popup_end_seconds:3,_media_popup_audio_enabled:false,_out_mode:'duration',_out_duration_seconds:5};setData(next);setReport(JSON.stringify(validateProjectData(template,next),null,2));}}/><LocalMedia template={template} data={data}/>
    <button onClick={()=>{sessionStorage.setItem('srtb-local-media-qa',JSON.stringify(data));setReport('Références enregistrées pour la recette. Aucun fichier copié.');}}>Mémoriser les références de recette</button>
    <button disabled={running} onClick={()=>void(async()=>{setRunning(true);let result;try{const {exportBroadcastVideo}=await import('../src/studio/video/export');const started=performance.now();result=await exportBroadcastVideo(template,resolveLocalData(template,validateProjectData(template,data)),{format:'mp4',audio:false,manualOut:5,removeBackground:false,background:'#000000'},new AbortController().signal,p=>setReport(p.message));const response=await fetch(`/__video-evidence/local-media-${Date.now()}.mp4`,{method:'POST',body:result.blob});if(!response.ok)throw Error(await response.text());setReport(JSON.stringify({...result.report,elapsed:(performance.now()-started)/1000},null,2));}catch(e){setReport(e instanceof Error?e.message:String(e));}finally{await result?.dispose();setRunning(false);}})()}>Tester l’export avec le fichier local</button>
    <pre role="status" style={{whiteSpace:'pre-wrap'}}>{report}</pre><Preview template={template} data={data}/></main>;
}
createRoot(document.querySelector('#root')!).render(<Test/>);
