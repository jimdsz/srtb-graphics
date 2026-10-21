// Real guided editor, synthetic plans and memory-only API transports. No live
// account, disk permission, shared server write, media decoding or generation.
import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import PlannerRecipeEditor from '../src/studio/PlannerRecipeEditor';
import PlannerHabits from '../src/studio/PlannerHabits';
import {plannerAPI} from '../src/studio/day-planner-api';
import {api,ApiError} from '../src/studio/api';
import {selectChannel} from '../src/studio/channel-context';
import {normalized,programmeIdentity} from '../src/studio/day-planner-model';
import type {DirectoryIndex,Plan,PlannerDocument,PlannerRecord,PlannerRow,ProgrammeRule} from '../src/studio/day-planner-model';
import type {Member,Role} from '../src/studio/domain';
import type {RecipeHabitObservation} from '../src/studio/planner-recipe-editor-model';
import type {RecipeChange} from '../src/studio/planner-recipes';
import '../src/studio/studio.css';
import '../src/studio/theme.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';
import '../src/studio/day-planner.css';

const params=new URLSearchParams(location.search),mode=params.get('mode')||'new',role=params.get('role')||'designer';
if(!['designer','admin','broadcaster'].includes(role))throw Error('Rôle de recette non reconnu.');
const member:Member={email:'recipe-editor@example.test',name:'Recette éditeur',role:role as Role,active:1};
const id=(number:number)=>`88888888-8888-4888-8888-${String(number).padStart(12,'0')}`;
const stamp='2026-09-29T12:00:00Z',media=`local-media:${'b'.repeat(64)}:1234`;
const rows:PlannerRow[]=Array.from({length:3},(_,index)=>({
 id:`occurrence:${index+1}/épisode`,sheet:'Conducteur',cell:`B${index+3}`,raw:`Cellule source ${index+1}`,title:index<2?'Magazine de recette':'Autre émission',subtitle:`Épisode ${31+index}`,category:'Catégorie conservée',
 broadcastDate:'2026-09-29',airDate:'2026-09-30',time:`00:${30+index}:00`,duration:1800,included:true,kinds:['ba','popup'],formats:['tv','portrait','vertical'],issues:['Point à vérifier conservé.'],
 media:{url:media,name:'episode-31.mp4',mimeType:'video/mp4'},location:{directoryId:id(50),path:`Épisodes/episode-${31+index}.mp4`,size:1234,modified:100},
 logo:{url:`/api/graphics/media/${id(60)}/content`,name:'logo.png',mimeType:'image/png'},excerpt:{source:media,start:4,end:14,duration:45},
 voices:{ba:{source:{url:`local-media:${'c'.repeat(64)}:321`,name:'voix.mp3',mimeType:'audio/mpeg'},sourceDuration:20,start:1,end:4,cue:'Annonce relue',confirmed:true,placement:{mode:'ba-auto'}}},programmeId:id(70),programmeRevision:3,
}));
const initial:Plan={kind:'plan',name:'Préparation conservée',source:'conducteur-fictif.xlsx',sourceHash:'a'.repeat(64),rows,sourceRows:structuredClone(rows),weekly:{startDate:'2026-09-29',rowIds:[rows[0].id,rows[1].id],formats:['portrait','tv']}};
const directory:PlannerRecord<DirectoryIndex>={id:id(50),revision:2,createdBy:member.email,updatedBy:member.email,updatedAt:stamp,archived:false,data:{kind:'directory',name:'Dossier partagé relu',files:[],scannedAt:stamp,partial:false}};
const rule=(number:number,row:PlannerRow,reuse=false):PlannerRecord<ProgrammeRule>=>({id:id(number),revision:4,archived:false,createdBy:member.email,updatedBy:member.email,updatedAt:stamp,data:{kind:'rule',name:row.title,programme:programmeIdentity(row),keywords:'Recherche relue',directoryId:directory.id,preferredPath:'Épisodes/ancien-episode.mp4',kinds:['tds','renvoi'],...(reuse?{family:normalized(row.title)}:{})}});
const records=new Map<string,PlannerRecord<ProgrammeRule>>();
if(['exact','exact-family','exact-and-family','ambiguous','empty'].includes(mode)){const known=rule(1,rows[0],mode==='exact-family');if(mode==='empty')known.data.kinds=[];records.set(known.id,known);if(mode==='ambiguous')records.set(id(2),{...structuredClone(known),id:id(2)});}
if(mode==='family'||mode==='multiple-family'){const known=rule(1,{...rows[0],subtitle:'Épisode précédent'},true);records.set(known.id,known);if(mode==='multiple-family')records.set(id(2),rule(2,{...rows[0],subtitle:'Autre épisode précédent'},true));}
if(mode==='exact-and-family'){const family=rule(2,{...rows[0],subtitle:'Épisode précédent'},true);family.data.kinds=['ba'];records.set(family.id,family);}
const observation:RecipeHabitObservation={programme:normalized(rows[0].title),candidate:{name:rows[0].title,kinds:['event'],directoryId:directory.id},confirmations:3,revision:null,ruleId:null,state:null};
if(params.get('observation')?.startsWith('linked-')){observation.ruleId=id(1);observation.revision=2;observation.ruleRevision=params.get('observation')==='linked-current'?4:3;observation.state=params.get('observation')==='linked-pending'?null:'approved';}
const evidence={initial:structuredClone(initial),observation:structuredClone(observation),changes:[] as Plan[],applications:[] as (RecipeChange|null)[],reads:[] as {kind:string;id:string;aborted:boolean;settled:boolean}[],attempts:[] as {id:string;revision:number;data:PlannerDocument}[],writes:[] as {id:string;revision:number;data:PlannerDocument}[],closed:0,mediaReads:0,generated:0};
let failRead=Number(params.get('readError')||0),failWrite:''|'lost'|'conflict'|'network'='',held=new Set<string>(params.has('hold')?[params.get('hold')!]:[]),gates=new Map<string,(()=>void)[]>();
async function gate<T>(kind:string,key:string,value:T,signal?:AbortSignal){
 const entry={kind,id:key,aborted:!!signal?.aborted,settled:false};evidence.reads.push(entry);signal?.addEventListener('abort',()=>{entry.aborted=true;},{once:true});const snapshot=structuredClone(value),failure=failRead;
 if(held.has(kind))await new Promise<void>(resolve=>{gates.set(kind,[...(gates.get(kind)||[]),resolve]);});entry.settled=true;
 if(failure)throw new ApiError('Lecture des recettes indisponible dans la recette locale.',failure);
 // Deliberately ignore cancellation: a late reply must not replace new choices.
 return snapshot;
}
plannerAPI.rules=async(programmes,signal,families=[])=>gate('rules',programmes.join('|'),{rules:[...records.values()].filter(record=>programmes.includes(record.data.programme)||!!record.data.family&&families.includes(record.data.family))},signal);
plannerAPI.get=async<T extends PlannerDocument>(recordId:string,signal?:AbortSignal)=>{
 const record=recordId===directory.id?directory:records.get(recordId);if(!record)throw new ApiError('Document absent de la recette.',404);return gate('get',recordId,record,signal) as unknown as Promise<PlannerRecord<T>>;
};
plannerAPI.save=async<T extends PlannerDocument>(recordId:string,revision:number,data:T,signal?:AbortSignal)=>{
 evidence.attempts.push(structuredClone({id:recordId,revision,data}));
 if(held.has('save'))await new Promise<void>(resolve=>{gates.set('save',[...(gates.get('save')||[]),resolve]);});
 if(failWrite==='conflict')throw new ApiError('La recette a changé sur le serveur simulé.',409);
 if(failWrite==='network')throw new ApiError('Réponse de mémorisation non reçue.',503);
 const previous=records.get(recordId);if((previous?.revision||0)!==revision)throw new ApiError('Révision de recette périmée.',409);
 const saved={id:recordId,revision:revision+1,archived:false,data:structuredClone(data),createdBy:member.email,updatedBy:member.email,updatedAt:stamp} as PlannerRecord<T>;
 if(data.kind==='rule')records.set(recordId,saved as PlannerRecord<ProgrammeRule>);evidence.writes.push(structuredClone({id:recordId,revision:saved.revision,data}));
 if(failWrite==='lost')throw new TypeError('Réponse de mémorisation perdue après écriture simulée.');
 return saved;
};
plannerAPI.list=async()=>({documents:[],next:null});
plannerAPI.create=async()=>{evidence.generated++;throw Error('Génération interdite dans cette recette.');};
api.media=async()=>{evidence.mediaReads++;return [];};
const control={
 hold:(kind:string)=>{held.add(kind);},release:(kind:string)=>{held.delete(kind);const pending=gates.get(kind)||[];gates.delete(kind);for(const resolve of pending)resolve();},
 readFailure:(status:number)=>{failRead=status;},writeFailure:(mode:typeof failWrite)=>{failWrite=mode;},
 revise:()=>{const record=records.get(id(1));if(record){record.revision++;record.data.kinds=['event'];}},
 archive:()=>{const record=records.get(id(1));if(record)record.archived=true;},
 channel:()=>selectChannel('recette-autre-chaine'),
 patch:(_index:number,_patch:Partial<PlannerRow>):void=>{throw Error('Fixture non montée');},
 context:():void=>{throw Error('Fixture non montée');},
 mount:(_value:boolean):void=>{throw Error('Fixture non montée');},
 current:():Plan=>structuredClone(initial),
 saved:()=>structuredClone([...records.values()]),
};
Object.assign(window,{recipeEditorEvidence:evidence,recipeEditorControl:control});
function Fixture(){
 const [plan,setPlan]=useState<Plan>(()=>structuredClone(initial)),[open,setOpen]=useState(!params.has('habits')),[mounted,setMounted]=useState(true),[adapted,setAdapted]=useState<RecipeHabitObservation|undefined>(params.has('observation')?observation:undefined);
 useEffect(()=>{control.patch=(index,patch)=>setPlan(current=>({...current,rows:current.rows.map((row,i)=>i===index?{...row,...patch}:row)}));control.context=()=>setPlan(current=>({...current,sourceHash:'d'.repeat(64),name:'Autre préparation'}));control.mount=setMounted;},[]);
 useEffect(()=>{control.current=()=>structuredClone(plan);},[plan]);
 return <main style={{padding:20,maxWidth:1366,margin:'auto'}}><h1>Recette de l’éditeur guidé</h1><p>{role} · API simulée · aucune donnée réelle</p><section className="day-planner">{mounted?<>{params.has('habits')?<PlannerHabits record={{id:id(90),revision:7,archived:false,createdBy:member.email,updatedBy:member.email,updatedAt:stamp,data:plan}} plan={plan} member={member} onAdapt={item=>{setAdapted(item);setOpen(true);}}/>:null}{open?<PlannerRecipeEditor plan={plan} rows={plan.rows} initialRowId={rows[0].id} member={member} observation={adapted} onChange={next=>{evidence.changes.push(structuredClone(next));setPlan(next);}} onApplied={change=>{evidence.applications.push(structuredClone(change));}} onClose={()=>{evidence.closed++;setOpen(false);}}/>:<p>Éditeur fermé pour la recette.</p>}</>:<p>Composants démontés pour la recette.</p>}</section></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
