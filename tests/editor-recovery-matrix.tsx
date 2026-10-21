// Local qualification of the real Preview component. No API, account, save,
// media upload or export. Changes are ordinary React props, not engine mocks.
import React,{useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import Preview from '../src/studio/Preview';
import {broadcastTemplates,templateDefaults} from '../src/studio/domain';
import type {BroadcastTemplate,ProjectData} from '../src/studio/domain';
import {textFields} from '../src/studio/typography-model';
import {draftTextIssue} from '../src/studio/draft-recovery';
import '../src/studio/studio.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';

const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(test:()=>boolean,label:()=>string){const end=performance.now()+65000;while(!test()){if(performance.now()>end)throw Error(label());await delay(80);}}
function example(template:BroadcastTemplate,format:string){
  const data=templateDefaults(template);data._studio_format=format;
  for(const key of Object.keys(data)){
    if(/_audio.*enabled$/.test(key))data[key]=false;
    if(/^_media_.+_sequence$/.test(key))data[key]='[]';
    if(/^_media_.+_url$/.test(key)&&data[key]){
      data[key]='/library/v1.7.0/BTV_Ce_Soir/lib/media/programme.jpg';
      const prefix=key.slice(0,-4);
      if(prefix+'_start_seconds'in data)data[prefix+'_start_seconds']=0;
      if(prefix+'_end_seconds'in data)data[prefix+'_end_seconds']=40;
      if(prefix+'_rate'in data)data[prefix+'_rate']=1;
    }
  }
  return data;
}
interface Result {template:string;format:string;fields:number;empty?:string;restored?:boolean;holds?:number;error?:string}
function App(){
  const [active,setActive]=useState<{template:BroadcastTemplate;data:ProjectData;key:string}>(),[running,setRunning]=useState(false),[stage,setStage]=useState('Prêt'),[results,setResults]=useState<Result[]>([]);
  const ready=useRef(false),cancel=useRef(false);
  const sync=()=>document.querySelector('.monitor-sync')?.textContent?.trim()||'';
  async function run(){
    setRunning(true);setResults([]);cancel.current=false;const collected:Result[]=[];
    const query=new URLSearchParams(location.search);
    const formats=query.has('format')?[query.get('format')!]:['tv','portrait','vertical'];
    const templates=query.has('template')?broadcastTemplates.filter(t=>t.id===query.get('template')):broadcastTemplates;
    try{for(const format of formats)for(const template of templates){
      if(cancel.current)return;
      const data=example(template,format),fields=textFields(template).map(([key])=>key),result:Result={template:template.id,format,fields:fields.length};
      try{
        setStage(`${template.name} · ${format} · ouverture`);ready.current=false;
        flushSync(()=>setActive({template,data,key:template.id+format}));
        await until(()=>ready.current,()=>`Ouverture non prête : ${sync()} · ${document.querySelector('[role="alert"]')?.textContent||document.querySelector('.preview-loading')?.textContent}`);
        const graphic=document.querySelector('.graphic-host')?.firstElementChild as any;
        await graphic.__previewTransport.seek(8);
        const blank={...data,...Object.fromEntries(fields.map(key=>[key,'']))};
        setStage(`${template.name} · ${format} · suppression des textes`);
        flushSync(()=>setActive(current=>({...current!,data:blank})));
        await delay(800);
        await until(()=>sync()==='Aperçu à jour'||sync()==='Saisie en cours · dernier aperçu conservé'||sync()==='Dernier aperçu conservé',()=> 'Suppression ne se stabilise pas : '+sync());
        result.empty=sync();
        if(draftTextIssue(template,blank)&&result.empty!=='Saisie en cours · dernier aperçu conservé')throw Error('Titre requis non protégé');
        const clear=document.querySelector<HTMLButtonElement>('[aria-label="Effacer l’aperçu"]');
        if(!clear||clear.disabled)throw Error('Effacer bloqué après suppression');
        setStage(`${template.name} · ${format} · restitution`);
        ready.current=false;
        flushSync(()=>setActive(current=>({...current!,data:{...data}})));
        // Let the 180 ms live-edit debounce start; a readiness value from the
        // preceding empty scene must not count as a restored preview.
        await delay(350);
        await until(()=>ready.current&&sync()==='Aperçu à jour',()=> 'La restitution ne rétablit pas l’aperçu : '+sync());
        result.restored=true;result.holds=document.querySelectorAll('[data-preview-hold]').length;
        if(result.holds)throw Error('Copie figée conservée après restitution');
        if(document.querySelector('[role="alert"]'))throw Error('Erreur persistante après restitution');
      }catch(error){result.error=String(error);}
      collected.push(result);setResults([...collected]);
    }}finally{setRunning(false);setStage(cancel.current?'Interrompu':`Terminé : ${collected.filter(r=>!r.error).length}/${collected.length}`);}
  }
  return <main style={{maxWidth:1100,margin:'auto',padding:24}}><h1>Suppression puis restitution des textes</h1><p>Vrai aperçu, 10 moteurs × 3 formats. Aucune sauvegarde, aucun projet utilisateur modifié.</p><button disabled={running} onClick={()=>void run()}>Vérifier tous les modèles</button>{running?<button onClick={()=>{cancel.current=true;}}>Arrêter après ce modèle</button>:null}<p role="status">{stage}</p><pre aria-label="Résultats de récupération" style={{maxHeight:320,overflow:'auto',whiteSpace:'pre-wrap'}}>{JSON.stringify(results,null,2)}</pre>{active?<Preview key={active.key} template={active.template} data={active.data} onReadinessChange={value=>{ready.current=value;}} onChange={data=>setActive(current=>({...current!,data}))}/>:null}</main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
