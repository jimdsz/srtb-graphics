// Isolated visual fixture. No persistent data; API calls are intercepted by its test.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import PlannerTeamBoard from '../src/studio/PlannerTeamBoard';
import ProjectApprovalPanel from '../src/studio/ProjectApprovalPanel';
import type {Plan,PlannerRecord} from '../src/studio/day-planner-model';
import type {Member,ProjectStatus} from '../src/studio/domain';
import '../src/studio/studio.css';
import '../src/studio/theme.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';
import '../src/studio/day-planner.css';
import '../src/studio/task-workflow.css';

const params=new URL(location.href).searchParams;
document.documentElement.dataset.theme=params.get('theme')||'dark';
const member:Member={email:'lea@example.test',name:'Léa',role:params.get('role')==='admin'?'admin':'designer',active:1};
const names=['Le journal de 20 heures','Le rendez-vous du soir','Le sport en direct','Questions de société','La grande interview','Les visages du Bénin','Regards sur nos régions','Le rendez-vous culturel'];
const plan:Plan={kind:'plan',name:'Mercredi · Bénin TV',source:'conducteur.xlsx',sourceHash:'a'.repeat(64),rows:names.map((title,index)=>({id:`row-${index+1}`,title,subtitle:'',category:'Magazine',sheet:'Mercredi',cell:`B${index+1}`,raw:title,broadcastDate:'2026-09-30',airDate:'2026-09-30',time:`${String(19+Math.floor(index/2)).padStart(2,'0')}:${index%2?'30':'00'}:00`,duration:1800,included:true,kinds:['ba'],formats:['tv'],issues:[],media:null,location:null}))};
const initial:PlannerRecord<Plan>={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',revision:4,data:plan,createdBy:member.email,updatedBy:member.email,updatedAt:'2026-09-30T10:00:00Z',archived:false};
function Fixture(){
 const [record,setRecord]=useState(initial),[status,setStatus]=useState<ProjectStatus>((params.get('status')||'submitted') as ProjectStatus),[dirty,setDirty]=useState(params.has('dirty')),[ready,setReady]=useState(!params.has('notready')),[missing,setMissing]=useState(params.has('missing')),[audit,setAudit]=useState('');
 return <main className="task-workflow-fixture"><h1>La préparation du jour</h1><PlannerTeamBoard record={record} member={member} hasUnsavedChanges={dirty} onOpenTask={choice=>setAudit(`Préparation ouverte : ${choice.rowIds[0]}`)}/><ProjectApprovalPanel project={{status,revision:3,archived:params.has('archived')?1:0}} member={member} disabled={params.has('archived')} busy={params.has('busy')} dirty={dirty} previewReady={ready} missingLocal={missing} onSubmit={()=>{setStatus('submitted');setAudit('Version soumise');}} onApprove={()=>{setStatus('approved');setAudit('Version validée');}} onReject={()=>{setStatus('rejected');setAudit('Corrections demandées');}} onComments={()=>setAudit('Commentaires ouverts')} onArchive={()=>setAudit('Archive demandée')}/><div className="fixture-controls"><button onClick={()=>setRecord({...initial,id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',data:{...plan,name:'Autre conducteur',rows:plan.rows.slice(0,1)}})}>Changer de préparation</button><button onClick={()=>setDirty(value=>!value)}>Basculer modifications</button><button onClick={()=>{setReady(true);setMissing(false);}}>Rétablir aperçu</button></div><output className="fixture-audit">{audit}</output></main>;
}
createRoot(document.querySelector('#root')!).render(<Fixture/>);
