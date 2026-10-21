import {mediaProposals} from './day-planner-assistant';
import {programmeRules,resolveProgrammeRule} from './planner-rules';
import type {DirectoryIndex,IndexedMedia,PlannerRecord,PlannerRow,PlannerSummary,ProgrammeRule} from './day-planner-model';

export type MediaDirectory=Pick<PlannerRecord<DirectoryIndex>,'id'|'revision'>&Pick<DirectoryIndex,'name'|'partial'|'scannedAt'>;
export type TeamMediaMatch={key:string;directory:MediaDirectory;file:IndexedMedia;score:number;reason:string;manual:boolean};
export type TeamMediaProposal={row:PlannerRow;matches:TeamMediaMatch[];suggested:string;ruleConflict?:boolean};
export const teamMediaKey=(directoryId:string,path:string)=>JSON.stringify([directoryId,path]);

/** Run in a dedicated worker. Retain only five candidates per programme, not
 * every file in every shared index. A filename is never a content guarantee. */
export class TeamMediaMatcher {
 private candidates:TeamMediaMatch[][];
 private seen=new Set<string>();
 private rows:PlannerRow[];
 constructor(rows:PlannerRow[],private rules:PlannerRecord<ProgrammeRule>[]){
  this.rows=rows.filter(r=>r.included);this.candidates=this.rows.map(()=>[]);
 }
 add(record:PlannerRecord<DirectoryIndex>){
  if(record.archived||this.seen.has(record.id))return;
  this.seen.add(record.id);
  const {id,revision,data:{name,partial,scannedAt}}=record,directory={id,revision,name,partial,scannedAt};
  const proposals=mediaProposals(this.rows,record,this.rules,true);
  proposals.forEach((p,i)=>{
   const next=p.matches.map(m=>({...m,manual:'manual' in m?m.manual:false,key:teamMediaKey(id,m.file.path),directory}));
   this.candidates[i]=[...this.candidates[i],...next].sort((a,b)=>b.score-a.score||a.directory.name.localeCompare(b.directory.name,'fr')||a.key.localeCompare(b.key)).slice(0,5);
  });
 }
 result(complete=true):TeamMediaProposal[]{
  const index=programmeRules(this.rules);
  return this.rows.map((row,i)=>{
   const matches=this.candidates[i],best=matches[0];
   const resolved=resolveProgrammeRule(row,index),ruleConflict=resolved.conflict;
   // Reconnection is an exact saved location; fingerprint validation still runs
   // before binding. Fuzzy choices compare ALL directories, not one at a time.
   const exact=!!row.media&&!!best&&row.location?.directoryId===best.directory.id&&row.location.path===best.file.path;
   const distinct=complete&&!!best&&!best.manual&&best.score>=80&&(!matches[1]||best.score-matches[1].score>=20);
   return {row,matches,ruleConflict,suggested:best&&(exact||distinct&&!ruleConflict)?best.key:''};
  });
 }
}

export type TeamSearchProgress={done:number;total:number;failed:number};
export async function teamDirectoryCatalog(list:(offset:number,signal:AbortSignal)=>Promise<{documents:PlannerSummary[];next:number|null}>,signal:AbortSignal,onProgress:(count:number)=>void){
 const found=new Map<string,PlannerSummary>();let offset:number|null=0;
 while(offset!==null){
  const page=await searchRead(s=>list(offset!,s),signal);signal.throwIfAborted();
  for(const directory of page.documents)if(directory.kind==='directory'&&!directory.archived)found.set(directory.id,directory);
  onProgress(found.size);
  if(page.next!==null&&(!Number.isInteger(page.next)||page.next<=offset||page.next>2000))throw Error('La liste des dossiers a changé. Actualisez avant de rechercher.');
  offset=page.next;
 }
 return [...found.values()];
}
export async function searchTeamIndexes({directories,get,add,result,signal,onProgress,timeoutMs=20000}:{
 directories:PlannerSummary[];get:(id:string,signal:AbortSignal)=>Promise<PlannerRecord<DirectoryIndex>>;
 add:(record:PlannerRecord<DirectoryIndex>)=>Promise<void>;result:(complete:boolean)=>Promise<TeamMediaProposal[]>;
 signal:AbortSignal;onProgress:(progress:TeamSearchProgress)=>void;timeoutMs?:number;
}){
 const unique=[...new Map(directories.filter(d=>!d.archived&&d.kind==='directory').map(d=>[d.id,d])).values()];
 const failures:{id:string;name:string;message:string}[]=[],partial:{id:string;name:string}[]=[];
 const controller=new AbortController(),abort=()=>controller.abort(signal.reason);
 signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
 const workSignal=controller.signal;
 let next=0,done=0;
 const progress=()=>onProgress({done,total:unique.length,failed:failures.length});
 progress();
 async function lane(){
  while(next<unique.length){
   workSignal.throwIfAborted();const summary=unique[next++];
   try{
    const d=await searchRead(s=>get(summary.id,s),workSignal,timeoutMs);
    workSignal.throwIfAborted();
    if(d.id!==summary.id||d.archived||d.data.kind!=='directory')throw Error('Index retiré ou modifié : actualisez la liste.');
    await add(d);workSignal.throwIfAborted();
    if(d.data.partial)partial.push({id:d.id,name:d.data.name});
   }catch(error){
    workSignal.throwIfAborted();
    // Authentication failures must not be disguised as a missing folder.
    if([401,403].includes(Number((error as {status?:number})?.status)))throw error;
    failures.push({id:summary.id,name:summary.name,message:error instanceof Error?error.message:String(error)});
   }
   done++;progress();
  }
 }
 try{
  await Promise.all(Array.from({length:Math.min(3,unique.length)},lane));
  workSignal.throwIfAborted();
  return {proposals:await result(failures.length===0&&partial.length===0),failures,partial,searched:done-failures.length};
 }finally{controller.abort();signal.removeEventListener('abort',abort);}
}

/** Bounds read-only metadata operations and rejects late replies on cancellation. */
export function searchRead<T>(operation:(signal:AbortSignal)=>Promise<T>,signal:AbortSignal,timeoutMs=20000,timeoutMessage='Cet index ne répond pas. Réessayez la recherche.'):Promise<T>{
 return new Promise((resolve,reject)=>{
  signal.throwIfAborted();const c=new AbortController();let done=false;
  const finish=(error:unknown,value?:T)=>{if(done)return;done=true;clearTimeout(timer);signal.removeEventListener('abort',abort);error?reject(error):resolve(value!);};
  const abort=()=>{c.abort(signal.reason);finish(signal.reason||new DOMException('Recherche arrêtée.','AbortError'));};
  const timer=setTimeout(()=>{const error=Error(timeoutMessage);c.abort(error);finish(error);},timeoutMs);
  signal.addEventListener('abort',abort,{once:true});
  Promise.resolve().then(()=>{c.signal.throwIfAborted();return operation(c.signal);}).then(value=>finish(null,value),error=>finish(error));
 });
}
