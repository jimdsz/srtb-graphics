// Real UI, real API, ephemeral D1 on a dedicated loopback-only server.
// No API replacements, production session, user files or uploads.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import DayPlanner from '../src/studio/DayPlanner';
import {api} from '../src/studio/api';
import {plannerAPI} from '../src/studio/day-planner-api';
import type {Plan,PlannerRow,PlannerTaskChoice} from '../src/studio/day-planner-model';
import type {Member} from '../src/studio/domain';
import '../src/studio/studio.css';
import '../src/studio/theme.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';
if(location.origin!=='http://127.0.0.1:5199')throw Error('Isolated loopback fixture only');
// Optional one-shot transport fault, armed only after the real original records
// exist. Remaining calls still use the real local API.
const interrupted=new URLSearchParams(location.search).has('interruptOnce');
const id=crypto.randomUUID(),originals=new Map<string,string>();
async function seed(){
 const member=await api.me();
 const rows:PlannerRow[]=Array.from({length:7},(_,i)=>({id:String(i),sheet:'RECETTE',cell:`A${i+1}`,raw:'',title:`Programme ${i+1}`,subtitle:'',category:'Magazine',broadcastDate:`2026-09-${7+i<10?'0':''}${7+i}`,airDate:`2026-09-${7+i<10?'0':''}${7+i}`,time:'20:30:00',duration:1800,included:true,kinds:['ba','popup'],formats:['tv'],issues:[],media:null,location:null}));
 const plan:Plan={kind:'plan',name:interrupted?'Reprise versions · contrôle local':'Versions · contrôle local',source:'synthetique.xlsx',sourceHash:'a'.repeat(64),rows,weekly:{rowIds:rows.map(r=>r.id),formats:['tv'],startDate:'2026-09-07'}};
 const saved=await plannerAPI.save(id,0,plan);
 const choices:PlannerTaskChoice[]=[{kind:'ba',rowIds:['0'],format:'tv',signature:false},{kind:'popup',rowIds:['0'],format:'tv',signature:false},{kind:'weekly',rowIds:rows.map(r=>r.id),format:'tv',signature:false}];
 const created=await plannerAPI.create(id,saved.revision,choices);
 for(const task of created.tasks){const project=await api.project(task.projectId);const edited=await api.save(project,`${project.title} · RETOUCHE CONSERVÉE`,project.data);originals.set(edited.id,JSON.stringify(edited));}
 rows[0]={...rows[0],title:'Programme actualisé',time:'21:15:00'};
 await plannerAPI.save(id,saved.revision,{...plan,rows});
 if(interrupted){const create=plannerAPI.create;let once=true;plannerAPI.create=async(...args)=>{if(once){once=false;throw Error('Recette : connexion interrompue avant écriture');}return create(...args);};}
 return member;
}
async function audit(){
 const ledger=await plannerAPI.tasks(id),projects=[];
 for(const task of ledger.tasks){const project=await api.project(task.projectId);projects.push({key:task.key,sourceRevision:task.sourceRevision,title:project.title,visibility:project.visibility,originalUnchanged:originals.has(project.id)?originals.get(project.id)===JSON.stringify(project):null,data:Object.fromEntries(Object.entries(project.data).filter(([key])=>/title|titre|heure|hour|jour|day|diffusion|programme_1|_audio_.*enabled/.test(key)))});}
 return JSON.stringify({projects:projects.length,originalsIntact:projects.filter(p=>p.originalUnchanged!==null).every(p=>p.originalUnchanged),items:projects},null,2);
}
function Fixture(){const [member,setMember]=useState<Member|null>(null),[proof,setProof]=useState(''),[busy,setBusy]=useState(false);return <main style={{padding:16,maxWidth:1280,margin:'auto'}}><h1>Versions · contrôle local</h1><p>Vraie API et base temporaire. Aucun média téléversé, aucune écriture en production.</p>
 {!member?<button disabled={busy} onClick={async()=>{setBusy(true);try{setMember(await seed());setProof(await audit());}catch(e){setProof(String(e));}finally{setBusy(false);}}}>Préparer la recette locale</button>:<><button onClick={()=>void audit().then(setProof)}>Vérifier les projets enregistrés</button><DayPlanner member={member} onOpenProject={project=>setProof(JSON.stringify(project,null,2))}/></>}
 <pre id="editions-proof" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{proof}</pre></main>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);
