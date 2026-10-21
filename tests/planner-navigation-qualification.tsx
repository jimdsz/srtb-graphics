// Real planner UI; synthetic read-only transport. No production account or files.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import DayPlanner from '../src/studio/DayPlanner';
import {plannerAPI} from '../src/studio/day-planner-api';
import {api} from '../src/studio/api';
import type {Project} from '../src/studio/domain';
import type {Plan,PlannerDocument,PlannerRecord,PlannerSummary} from '../src/studio/day-planner-model';
import '../src/studio/studio.css';
import '../src/studio/theme.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';
const member={email:'recette@example.test',name:'Recette',role:'designer' as const,active:1};
const record:PlannerRecord<Plan>={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',revision:3,archived:false,createdBy:member.email,updatedBy:member.email,updatedAt:'2026-09-25T00:00:00Z',data:{kind:'plan',name:'Préparation témoin',source:'recette.xlsx',sourceHash:'a'.repeat(64),rows:[{id:'one',sheet:'Lundi',cell:'A1',raw:'',title:'Programme témoin',subtitle:'',category:'Magazine',broadcastDate:'2026-09-07',airDate:'2026-09-07',time:'20:30:00',duration:1000,included:true,kinds:['ba'],formats:['tv'],issues:[],media:null,location:null}]}};
const project:Project={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',title:'BA témoin',template_id:'BTV_BA_1P',template_version:'1.0.0',library_version:'v1.7.0',status:'draft',revision:1,data:{},created_by:member.email,updated_by:member.email,created_at:'',updated_at:'',archived:0};
let held=false,listReads=0,aborts=0,writes=0,releases:Array<()=>void>=[],allowSave=false;
const initialHeld=new URLSearchParams(location.search).has('initialHeld');
async function gate(signal?:AbortSignal,hold=held){if(!hold)return;signal?.addEventListener('abort',()=>aborts++,{once:true});await new Promise<void>(resolve=>releases.push(resolve));}
plannerAPI.list=async(kind,offset=0,_programme,signal)=>{
 const sequence=++listReads;await gate(signal,held||initialHeld&&sequence===1);
 const documents:PlannerSummary[]=kind==='plan'?[{id:offset?'cccccccc-cccc-4ccc-8ccc-cccccccccccc':record.id,kind:'plan',revision:3,name:offset?'Deuxième page':sequence===1?'Ancienne réponse initiale':`Liste actualisée ${sequence}`,updatedAt:record.updatedAt,archived:false}]:[];
 return {documents,next:offset?null:50};
};
plannerAPI.get=async<T extends PlannerDocument>(_id:string,signal?:AbortSignal)=>{await gate(signal);return structuredClone(record) as unknown as PlannerRecord<T>;};
plannerAPI.tasks=async(_id,signal)=>{await gate(signal);return {tasks:[{key:'ba:tv:one',projectId:project.id,title:project.title,status:'draft',archived:false,sourceRevision:3}]};};
plannerAPI.rules=async()=>({rules:[]});
plannerAPI.save=async<T extends PlannerDocument>(_id:string,revision:number,data:T)=>{
 if(!allowSave)throw Error('Enregistrement fictif refusé');writes++;
 return {...record,revision:revision+1,data:structuredClone(data)} as PlannerRecord<T>;
};
api.project=async(_id,signal)=>{await gate(signal);return structuredClone(project);};
function Fixture(){const [hold,setHold]=useState(false),[message,setMessage]=useState(''),[opened,setOpened]=useState(0);return <main style={{padding:16,maxWidth:1200,margin:'auto'}}>
 <h1>Lectures À faire · recette locale</h1><p>Aucune écriture serveur ni transmission de fichiers.</p>
 <label className="check"><input type="checkbox" checked={hold} onChange={e=>{held=e.target.checked;setHold(held);}}/>Bloquer les prochaines lectures</label>
 <label className="check"><input type="checkbox" onChange={e=>{allowSave=e.target.checked;}}/>Autoriser l’enregistrement fictif</label>
 <button onClick={()=>{for(const release of releases)release();releases=[];setMessage(`${aborts} lectures annulées · ${writes} écritures · ${listReads} listes demandées`);}}>Libérer les réponses tardives</button>
 <output style={{display:'block'}}>{message} · {opened} projets ouverts</output>
 <DayPlanner member={member} onOpenProject={()=>setOpened(n=>n+1)}/>
 </main>;}
const root=createRoot(document.getElementById('root')!);root.render(<Fixture/>);
import.meta.hot?.dispose(()=>root.unmount());
