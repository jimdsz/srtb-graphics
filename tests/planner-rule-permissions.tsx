// Isolated UI evidence: synthetic image, in-memory handles and API doubles.
// No actual accounts, filesystem picker, backend persistence or remote media.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import PlannerRecipes from '../src/studio/PlannerRecipes';
import PlannerMediaDialog from '../src/studio/PlannerMediaDialog';
import PlannerBatchMedia from '../src/studio/PlannerBatchMedia';
import PlannerTeamMedia from '../src/studio/PlannerTeamMedia';
import {api} from '../src/studio/api';
import {plannerAPI} from '../src/studio/day-planner-api';
import {rememberFolder} from '../src/studio/day-planner-folders';
import type {DirectoryHandle} from '../src/studio/day-planner-folders';
import {programmeIdentity,normalized} from '../src/studio/day-planner-model';
import type {DirectoryIndex,Plan,PlannerDocument,PlannerRecord,PlannerRow,PlannerSummary,ProgrammeRule} from '../src/studio/day-planner-model';
import {canApprove} from '../src/studio/domain';
import type {Member,Role} from '../src/studio/domain';
import type {LocalDescriptor} from '../src/studio/local-media';
import '../src/studio/studio.css';
import '../src/studio/theme.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';
import '../src/studio/day-planner.css';

const query=new URLSearchParams(location.search),role=query.get('role')||'designer',view=query.get('view')||'single';
if(!['admin','broadcaster','designer','missing'].includes(role))throw Error('Rôle de recette inconnu.');
const member:Member={email:'permissions@example.test',name:'Recette permissions',role:role==='missing'?'designer':role as Role,active:1};
const evidence={role,view,writes:[] as PlannerDocument[],bindings:[] as {id:string;media:LocalDescriptor;location:PlannerRow['location']}[],localRecipeChanges:0};
Object.assign(window,{plannerRuleEvidence:evidence});
const row:PlannerRow={id:'one',sheet:'Lundi',cell:'A1',raw:'',title:'Magazine de recette',subtitle:'Épisode 1',category:'Magazine',broadcastDate:'2026-09-07',airDate:'2026-09-07',time:'06:30:00',duration:1800,included:true,kinds:['ba'],formats:['tv'],issues:[],media:null,location:null};
const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lWQAAAAASUVORK5CYII='),value=>value.charCodeAt(0));
const file=new File([png],'Magazine de recette episode 1.png',{type:'image/png',lastModified:100});
const directory:PlannerRecord<DirectoryIndex>={id:'11111111-1111-4111-8111-111111111111',revision:1,archived:false,createdBy:member.email,updatedBy:member.email,updatedAt:'2026-09-29T00:00:00Z',data:{kind:'directory',name:'Dossier de recette',scannedAt:'2026-09-29T00:00:00Z',partial:false,files:[{name:file.name,path:file.name,size:file.size,modified:file.lastModified}]}};
const summary:PlannerSummary={id:directory.id,revision:directory.revision,kind:'directory',name:directory.data.name,updatedAt:directory.updatedAt,archived:false};
const rule:PlannerRecord<ProgrammeRule>={...directory,id:'permission-rule',data:{kind:'rule',name:row.title,programme:programmeIdentity(row),family:normalized(row.title),keywords:row.title,directoryId:directory.id,preferredPath:file.name,kinds:['tds']}};
const handle={kind:'directory',name:directory.data.name,queryPermission:async()=> 'granted',requestPermission:async()=> 'granted',getFileHandle:async()=>({kind:'file',name:file.name,getFile:async()=>file})} as unknown as DirectoryHandle;
await rememberFolder(member.email,directory.id,handle,false);
api.media=async()=>[];
plannerAPI.list=async kind=>({documents:kind==='directory'?[summary]:[],next:null});
plannerAPI.rules=async()=>({rules:[rule]});
plannerAPI.get=async<T extends PlannerDocument>()=>structuredClone(directory) as unknown as PlannerRecord<T>;
plannerAPI.save=async<T extends PlannerDocument>(id:string,revision:number,data:T)=>{
  evidence.writes.push(structuredClone(data));
  if(data.kind==='rule'&&!canApprove(member.role))throw Error('Cette règle partagée est réservée à la diffusion ou à l’administration.');
  return {...directory,id,revision:revision+1,data} as PlannerRecord<T>;
};

function Fixture(){
  const [plan,setPlan]=useState<Plan>({kind:'plan',name:'Permissions',source:'fixture.xlsx',sourceHash:'a'.repeat(64),rows:[row]});
  const [open,setOpen]=useState(true);
  function bind(id:string,media:LocalDescriptor,location:PlannerRow['location']){evidence.bindings.push({id,media,location});setPlan(previous=>({...previous,rows:previous.rows.map(item=>item.id===id?{...item,media,location}:item)}));}
  return <main style={{padding:20}}><h1>Recette locale — permissions des règles</h1><p>{role} · {view} · aucune donnée réelle</p>
    {view==='recipes'?<PlannerRecipes plan={plan} rows={plan.rows} member={role==='missing'?undefined:member} onChange={next=>{evidence.localRecipeChanges++;setPlan(next);}}/>:null}
    {view==='single'&&open?<PlannerMediaDialog row={plan.rows[0]} member={member} onClose={()=>setOpen(false)} onSelect={(media,location)=>{bind(row.id,media,location);setOpen(false);}}/>:null}
    {view==='batch'&&open?<PlannerBatchMedia rows={plan.rows} member={member} onApply={bind} onClose={()=>setOpen(false)}/>:null}
    {view==='team'&&open?<PlannerTeamMedia rows={plan.rows} member={member} directories={[summary]} rules={[rule]} onApply={bind} onLearn={()=>{}} onClose={()=>setOpen(false)} onBack={()=>setOpen(false)}/>:null}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
