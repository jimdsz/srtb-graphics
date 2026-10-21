// Synthetic catalogue and deliberately late transports, not real permissions.
import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import PlannerMediaDialog from '../src/studio/PlannerMediaDialog';
import {api} from '../src/studio/api';
import {plannerAPI} from '../src/studio/day-planner-api';
import type {Programme} from '../src/studio/channel-model';
import type {Member} from '../src/studio/domain';
import type {DirectoryIndex,PlannerDocument,PlannerRecord,PlannerRow,PlannerSummary} from '../src/studio/day-planner-model';
import type {LocalDescriptor} from '../src/studio/local-media';
import '../src/studio/studio.css';
import '../src/studio/theme.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';
import '../src/studio/day-planner.css';

const query=new URLSearchParams(location.search),mode=query.get('mode')||'single';
const id=(value:number)=>`22222222-2222-4222-8222-${String(value).padStart(12,'0')}`;
const stamp='2026-09-29T00:00:00Z';
const member:Member={email:'programme-media@example.test',name:'Recette dossiers',role:'designer',active:1};
const evidence={mode,programmeCalls:[] as {id:string;sequence:number;aborted:boolean;settled:boolean}[],directoryOffsets:[] as number[],directoryGets:[] as string[],ruleReads:0,mediaReads:0,pickerCalls:0,permissionCalls:0,diskReads:0,writes:[] as unknown[],bindings:[] as {media:LocalDescriptor;location:PlannerRow['location'];warning?:string}[]};
const pending=new Map<number,()=>void>();let holdNext=query.has('hold');
const directory=(number:number,name:string):PlannerRecord<DirectoryIndex>=>({id:id(number),revision:2,archived:false,createdBy:member.email,updatedBy:member.email,updatedAt:stamp,data:{kind:'directory',name,scannedAt:stamp,partial:false,files:[{name:'Magazine de recette episode 1.mp4',path:`episode-1/Magazine de recette episode 1-${number}.mp4`,size:1024,modified:1790640000000}]}});
const directories=[directory(2,'Dossier choisi manuellement'),directory(3,'Dossier de la source enregistrée'),directory(1,'Émission — dossier suggéré')];
const summary=(d:PlannerRecord<DirectoryIndex>):PlannerSummary=>({id:d.id,revision:d.revision,archived:false,kind:'directory',name:d.data.name,updatedAt:d.updatedAt});
function programme(number:number,revision:number,preferred:number[]):Programme{
  return {id:id(number),channel_id:'benin-tv',name:'Magazine de recette',revision,archived:0,updated_at:stamp,data:{name:'Magazine de recette',aliases:[],category:'Magazine',replayUrl:'',recurring:false,recipe:['ba'],notes:'',directoryIds:preferred.map(id),voiceProfileId:null,logo:''}};
}
const programmes=new Map([[id(11),programme(11,mode==='mismatch'?5:4,mode==='empty'||mode==='empty-catalogue'?[]:mode==='multiple'?[1,2]:[1])],[id(12),programme(12,6,[3])]]);
const row:PlannerRow={id:'programme-resource-row',sheet:'Mardi',cell:'A2',raw:'Magazine de recette',title:'Magazine de recette',subtitle:'Épisode 1',category:'Magazine',broadcastDate:'2026-09-29',airDate:'2026-09-29',time:'20:30',duration:1800,included:true,kinds:['ba'],formats:['tv'],issues:[],media:null,location:mode==='location'?{directoryId:id(3),path:'episode-1/source.mp4',size:1024,modified:1790640000000}:null,...(mode==='unlinked'?{}:{programmeId:id(11),programmeRevision:4})};
const control={
  release:(sequence:number)=>{const release=pending.get(sequence);if(!release)throw Error(`Aucune lecture retenue ${sequence}`);pending.delete(sequence);release();},
  holdNext:()=>{holdNext=true;},
  change:(_number:number,_revision:number)=>{throw Error('Fixture pas encore montée.');},
};
Object.assign(window,{programmeMediaEvidence:evidence,programmeMediaControl:control});
Object.defineProperty(window,'showDirectoryPicker',{configurable:true,value:async()=>{evidence.pickerCalls++;throw new DOMException('Choix annulé dans la recette.','AbortError');}});
// Trap all permission/read methods if an accidental automatic filesystem path appears.
for(const [className,methods]of [['FileSystemHandle',['queryPermission','requestPermission']],['FileSystemFileHandle',['getFile']],['FileSystemDirectoryHandle',['getDirectoryHandle','getFileHandle','entries']]] as const){
  const prototype=(window as unknown as Record<string,{prototype:object}>)[className]?.prototype;
  if(prototype)for(const method of methods)Object.defineProperty(prototype,method,{configurable:true,value:async()=>{if(method.includes('Permission'))evidence.permissionCalls++;else evidence.diskReads++;throw Error('Accès disque interdit dans cette recette.');}});
}
api.programme=async(programmeId,signal)=>{
  const sequence=evidence.programmeCalls.length+1,entry={id:programmeId,sequence,aborted:!!signal?.aborted,settled:false};evidence.programmeCalls.push(entry);
  signal?.addEventListener('abort',()=>{entry.aborted=true;},{once:true});
  const snapshot=structuredClone(programmes.get(programmeId));
  if(holdNext){holdNext=false;await new Promise<void>(resolve=>pending.set(sequence,resolve));}
  // Intentionally ignore abort here: the production caller must discard late results.
  entry.settled=true;
  if(mode==='programme-error'&&sequence===1)throw Error('Fiche de recette momentanément indisponible');
  if(!snapshot)throw Error('Fiche absente');return snapshot;
};
plannerAPI.list=async(kind,offset=0)=>{
  if(kind!=='directory')return {documents:[],next:null};evidence.directoryOffsets.push(offset);
  if(mode==='catalogue-error'&&evidence.directoryOffsets.length===1)throw Error('Erreur du catalogue de dossiers de recette');
  if(mode==='empty-catalogue')return {documents:[],next:null};
  return offset?{documents:[summary(directories[2])],next:null}:{documents:directories.slice(0,2).map(summary),next:100};
};
plannerAPI.rules=async()=>{evidence.ruleReads++;return {rules:[]};};
plannerAPI.get=async<T extends PlannerDocument>(directoryId:string)=>{
  evidence.directoryGets.push(directoryId);
  if(mode==='directory-error'&&directoryId===id(1))throw Error('Index de recette indisponible');
  const found=directories.find(item=>item.id===directoryId);if(!found)throw Error('Dossier absent');
  return structuredClone(found) as unknown as PlannerRecord<T>;
};
plannerAPI.save=async(...args)=>{evidence.writes.push(structuredClone(args));throw Error('Aucune écriture autorisée dans cette recette.');};
api.media=async()=>{evidence.mediaReads++;return [];};
function Fixture(){
  const [current,setCurrent]=useState(row),[open,setOpen]=useState(true);
  useEffect(()=>{control.change=(number,revision)=>{programmes.set(id(number),programme(number,revision,number===11&&revision===5?[2]:number===12?[3]:[1]));setCurrent(previous=>({...previous,programmeId:id(number),programmeRevision:revision}));};},[]);
  return <main className="day-planner" style={{padding:24}}><h1>Dossiers de fiche émission — recette isolée</h1><p>Catalogue fictif ; aucun fichier de disque, compte ou serveur réel.</p>{open?<PlannerMediaDialog row={current} member={member} onClose={()=>setOpen(false)} onSelect={(media,location,warning)=>evidence.bindings.push({media,location,warning})}/>:null}</main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
