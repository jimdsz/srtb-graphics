import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import Preview from '../src/studio/Preview';
import {getTemplate,templateDefaults} from '../src/studio/domain';
import type {ProjectData} from '../src/studio/domain';
import '../src/studio/studio.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';

// A real Preview and native engine, without a member, project or write API.
const params=new URLSearchParams(location.search),template=getTemplate(params.get('template')||'BTV_BA_TDS');
const initial:ProjectData={...templateDefaults(template),_studio_format:params.get('format')||'tv',_out_mode:'duration',_out_duration_seconds:30};
for(const key of Object.keys(initial)){
  if(/_audio.*enabled$/.test(key))initial[key]=false;
  if(/^_media_.+_sequence$/.test(key))initial[key]='[]';
  if(/^_media_.+_url$/.test(key)&&initial[key])initial[key]='/library/v1.7.0/BTV_Ce_Soir/lib/media/programme.jpg';
}
function App(){
  const [data,setData]=useState(initial);
  return <main style={{maxWidth:1000,margin:'auto',padding:16}}><h1>Continuité Tout de suite · recette locale</h1><p>Aucun projet et aucune sauvegarde.</p><button onClick={()=>setData(value=>({...value,_out_duration_seconds:Number(value._out_duration_seconds)+1}))}>Modifier la durée pour reconstruire</button><Preview template={template} data={data} onChange={setData}/></main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
