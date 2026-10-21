import type {DirectoryIndex,PlannerRecord,PlannerRow,ProgrammeRule} from './day-planner-model';
import type {TeamMediaProposal} from './planner-team-search';

export function teamMediaWorker(rows:PlannerRow[],rules:PlannerRecord<ProgrammeRule>[],signal:AbortSignal){
 signal.throwIfAborted();
 const worker=new Worker(new URL('./planner-team-search.worker.ts',import.meta.url),{type:'module'});
 const pending=new Map<number,{resolve:(value:TeamMediaProposal[]|undefined)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 let next=0,closed=false;
 function close(error=Error('Recherche arrêtée.')){if(closed)return;closed=true;worker.terminate();signal.removeEventListener('abort',abort);for(const p of pending.values()){clearTimeout(p.timer);p.reject(error);}pending.clear();}
 const abort=()=>close(signal.reason||new DOMException('Recherche arrêtée.','AbortError'));
 signal.addEventListener('abort',abort,{once:true});
 worker.onerror=()=>close(Error('Le moteur de recherche local n’a pas pu démarrer. Réessayez ou choisissez un dossier.'));
 worker.onmessage=event=>{const m=event.data,p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);if(m.error)p.reject(Error(m.error));else p.resolve(m.proposals);};
 function send(message:object){return new Promise<TeamMediaProposal[]|undefined>((resolve,reject)=>{
  if(closed){reject(Error('Recherche arrêtée.'));return;}
  const id=++next,timer=setTimeout(()=>close(Error('Le calcul des correspondances ne répond plus. Réessayez avec un seul dossier.')),30000);
  pending.set(id,{resolve,reject,timer});
  try{worker.postMessage({...message,id});}catch(error){close(error instanceof Error?error:Error(String(error)));}
 });}
 const ready=send({type:'init',rows,rules});
 void ready.catch(()=>{}); // Consumers still receive the rejection; avoid an unhandled rejection while fetching the first index.
 return {add:async(directory:PlannerRecord<DirectoryIndex>)=>{await ready;await send({type:'directory',directory});},
  result:async(complete:boolean)=>{await ready;return (await send({type:'result',complete}))!;},close};
}

/** The single-folder view uses the same background matcher and safety rules as
 * team search. Only metadata crosses the worker boundary, never file handles. */
export async function directoryMediaWorker(rows:PlannerRow[],directory:PlannerRecord<DirectoryIndex>,rules:PlannerRecord<ProgrammeRule>[],signal:AbortSignal){
 const matcher=teamMediaWorker(rows,rules,signal);
 try{await matcher.add(directory);signal.throwIfAborted();const proposals=await matcher.result(!directory.data.partial);signal.throwIfAborted();return proposals;}
 finally{matcher.close();}
}
