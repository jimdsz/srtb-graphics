// Real UI/worker/API/D1. Only the browser folder-picker capability is forced to
// the compatible branch. The index describes the shipped public demonstration.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import PlannerTeamMedia from '../src/studio/PlannerTeamMedia';
import {plannerAPI} from '../src/studio/day-planner-api';
import {api} from '../src/studio/api';
import {normalized,patchPlannerRow} from '../src/studio/day-planner-model';
import type {DirectoryIndex,Plan,PlannerRecord,PlannerRow,PlannerSummary,ProgrammeRule} from '../src/studio/day-planner-model';
import '../src/studio/studio.css';
import '../src/studio/theme.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';
import '../src/studio/day-planner.css';
if(location.origin!=='http://127.0.0.1:5192')throw Error('Loopback qualification only');
Object.defineProperty(window,'showDirectoryPicker',{configurable:true,value:undefined});
const member={email:'admin@example.com',name:'Qualification locale',role:'admin' as const,active:1};
function App(){
 const [rows,setRows]=useState<PlannerRow[]>([]),[directories,setDirectories]=useState<PlannerSummary[]>([]),[rules,setRules]=useState<PlannerRecord<ProgrammeRule>[]>([]),[plan,setPlan]=useState<PlannerRecord<Plan>>(),[open,setOpen]=useState(false),[status,setStatus]=useState('Préparer les références de recette.'),[busy,setBusy]=useState(false),[report,setReport]=useState('');
 async function run(fn:()=>Promise<void>){setBusy(true);try{await fn();}catch(error){setStatus(String(error));}finally{setBusy(false);}}
 async function setup(){
  const title=`RECETTE ACCÈS ${Date.now()}`;
  const next:PlannerRow[]=[9,10].map(hour=>({id:'row-'+hour,title,subtitle:'',sheet:'Lundi',cell:'B'+hour,raw:title,category:'Magazine',broadcastDate:'2026-09-07',airDate:'2026-09-07',time:`${hour.toString().padStart(2,'0')}:00:00`,duration:1800,included:true,kinds:['ba','popup'],formats:['tv'],issues:[],media:null,location:null}));
  const directory=await plannerAPI.save<DirectoryIndex>(crypto.randomUUID(),0,{kind:'directory',name:'Recette — média public',files:[{name:'ba-programme.mp4',path:'ba-programme.mp4',size:12037476,modified:1790092346335}],partial:false,scannedAt:new Date().toISOString()});
  const rule=await plannerAPI.save<ProgrammeRule>(crypto.randomUUID(),0,{kind:'rule',name:title,programme:normalized(title),keywords:title,directoryId:directory.id,preferredPath:'ba-programme.mp4',kinds:['ba','popup']});
  const stored=await plannerAPI.save<Plan>(crypto.randomUUID(),0,{kind:'plan',name:title,source:'Recette métadonnées locales',sourceHash:'a'.repeat(64),rows:next});
  setRows(next);setPlan(stored);setDirectories([{id:directory.id,revision:directory.revision,name:directory.data.name,kind:'directory',archived:false,updatedAt:directory.updatedAt}]);setRules([rule]);setStatus('Deux programmes, un index partagé localement. Aucun accès au dossier accordé dans cette page.');
 }
 async function create(){
  if(!plan||rows.some(row=>!row.media))throw Error('Relier les deux médias après vérification.');
  const before=await api.media(),stored=await plannerAPI.save(plan.id,plan.revision,{...plan.data,rows});setPlan(stored);
  const tasks=rows.flatMap(row=>row.kinds.map(kind=>({rowIds:[row.id],kind,format:'tv' as const,signature:false})));
  const first=await plannerAPI.create(stored.id,stored.revision,tasks),again=await plannerAPI.create(stored.id,stored.revision,tasks);
  if(first.tasks.length!==4||JSON.stringify(first.tasks.map(t=>t.projectId))!==JSON.stringify(again.tasks.map(t=>t.projectId)))throw Error('Doublon ou projet absent.');
  const projects=await Promise.all(first.tasks.map(task=>api.project(task.projectId)));
  if(projects.some(p=>p.visibility!=='private'||p.revision!==1)||JSON.stringify(before)!==JSON.stringify(await api.media()))throw Error('Propriété ou catalogue média modifié.');
  setReport(JSON.stringify({status:'PASS',scope:'Reconnexion UI réelle → API locale/D1 → quatre projets privés et reprise sans doublon. Pas une preuve de deux comptes authentifiés distincts.',planId:stored.id,rows:rows.map(r=>({id:r.id,title:r.title,time:r.time,media:r.media,location:r.location})),projects:projects.map(p=>({id:p.id,title:p.title,revision:p.revision,visibility:p.visibility,data:p.data})),mediaUploads:0},null,2));setStatus('PASS — 4 projets privés relus, reprise sans doublon, aucun média ajouté au serveur.');
 }
 return <main style={{padding:20}}><h1>Recette locale — reprise d’un dossier partagé</h1><p>Composants et API réels. Choisir seulement public/preview-media/v1. Aucun fichier envoyé. Le titre de test ne décrit pas le contenu de la vidéo.</p><fieldset disabled={busy}><button disabled={!!plan} onClick={()=>void run(setup)}>Préparer les références locales</button><button disabled={!plan} onClick={()=>setOpen(true)}>Ouvrir la recherche d’équipe</button><button disabled={!rows.length||rows.some(r=>!r.media)} onClick={()=>void run(create)}>Créer puis relire les quatre projets locaux</button></fieldset><p role="status">{status}</p>{open?<PlannerTeamMedia member={member} rows={rows} directories={directories} rules={rules} onApply={(id,media,location)=>setRows(prev=>prev.map(r=>r.id===id?patchPlannerRow(r,{media,location}):r))} onLearn={rule=>setRules(prev=>[...prev.filter(r=>r.id!==rule.id),rule])} onBack={()=>setOpen(false)} onClose={()=>setOpen(false)}/>:null}<pre aria-label="Liaisons obtenues" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(rows,null,2)}</pre><pre aria-label="Preuve de création" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{report}</pre></main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
