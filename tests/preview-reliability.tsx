// Local test bench only; never imported by a production entry point.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {broadcastTemplates,getTemplate,templateDefaults,validateProjectData} from '../src/studio/domain';
import type {ProjectData} from '../src/studio/domain';
import Preview from '../src/studio/Preview';
import Fields from '../src/studio/Fields';
import LocalMedia from '../src/studio/LocalMedia';
import {bindLocalFile,resolveLocalData,localReferences,localURL} from '../src/studio/local-media';
import {localBindings} from '../src/studio/local-files';
import {selectedMediaData} from '../src/studio/media-selection';
import '../src/studio/studio.css';
import '../src/studio/responsive.css';
import '../src/studio/theme.css';

const qa:any={templates:broadcastTemplates,bindLocalFile,localReferences,localURL};
(window as any).previewQA=qa;
function Bench(){
  const [id,setId]=useState('BTV_PopUp'),[data,setData]=useState(templateDefaults(getTemplate(id)));
  const [exportStatus,setExportStatus]=useState(''),[exporting,setExporting]=useState(false);
  const template=getTemplate(id);
  qa.set=(nextId:string,patch:ProjectData={})=>{setId(nextId);setData({...templateDefaults(getTemplate(nextId)),...patch});};
  qa.data=()=>data;
  qa.patch=(patch:ProjectData)=>setData(previous=>({...previous,...patch}));
  qa.export=async(format:'mp4'|'alpha'|'png',audio=false)=>{
    const {exportBroadcastVideo}=await import('../src/studio/video/export');
    const result=await exportBroadcastVideo(template,resolveLocalData(template,validateProjectData(template,selectedMediaData(template,data))),{format,audio,manualOut:3.2,removeBackground:format==='alpha',background:'#000000'},new AbortController().signal,()=>{});
    try{return result.report;}finally{await result.dispose();}
  };
  async function runExport(format:'mp4'|'png'){
    setExporting(true);setExportStatus('Préparation…');window.dispatchEvent(new Event('srtb-render-start'));
    const started=performance.now();
    try{
      const {exportBroadcastVideo}=await import('../src/studio/video/export');
      const result=await exportBroadcastVideo(template,resolveLocalData(template,validateProjectData(template,selectedMediaData(template,data))),{format,audio:true,manualOut:3.2,removeBackground:format==='png',background:'#000000'},new AbortController().signal,p=>setExportStatus(p.message));
      try{setExportStatus(JSON.stringify({...result.report,renderSeconds:(performance.now()-started)/1000},null,2));}finally{await result.dispose();}
    }catch(error){setExportStatus('ÉCHEC : '+String(error));}
    finally{setExporting(false);window.dispatchEvent(new Event('srtb-render-end'));}
  }
  return <main style={{padding:24}}><h1>Fiabilité aperçu et médias</h1><label>Modèle de test<select value={id} onChange={event=>qa.set(event.target.value)}>{broadcastTemplates.map(t=><option key={t.id} value={t.id}>{t.id}</option>)}</select></label><button onClick={()=>{
    const entry=[...localBindings].at(-1);if(!entry)return;const [url,{file}]=entry;
    const next=templateDefaults(template);for(const key of Object.keys(next)){
      if(key.startsWith('_media_')&&key.endsWith('_url')){next[key]={url,name:file.name,mimeType:'video/mp4'};next[key.replace(/_url$/,'_start_seconds')]=2;next[key.replace(/_url$/,'_end_seconds')]=8;}
      if(/^_audio.*_enabled$/.test(key))next[key]=false;
    }
    if('_background_visible'in next)next._background_visible=true;if('_media_mode'in next)next._media_mode='internal';setData(next);
  }}>Tester le dernier fichier local sur toutes les pistes</button><section aria-label="Recette export"><button disabled={exporting||id!=='BTV_PopUp'} onClick={()=>{
    const entry=[...localBindings].at(-1);if(!entry)return;const [url,{file}]=entry,source={url,name:file.name,mimeType:'video/mp4'};
    setData({...templateDefaults(template),_background_visible:false,_media_popup_url:source,_media_popup_sequence:JSON.stringify([{url:source,start:600,end:601},{url:source,start:900,end:901}]),_media_popup_audio_enabled:true});
  }}>Préparer deux extraits éloignés avec son</button><button disabled={exporting} onClick={()=>void runExport('mp4')}>Tester le rendu MP4</button><button disabled={exporting} onClick={()=>void runExport('png')}>Tester la séquence PNG alpha</button><pre role="status">{exportStatus}</pre></section><LocalMedia template={template} data={data}/><div className="editor-grid"><Preview key={`preview-${id}`} template={template} data={data}/><Fields key={`fields-${id}`} template={template} data={data} media={[]} onChange={setData}/></div><details><summary>Données de test</summary><pre>{JSON.stringify(data,null,2)}</pre></details></main>;
}
createRoot(document.querySelector('#root')!).render(<Bench/>);
