// Isolated UI qualification: fake directory and in-memory metadata API. No disk
// permission, upload or authenticated production service is used by this page.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import PlannerBatchMedia from '../src/studio/PlannerBatchMedia';
import PlannerMediaDialog from '../src/studio/PlannerMediaDialog';
import {plannerAPI} from '../src/studio/day-planner-api';
import type {DirectoryHandle} from '../src/studio/day-planner-folders';
import type {PlannerDocument,PlannerRecord,PlannerRow} from '../src/studio/day-planner-model';
import type {Member} from '../src/studio/domain';
import '../src/studio/studio.css';
import '../src/studio/theme.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';

const member:Member={email:'recette@example.test',name:'Recette isolée',role:'designer',active:1};
const row:PlannerRow={id:'row-1',sheet:'RECETTE',cell:'A1',raw:'Programme pilote',title:'Programme pilote',subtitle:'',category:'Magazine',broadcastDate:'2026-09-25',airDate:'2026-09-25',time:'20:30:00',duration:1800,included:true,kinds:['ba','popup'],formats:['tv'],issues:[],media:null,location:null};
const file=new File(['fixture: metadata only'],'Programme pilote.mp4',{type:'video/mp4',lastModified:100});
const fileHandle={kind:'file',name:file.name,getFile:async()=>file};
const folder={kind:'directory',name:'Recette · dossier simulé',queryPermission:async()=>'granted',requestPermission:async()=>'granted',getFileHandle:async()=>fileHandle,async* entries(){yield [file.name,fileHandle];}} as unknown as DirectoryHandle;
Object.defineProperty(window,'showDirectoryPicker',{configurable:true,value:async()=>folder});
const records=new Map<string,PlannerRecord>();
let writes=0,lateReplies=0,linked=0;
const timers=new Set<ReturnType<typeof setTimeout>>();
const audit=document.createElement('output');audit.setAttribute('aria-label','Résultat de la recette');document.body.append(audit);
function refreshAudit(){audit.textContent=JSON.stringify({writes,committed:records.size,lateReplies,linked});}
plannerAPI.list=async kind=>({documents:[...records.values()].filter(r=>r.data.kind===kind).map(r=>({id:r.id,revision:r.revision,name:r.data.name,kind:r.data.kind,updatedAt:r.updatedAt,archived:false})),next:null});
plannerAPI.rules=async()=>({rules:[],next:null});
plannerAPI.get=async<T extends PlannerDocument>(id:string)=>structuredClone(records.get(id)) as PlannerRecord<T>;
plannerAPI.save=<T extends PlannerDocument>(id:string,revision:number,data:T)=>new Promise<PlannerRecord<T>>(resolve=>{
 // Model a committed request with an indefinitely delayed HTTP acknowledgement.
 // Deliberately ignore AbortSignal: the caller must reject late results itself.
 writes++;const record:PlannerRecord<T>={id,revision:revision+1,data:structuredClone(data),updatedAt:new Date().toISOString(),archived:false,createdBy:member.email,updatedBy:member.email};records.set(id,record);
 const timer=setTimeout(()=>{timers.delete(timer);lateReplies++;resolve(structuredClone(record));refreshAudit();},45000);timers.add(timer);refreshAudit();
});
function Fixture(){
 const [mode,setMode]=useState<'batch'|'single'|null>(null);
 return <main style={{padding:24}}><h1>Annulation du partage d’index · recette locale</h1><p>Deux fenêtres réelles, un dossier simulé ; aucun envoi réseau.</p>
  <button onClick={()=>setMode('batch')}>Tester la recherche groupée</button>{' '}<button onClick={()=>setMode('single')}>Tester le média individuel</button>
  {mode==='batch'?<PlannerBatchMedia rows={[row]} member={member} onApply={()=>{linked++;refreshAudit();}} onClose={()=>setMode(null)}/>:null}
  {mode==='single'?<PlannerMediaDialog row={row} member={member} onSelect={()=>{linked++;refreshAudit();}} onClose={()=>setMode(null)}/>:null}
 </main>;
}
const root=createRoot(document.querySelector('#root')!);root.render(<Fixture/>);refreshAudit();
import.meta.hot?.dispose(()=>{for(const timer of timers)clearTimeout(timer);root.unmount();audit.remove();});
