import {planSchema} from './day-planner-model';
import type {Plan,PlannerRecord,PlannerRow,PlannerSummary,PlannerTask} from './day-planner-model';
import type {Project} from './domain';
import {localReference} from './local-reference';
import {searchRead} from './planner-team-search';

/** No file read or permission request: a saved reference is not a local binding. */
export function plannerMediaState(media:PlannerRow['media'],isConnected:(url:string)=>boolean){
  if(!media)return 'missing';
  if(!localReference(media.url))return 'shared';
  return isConnected(media.url)?'local':'reconnect';
}
export const plannerMediaLabels={missing:'Média à choisir',reconnect:'À reconnecter',local:'Lié sur ce poste',shared:'Média partagé'};

type PlanPage={documents:PlannerSummary[];next:number|null};
/** Read-only operations may stop immediately. Writes retain their separate
 * acknowledgement/revision protocol: aborting a read never retries a write. */
export async function loadPlannerList(list:(signal:AbortSignal)=>Promise<PlanPage>,signal:AbortSignal,timeoutMs=20000){
  const page=await searchRead(list,signal,timeoutMs,'Les listes ne répondent pas. Réessayez Actualiser ; votre préparation reste conservée.');
  signal.throwIfAborted();
  return page;
}
export async function loadPlannerLinkedProject(id:string,get:(id:string,signal?:AbortSignal)=>Promise<Project>,signal:AbortSignal,timeoutMs=20000){
  const project=await searchRead(s=>get(id,s),signal,timeoutMs,'Le projet ne répond pas. Réessayez son ouverture ; votre préparation reste conservée.');
  signal.throwIfAborted();
  if(project.id!==id)throw Error('Le projet reçu ne correspond pas au lien. Actualisez la préparation.');
  return project;
}

type ReadAPI={get:(id:string,signal?:AbortSignal)=>Promise<PlannerRecord<Plan>>;tasks:(id:string,signal?:AbortSignal)=>Promise<{tasks:PlannerTask[]}>};
/** Publish a complete snapshot only. A stopped/failed read cannot replace the
 * current preparation with a late response, nor leave its sibling read running. */
export async function loadPlannerPreparation(id:string,api:ReadAPI,signal:AbortSignal,timeoutMs=20000){
  signal.throwIfAborted();const c=new AbortController(),abort=()=>c.abort(signal.reason);
  signal.addEventListener('abort',abort,{once:true});
  try{
    const message='La préparation ne répond pas. Réessayez son ouverture ; votre liste actuelle reste conservée.';
    const [record,result]=await Promise.all([
      searchRead(s=>api.get(id,s),c.signal,timeoutMs,message),
      searchRead(s=>api.tasks(id,s),c.signal,timeoutMs,message),
    ]);
    c.signal.throwIfAborted();
    if(record.id!==id||record.archived||!planSchema.safeParse(record.data).success)throw Error('Cette préparation a été retirée ou ne peut pas être ouverte. Actualisez la liste.');
    return {record,tasks:result.tasks};
  }finally{c.abort();signal.removeEventListener('abort',abort);}
}
