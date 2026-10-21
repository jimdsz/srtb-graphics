// Real DayPlanner and real origin-scoped IndexedDB. Only server transports and
// explicitly requested storage failures are synthetic. No real account/files.
import {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import DayPlanner from '../src/studio/DayPlanner';
import {api,ApiError} from '../src/studio/api';
import {plannerAPI} from '../src/studio/day-planner-api';
import {activeChannelId,selectChannel} from '../src/studio/channel-context';
import {listPlannerLocalDrafts,makePlannerLocalDraft,plannerDraftScope,writePlannerLocalDraft} from '../src/studio/planner-local-drafts';
import {usePlannerLocalDrafts} from '../src/studio/usePlannerLocalDrafts';
import {taskKey} from '../src/studio/day-planner-model';
import type {Plan,PlannerDocument,PlannerRecord,PlannerTask} from '../src/studio/day-planner-model';
import type {WorkspaceNavigation} from '../src/studio/Workspace';
import '../src/studio/studio.css';
import '../src/studio/theme.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';

const params=new URLSearchParams(location.search);
const member={email:'local-recovery@example.test',name:'Recette reprise locale',role:'designer' as const,active:1};
const id=(number:number)=>`77777777-7777-4777-8777-${String(number).padStart(12,'0')}`;
const stamp='2026-09-29T12:00:00Z';
const sourcePlan:Plan={kind:'plan',name:'Préparation partagée de recette',source:'conducteur-fictif.xlsx',sourceHash:'a'.repeat(64),rows:[{
 id:'source!B3',sheet:'29 septembre 2026',cell:'B3',raw:'Magazine : Programme de recette',title:'Programme de recette',subtitle:'Épisode initial',category:'Magazine',broadcastDate:'2026-09-29',airDate:'2026-09-29',time:'20:30:00',duration:1800,included:true,kinds:['ba'],formats:['tv'],issues:[],
 media:{url:`local-media:${'b'.repeat(64)}:1024`,name:'programme-fictif.mp4',mimeType:'video/mp4'},location:null,
 logo:{url:`local-media:${'c'.repeat(64)}:512`,name:'logo-fictif.png',mimeType:'image/png'},excerpt:{source:`local-media:${'b'.repeat(64)}:1024`,start:2,end:12,duration:30},
}]};
sourcePlan.sourceRows=structuredClone(sourcePlan.rows);
const records=new Map<string,PlannerRecord<Plan>>([[id(1),{id:id(1),revision:4,data:structuredClone(sourcePlan),archived:false,createdBy:member.email,updatedBy:member.email,updatedAt:stamp}]]);
const tasks:PlannerTask[]=[{key:taskKey({rowIds:['source!B3'],kind:'ba',format:'tv'}),projectId:id(90),title:'Projet déjà lié',status:'draft',archived:false,sourceRevision:4}];
const evidence={reads:[] as {kind:string;id:string;aborted:boolean;settled:boolean}[],saveAttempts:[] as {id:string;revision:number;data:PlannerDocument}[],saves:[] as {id:string;revision:number}[],created:0,openedProjects:0,mediaReads:0,programmeReads:0,channelChanges:0,mounts:0};
let serverStatus=Number(params.get('server')||0),held=false,failSave=false,lostSave=false;
let releases:(()=>void)[]=[];
const nativePut=IDBObjectStore.prototype.put,nativeOpen=IDBFactory.prototype.open;
let storageFault:''|'quota'|'blocked'='';
IDBObjectStore.prototype.put=function(value:unknown,key?:IDBValidKey){
 if(storageFault==='quota'&&this.name==='drafts')throw new DOMException('Panne quota injectée pour la recette.','QuotaExceededError');
 return key===undefined?nativePut.call(this,value):nativePut.call(this,value,key);
};
IDBFactory.prototype.open=function(name:string,version?:number){
 if(storageFault==='blocked'&&name==='srtb-planner-drafts'){
  // Explicit fault only: a blocked open has no database/transaction result.
  const request={onblocked:null as ((event:Event)=>unknown)|null};queueMicrotask(()=>request.onblocked?.(new Event('blocked')));return request as IDBOpenDBRequest;
 }
 return version===undefined?nativeOpen.call(this,name):nativeOpen.call(this,name,version);
};
function scope(){return plannerDraftScope(member.email,activeChannelId());}
async function read<T>(kind:string,recordId:string,value:T,signal?:AbortSignal):Promise<T>{
 const entry={kind,id:recordId,aborted:!!signal?.aborted,settled:false};evidence.reads.push(entry);signal?.addEventListener('abort',()=>{entry.aborted=true;},{once:true});
 const snapshot=structuredClone(value),status=serverStatus;
 if(held)await new Promise<void>(resolve=>{releases.push(resolve);});
 entry.settled=true;
 // Intentionally ignore cancellation after the gate: UI must reject late data.
 if(status)throw new ApiError(status===503?'Le serveur de recette est hors réseau.':`Accès de recette refusé (${status}).`,status);
 return snapshot;
}
plannerAPI.list=async kind=>{
 if(serverStatus)throw new ApiError('Les préparations partagées sont indisponibles pour la recette.',serverStatus);
 return {documents:kind==='plan'?[...records.values()].map(record=>({id:record.id,revision:record.revision,kind:'plan' as const,name:record.data.name,updatedAt:stamp,archived:record.archived})):[],next:null};
};
plannerAPI.get=async<T extends PlannerDocument>(recordId:string,signal?:AbortSignal)=>{
 const record=records.get(recordId);if(!record)throw new ApiError('Préparation absente de la recette.',404);
 return read('get',recordId,record,signal) as unknown as Promise<PlannerRecord<T>>;
};
plannerAPI.tasks=async(recordId,signal)=>read('tasks',recordId,{tasks},signal);
plannerAPI.rules=async()=>({rules:[]});
plannerAPI.save=async<T extends PlannerDocument>(recordId:string,revision:number,data:T)=>{
 evidence.saveAttempts.push(structuredClone({id:recordId,revision,data}));
 if(failSave||serverStatus)throw new ApiError('Enregistrement de recette indisponible ; copie locale conservée.',503);
 const previous=records.get(recordId);if((previous?.revision||0)!==revision)throw new ApiError('Révision de recette en conflit.',409);
 const saved={id:recordId,revision:revision+1,data:structuredClone(data),archived:false,createdBy:member.email,updatedBy:member.email,updatedAt:stamp} as PlannerRecord<T>;
 if(data.kind==='plan')records.set(recordId,saved as PlannerRecord<Plan>);
 evidence.saves.push({id:recordId,revision:saved.revision});
 if(lostSave)throw new TypeError('Réponse de sauvegarde perdue dans la recette.');
 return structuredClone(saved);
};
plannerAPI.create=async()=>{evidence.created++;throw Error('Génération interdite dans la recette de reprise.');};
api.media=async()=>{evidence.mediaReads++;return [];};
api.programmes=async()=>{evidence.programmeReads++;return [];};
api.programmePage=async()=>{evidence.programmeReads++;return {programmes:[],next:null};};
const control={
 list:()=>listPlannerLocalDrafts(scope()),
 seed:async(kind:'new'|'shared'|'empty'='shared',number=10)=>{
  const base=kind==='new'?null:structuredClone(records.get(id(1))!),plan=structuredClone(sourcePlan);
  plan.name=kind==='new'?'Import local à reprendre':'Retouches locales à reprendre';plan.rows[0].title='Titre retouché localement';plan.rows[0].subtitle='Sous-titre local conservé';
  if(kind==='empty'){plan.name='';plan.rows[0].title='';}
  const draft=makePlannerLocalDraft(scope(),{id:id(number),draftId:base?.id||id(100+number),sequence:1,base,plan});await writePlannerLocalDraft(scope(),draft);return draft;
 },
 server:(status:number)=>{serverStatus=status;},
 revision:(revision:number)=>{const record=records.get(id(1))!;record.revision=revision;record.data.name=`Préparation serveur r${revision}`;},
 archived:(archived:boolean)=>{records.get(id(1))!.archived=archived;},
 hold:()=>{held=true;},release:()=>{held=false;const pending=releases;releases=[];for(const release of pending)release();},
 saveFailure:(value:boolean)=>{failSave=value;},lostSave:(value:boolean)=>{lostSave=value;},
 fault:(value:''|'quota'|'blocked')=>{storageFault=value;},
 channel:(channel:string)=>selectChannel(channel),
 mount:(_value:boolean):void=>{throw Error('Fixture pas encore montée');},
 remount:():void=>{throw Error('Fixture pas encore montée');},
 leave:():void=>{throw Error('Fixture pas encore montée');},
 saved:()=>structuredClone([...records.values()]),
};
Object.assign(window,{plannerLocalEvidence:evidence,plannerLocalControl:control});
function Fixture(){
 const [mounted,setMounted]=useState(true),[generation,setGeneration]=useState(0),[channel,setChannel]=useState(activeChannelId());
 const navigation=useRef<WorkspaceNavigation|null>(null);
 useEffect(()=>{
  control.mount=setMounted;control.remount=()=>{setGeneration(value=>value+1);setMounted(true);};control.leave=()=>{const exit=()=>setMounted(false);if(navigation.current)navigation.current.leave(exit);else exit();};
  const change=()=>{evidence.channelChanges++;setChannel(activeChannelId());};window.addEventListener('srtb-channel-change',change);return()=>window.removeEventListener('srtb-channel-change',change);
 },[]);
 useEffect(()=>{if(mounted)evidence.mounts++;},[mounted,generation,channel]);
 return <main style={{padding:20,maxWidth:1366,margin:'auto'}}><header><h1>Recette des copies locales</h1><p>IndexedDB réelle · compte fictif · serveur simulé</p></header>{mounted?<DayPlanner key={`${channel}:${generation}`} member={member} navigationRef={navigation} onOpenProject={()=>{evidence.openedProjects++;}}/>:<p>Préparation démontée pour la recette.</p>}</main>;
}
const probeInput={plan:sourcePlan,base:null,draftId:id(130),dirty:false};
function HookProbe(){
 const local=usePlannerLocalDrafts(member.email,activeChannelId(),probeInput);
 useEffect(()=>{
  Object.assign(window,{plannerLocalProbe:{flush:local.flush,saved:(receipt:Awaited<ReturnType<typeof local.flush>>)=>local.saved(receipt,sourcePlan)}});
 },[local.flush,local.saved]);
 return <main><h1>Recette des copies locales</h1><p>Probe du hook réel, sans écran de production.</p><output aria-label="Écritures du probe">{local.pending?'En cours':'Terminées'}</output></main>;
}
async function start(){const seed=params.get('seed');if(seed==='new'||seed==='shared'||seed==='empty')await control.seed(seed);createRoot(document.getElementById('root')!).render(params.has('probe')?<HookProbe/>:<Fixture/>);}
void start();
