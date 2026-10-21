// Real DayPlanner; fake home buttons and memory-only read/save transports.
// No Studio/ProductionOverview rendering, live account or backend permissions.
import {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import DayPlanner from '../src/studio/DayPlanner';
import {api} from '../src/studio/api';
import {plannerAPI} from '../src/studio/day-planner-api';
import type {WorkspaceNavigation} from '../src/studio/Workspace';
import type {Plan,PlannerDocument,PlannerRecord,PlannerRow} from '../src/studio/day-planner-model';
import '../src/studio/studio.css';
import '../src/studio/theme.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';

type Entry={requestId:string;planId:string;rowId:string;planRevision:number};
const id=(number:number)=>`33333333-3333-4333-8333-${String(number).padStart(12,'0')}`;
const member={email:'entry@example.test',name:'Recette entrée',role:'designer' as const,active:1};
const stamp='2026-09-29T12:00:00Z';
const records=new Map<string,PlannerRecord<Plan>>();
for(const number of [1,2]){
  const rows:PlannerRow[]=Array.from({length:34},(_,index)=>({
    id:index===25?'row:shared/Émission':index===26?'excluded':index===27?'removed':`row-${index}`,
    sheet:'Recette',cell:`A${index+1}`,raw:'Source de recette',title:index===25?'Programme homonyme':`Programme ${index+1}`,
    subtitle:index===25?`Préparation ${number===1?'A':'B'} — Épisode cible`:`Épisode ${index+1}`,category:'Magazine',
    broadcastDate:'2026-09-30',airDate:'2026-09-30',time:`06:${String(index).padStart(2,'0')}:00`,duration:1800,
    included:index!==26&&index!==27,kinds:['ba'],formats:['tv'],issues:[],media:null,location:null,...(index===27?{sourceRemoved:true}:{})
  }));
  rows.push({...rows[0],id:'first-day',title:'Première journée',broadcastDate:'2026-09-29',airDate:'2026-09-29',time:'20:30:00'});
  records.set(id(number),{id:id(number),revision:number===1?4:9,archived:false,createdBy:member.email,updatedBy:member.email,updatedAt:stamp,data:{kind:'plan',name:`Préparation ${number===1?'A':'B'}`,source:`recette-${number}.xlsx`,sourceHash:'a'.repeat(64),rows:rows.reverse()}});
}
const evidence={requests:[] as Entry[],consumed:[] as string[],reads:[] as {kind:string;id:string;aborted:boolean;settled:boolean}[],saveAttempts:[] as {id:string;revision:number;data:PlannerDocument}[],saves:[] as {id:string;revision:number;data:PlannerDocument}[],created:0,openedProjects:0,homeReturns:0};
const gates=new Map<string,(()=>void)[]>();let heldId:string|null=null,failSave=false,sequence=0,saveHeld=false,saveRelease:(()=>void)|undefined;
const control={
  hold:(number:number)=>{heldId=id(number);},
  release:(number:number)=>{if(heldId===id(number))heldId=null;const releases=gates.get(id(number))||[];gates.delete(id(number));for(const release of releases)release();},
  failSave:(value:boolean)=>{failSave=value;},
  holdSave:()=>{saveHeld=true;},
  releaseSave:()=>{saveHeld=false;saveRelease?.();saveRelease=undefined;},
  inject:(_number:number,_rowId='row:shared/Émission',_revision?:number,_requestId?:string):void=>{throw Error('Fixture pas encore montée');},
  saved:(number:number)=>structuredClone(records.get(id(number))),
};
Object.assign(window,{productionEntryEvidence:evidence,productionEntryControl:control});
async function read<T>(kind:string,recordId:string,value:T,signal?:AbortSignal):Promise<T>{
  const entry={kind,id:recordId,aborted:!!signal?.aborted,settled:false};evidence.reads.push(entry);
  signal?.addEventListener('abort',()=>{entry.aborted=true;},{once:true});
  const snapshot=structuredClone(value);
  if(heldId===recordId)await new Promise<void>(resolve=>{const list=gates.get(recordId)||[];list.push(resolve);gates.set(recordId,list);});
  // Deliberately ignore AbortSignal: late replies must be discarded by DayPlanner.
  entry.settled=true;return snapshot;
}
plannerAPI.list=async kind=>({documents:kind==='plan'?[...records.values()].map(record=>({id:record.id,revision:record.revision,kind:'plan' as const,name:record.data.name,updatedAt:stamp,archived:false})):[],next:null});
plannerAPI.get=async<T extends PlannerDocument>(recordId:string,signal?:AbortSignal)=>{
  const record=records.get(recordId);if(!record)throw Error('Préparation de recette absente');
  return read('get',recordId,record,signal) as unknown as Promise<PlannerRecord<T>>;
};
plannerAPI.tasks=async(recordId,signal)=>read('tasks',recordId,{tasks:[]},signal);
plannerAPI.rules=async()=>({rules:[]});
plannerAPI.save=async<T extends PlannerDocument>(recordId:string,revision:number,data:T)=>{
  evidence.saveAttempts.push(structuredClone({id:recordId,revision,data}));
  if(saveHeld)await new Promise<void>(resolve=>{saveRelease=resolve;});
  if(failSave)throw Error('Conflit de recette : la préparation n’a pas été enregistrée.');
  const previous=records.get(recordId);if(!previous||previous.revision!==revision)throw Error('Révision de recette en conflit.');
  const saved={...previous,revision:revision+1,data:structuredClone(data)} as PlannerRecord<T>;
  if(data.kind==='plan')records.set(recordId,saved as PlannerRecord<Plan>);
  evidence.saves.push(structuredClone({id:recordId,revision:saved.revision,data}));return structuredClone(saved);
};
plannerAPI.create=async()=>{evidence.created++;throw Error('Création interdite dans cette recette de navigation.');};
api.media=async()=>[];api.programmes=async()=>[];
function Fixture(){
  const [view,setView]=useState<'home'|'planner'>('home'),[entry,setEntry]=useState<Entry>();
  const navigation=useRef<WorkspaceNavigation|null>(null);
  function inject(number:number,rowId='row:shared/Émission',revision?:number,requestId?:string){
    const next={requestId:requestId||`entry-${++sequence}`,planId:id(number),rowId,planRevision:revision??records.get(id(number))!.revision};
    evidence.requests.push(next);setEntry(next);setView('planner');
  }
  useEffect(()=>{control.inject=inject;},[]);
  function home(){const next=()=>{evidence.homeReturns++;setView('home');setEntry(undefined);};if(navigation.current)navigation.current.leave(next);else next();}
  return <main style={{padding:20,maxWidth:1366,margin:'auto'}}><header><h1>Recette de navigation ciblée</h1><p>Accueil simulé · données fictives · aucune écriture serveur</p><div className="row wrap" aria-label="Commandes de recette"><button type="button" onClick={()=>inject(1)}>Demander la cible A</button><button type="button" onClick={()=>inject(2)}>Demander la cible B</button><button type="button" onClick={home}>Retour accueil de recette</button></div></header>{view==='home'?<section><h2>Accueil de recette</h2><p>Deux préparations contiennent le même titre et le même identifiant de ligne.</p></section>:<DayPlanner member={member} navigationRef={navigation} entry={entry} onEntryConsumed={()=>{if(entry)evidence.consumed.push(entry.requestId);setEntry(current=>current?.requestId===entry?.requestId?undefined:current);}} onOpenProject={()=>{evidence.openedProjects++;}}/>}</main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
