import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import Workspace from '../src/studio/Workspace';
import {getTemplate,templateDefaults} from '../src/studio/domain';
import type {Project,ProjectData} from '../src/studio/domain';
import {engineData,simpleBaDefaults} from '../src/studio/presentation';
import '../src/studio/studio.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';
const image='/library/v1.7.0/BTV_Ce_Soir/lib/media/programme.jpg';
function project(id:string):Project{
  const t=getTemplate(id);let data:ProjectData=templateDefaults(t);if(id==='BTV_BA_1P')data=simpleBaDefaults(data);
  for(const key of Object.keys(data)){
    if(/_audio.*enabled$/.test(key))data[key]=false;
    if(/^_media_.+_sequence$/.test(key))data[key]='[]';
    if(/^_media_.+_url$/.test(key)&&data[key]){const prefix=key.slice(0,-4);data[key]=image;if(prefix+'_start_seconds' in data)data[prefix+'_start_seconds']=0;if(prefix+'_end_seconds'in data)data[prefix+'_end_seconds']=40;if(prefix+'_rate'in data)data[prefix+'_rate']=1;}
  }
  return {id:'local-recovery-'+id,title:'Recette locale sans sauvegarde',template_id:id,template_version:t.version,library_version:t.libraryVersion,status:'draft',revision:1,data,created_by:'recette@example.test',updated_by:'recette@example.test',created_at:'2026-09-25',updated_at:'2026-09-25',archived:0};
}
function App(){
  const [id,setId]=useState(new URLSearchParams(location.search).get('template')||'BTV_PopUp'),[evidence,setEvidence]=useState('');
  const current=project(id),graphic=()=>document.querySelector('.graphic-host')?.firstElementChild as any;
  const inspect=async()=>{await graphic()?.__previewTransport?.seek(8);setEvidence('Image de contrôle : 8 s');};
  const fail=async()=>{const g=graphic();try{await g.updateAction({...engineData(current.data,true),[id==='BTV_BA_1P'?'_titre_ligne_1':'_title']:''});setEvidence('Erreur attendue absente');}catch(error){setEvidence('Erreur moteur réelle injectée : '+String(error));}};
  const measure=()=>{const g=graphic();setEvidence(JSON.stringify({template:id,phase:g?.__previewTransport?.snapshot(),engineTitle:g?.data?._titre_ligne_1??g?.state?.data?._title??g?.media?.data?._title,holds:document.querySelectorAll('[data-preview-hold]').length,alerts:[...document.querySelectorAll('[role=alert]')].map(n=>n.textContent),titleInputs:[...document.querySelectorAll('textarea')].map(n=>({label:n.labels?.[0]?.textContent,value:n.value})),savedRevision:document.querySelector('.workspace-metadata')?.textContent},null,2));};
  return <main style={{padding:20,maxWidth:1600,margin:'auto'}}><h1>Recette locale · récupération après saisie invalide</h1><p>Aucun compte, aucune sauvegarde, aucune API simulée. N’utilisez pas Enregistrer.</p><div className="row"><label>Modèle<select value={id} onChange={e=>{setId(e.target.value);setEvidence('');}}><option value="BTV_PopUp">Pop-up</option><option value="BTV_BA_1P">Bande-annonce</option></select></label><button onClick={()=>void inspect()}>Afficher à 8 secondes</button><button onClick={()=>void fail()}>Injecter une erreur moteur</button><button onClick={measure}>Mesurer la récupération</button></div><pre aria-label="Preuve de récupération" style={{maxHeight:260,overflow:'auto',whiteSpace:'pre-wrap'}}>{evidence}</pre><Workspace key={id} project={current} member={{email:'recette@example.test',name:'Recette',role:'designer',active:1}} media={[]} onBack={()=>setEvidence('Retour projets accessible')} onChanged={()=>setEvidence('Écriture inattendue')}/></main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
