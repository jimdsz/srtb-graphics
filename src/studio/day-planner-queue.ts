import {MAX_PLANNER_TASKS,taskKey} from './day-planner-model';
import type {Plan,PlannerRecord,PlannerTask,PlannerTaskChoice} from './day-planner-model';
import {plannerProject} from './day-planner-project';

export function plannerSelection(choices:PlannerTaskChoice[],tasks:PlannerTask[]){
  const unique=[...new Map(choices.map(choice=>[taskKey(choice),choice])).values()];
  if(!unique.length)throw Error('Choisissez au moins un programme, un habillage et un format.');
  const known=new Set(tasks.map(task=>task.key)),pending=unique.filter(choice=>!known.has(taskKey(choice)));
  if(known.size+pending.length>MAX_PLANNER_TASKS)throw Error('Cette préparation dépasserait 2 000 projets par personne. Préparez les journées restantes dans une autre liste.');
  return {choices:unique,pending,existing:unique.length-pending.length,total:unique.length};
}

type QueueAPI={
  tasks:(id:string,signal?:AbortSignal)=>Promise<{tasks:PlannerTask[]}>;
  create:(id:string,revision:number,choices:PlannerTaskChoice[],options?:{response?:'requested';signal?:AbortSignal})=>Promise<{tasks:PlannerTask[]}>;
};
export type PlannerProgress={tasks:PlannerTask[];completed:number;total:number};

// A stop is graceful: finish and acknowledge the current transaction, then stop.
// A timeout is different: its commit is unknown, so the next run MUST read the
// server ledger. Never blindly retry a write, or count an unconfirmed response.
export async function plannerRequest<T>(operation:(signal:AbortSignal)=>Promise<T>,timeoutMs=30000){
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([Promise.resolve().then(()=>operation(controller.signal)),new Promise<never>((_,reject)=>{
    timer=setTimeout(()=>{const error=Error('La réponse tarde : création non confirmée. Reprenez la préparation pour retrouver les brouillons déjà créés, sans doublon.');controller.abort(error);reject(error);},timeoutMs);
  })]);}finally{clearTimeout(timer);}
}

export async function createPlannerQueue({record,choices,api,signal,onProgress,timeoutMs=30000}:{
  record:PlannerRecord<Plan>;choices:PlannerTaskChoice[];api:QueueAPI;signal:AbortSignal;
  onProgress:(state:PlannerProgress)=>void;timeoutMs?:number;
}){
  signal.throwIfAborted();
  const fresh=await plannerRequest(s=>api.tasks(record.id,s),timeoutMs);
  const selected=plannerSelection(choices,fresh.tasks),ledger=new Map(fresh.tasks.map(task=>[task.key,task]));
  let completed=selected.existing;
  const publish=()=>onProgress({tasks:[...ledger.values()],completed,total:selected.total});
  publish();signal.throwIfAborted();
  // Check the complete selection before creating a first project; yield to the
  // interface so a full week can still be stopped during validation.
  for(let i=0;i<selected.pending.length;i++){
    signal.throwIfAborted();plannerProject(record.data,selected.pending[i]);
    if(i%16===15)await new Promise<void>(resolve=>setTimeout(resolve,0));
  }
  for(let i=0;i<selected.pending.length;i+=8){
    signal.throwIfAborted();const batch=selected.pending.slice(i,i+8);
    const result=await plannerRequest(s=>api.create(record.id,record.revision,batch,{response:'requested',signal:s}),timeoutMs);
    const returned=new Map(result.tasks.map(task=>[task.key,task]));
    if(batch.some(choice=>!returned.get(taskKey(choice))?.projectId))throw Error('Réponse incomplète : certains brouillons ne sont pas confirmés. Reprenez la préparation pour vérifier leur état sans doublon.');
    for(const choice of batch){const key=taskKey(choice);ledger.set(key,returned.get(key)!);}
    completed+=batch.length;publish();
  }
  // If the user stops during the last transaction, all requested projects really
  // are ready. Do not report an interruption after a complete confirmed result.
  return {tasks:[...ledger.values()],completed,total:selected.total,confirmedNew:selected.pending.length,existing:selected.existing};
}
