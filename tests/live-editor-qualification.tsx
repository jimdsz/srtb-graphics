import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {broadcastTemplates,getTemplate,templateDefaults} from '../src/studio/domain';
import type {ProjectData} from '../src/studio/domain';
import type {SelectedElement} from '../src/studio/element-selection';
import {simpleBaDefaults} from '../src/studio/presentation';
import Preview from '../src/studio/Preview';
import Fields from '../src/studio/Fields';
import '../src/studio/studio.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';
const IMAGE='/library/v1.7.0/BTV_Ce_Soir/lib/media/programme.jpg';
function fixture(id:string,format:string){
  let data=templateDefaults(getTemplate(id));if(id==='BTV_BA_1P')data=simpleBaDefaults(data);
  data={...data,_studio_format:format,_studio_typography:'{}',_studio_overlay_logo_enabled:true,_studio_overlay_logo_url:IMAGE,_studio_overlay_logo_motion:'none'};
  for(const key of Object.keys(data)){
    if(/_audio.*enabled$/.test(key))data[key]=false;
    if(/^_media_.+_sequence$/.test(key))data[key]='[]';
    if(/^_media_.+_url$/.test(key)&&data[key]){const prefix=key.slice(0,-4);data[key]=IMAGE;
      if(prefix+'_start_seconds'in data)data[prefix+'_start_seconds']=0;
      if(prefix+'_end_seconds'in data)data[prefix+'_end_seconds']=40;
      if(prefix+'_rate'in data)data[prefix+'_rate']=1;
    }
  }
  if(id==='BTV_Passerelle_Replay')data._replay_url='https://srtb.bj';
  return data;
}
function App(){
  const [id,setId]=useState('BTV_PopUp'),[format,setFormat]=useState('tv'),[generation,setGeneration]=useState(0),[data,setData]=useState<ProjectData>(()=>fixture('BTV_PopUp','tv')),[selected,setSelected]=useState<SelectedElement>(),[tab,setTab]=useState('settings'),[ready,setReady]=useState(false);
  const [evidence,setEvidence]=useState('');const template=getTemplate(id);
  function reset(nextId=id,nextFormat=format){setId(nextId);setFormat(nextFormat);setData(fixture(nextId,nextFormat));setGeneration(n=>n+1);setSelected(undefined);setEvidence('');}
  function measure(){const g=document.querySelector('.graphic-host')?.firstElementChild as any;setEvidence(JSON.stringify({selected,tab,phase:g?.__previewTransport?.snapshot(),texts:[...(g?.shadowRoot?.querySelectorAll('[data-studio-text-field]')||[])].map((n:any)=>({field:n.getAttribute('data-studio-text-field'),text:n.textContent,display:n.style.display,transform:n.getAttribute('transform')})),styles:data._studio_typography,data:{_jour_1:data._jour_1,_heure_1:data._heure_1,_studio_ba_appointment_display:data._studio_ba_appointment_display},errors:[...document.querySelectorAll('[role=alert]')].map(n=>n.textContent)},null,2));}
  return <main style={{maxWidth:1500,margin:'auto',padding:20}}><h1>Recette locale · édition directe</h1><p>Données fictives, aucun compte ni enregistrement. Aucun fichier envoyé.</p><div className="row"><label>Modèle de test<select value={id} onChange={e=>reset(e.target.value)}>{broadcastTemplates.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label>Format de test<select value={format} onChange={e=>reset(id,e.target.value)}><option value="tv">TV 16:9</option><option value="portrait">4:5</option><option value="vertical">9:16</option></select></label><button onClick={measure}>Mesurer l’état</button><output aria-label="État de la recette">{ready?'Prêt':'En cours'} · sélection {selected?.field||'aucune'}</output></div>
  <div className="editor-grid"><div className="editor-stage"><Preview key={generation} template={template} data={data} onChange={setData} onReadinessChange={setReady} onSelectElement={field=>{setTab('settings');setSelected(previous=>({field,serial:(previous?.serial||0)+1}));}}/></div><aside className="editor-sidebar"><nav className="tabs"><button onClick={()=>setTab('settings')}>Réglages</button><button onClick={()=>setTab('history')}>Historique de test</button></nav>{tab==='settings'?<Fields template={template} data={data} media={[]} onChange={setData} selectedElement={selected}/>:<p>Historique fictif : cliquez un élément dans l’aperçu pour revenir à ses réglages.</p>}</aside></div><pre aria-label="Preuve de la recette" style={{whiteSpace:'pre-wrap',maxHeight:350,overflow:'auto'}}>{evidence}</pre></main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
