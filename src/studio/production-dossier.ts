import {latestPlannerTask,linkedTasksForRow,plannerFormats,plannerKinds,plannerLabels,plannerTaskChoice,taskKey} from './day-planner-model';
import type {PlannerTask,PlannerTaskChoice} from './day-planner-model';

export const dossierFormatLabels={tv:'TV · 16:9',portrait:'Portrait · 4:5',vertical:'Vertical · 9:16'};
export interface DossierVariant {
  key:string;
  kind:typeof plannerKinds[number];
  format:PlannerTaskChoice['format'];
  project:PlannerTask;
  otherVersions:PlannerTask[];
}
export interface DossierGroup {kind:typeof plannerKinds[number];label:string;variants:DossierVariant[]}

/** A view of the caller's already-authorized ledger, never a team inventory.
 * Row identity is exact: a similar title, another airing or a weekly key cannot
 * add a project. Changes to today's choices never remove an existing link. */
export function productionDossier(rowId:string,tasks:readonly PlannerTask[]):{groups:DossierGroup[];projectCount:number}{
  const linked=linkedTasksForRow(rowId,tasks).filter(task=>task.projectId.trim()&&Number.isSafeInteger(task.sourceRevision)&&task.sourceRevision>0);
  const buckets=new Map<string,PlannerTask[]>();
  for(const task of linked){
    const choice=plannerTaskChoice(task)!;
    const key=taskKey({...choice,edition:undefined}),bucket=buckets.get(key)||[];
    if(!bucket.some(existing=>existing.key===task.key&&existing.projectId===task.projectId))bucket.push(task);
    buckets.set(key,bucket);
  }
  const groups:DossierGroup[]=[];
  for(const kind of plannerKinds){
    const variants:DossierVariant[]=[];
    for(const format of plannerFormats){
      const choice:PlannerTaskChoice={kind,format,rowIds:[rowId]},key=taskKey(choice),bucket=buckets.get(key);
      if(!bucket?.length)continue;
      // Match the existing prepare/reuse protocol, without claiming this is the
      // most recently edited project (the ledger has no project edit timestamp).
      const project=latestPlannerTask(choice,bucket)!;
      const otherVersions=bucket.filter(task=>task!==project).sort((a,b)=>b.sourceRevision-a.sourceRevision||(plannerTaskChoice(b)?.edition??0)-(plannerTaskChoice(a)?.edition??0)||a.key.localeCompare(b.key));
      variants.push({key,kind,format,project,otherVersions});
    }
    if(variants.length)groups.push({kind,label:plannerLabels[kind],variants});
  }
  return {groups,projectCount:groups.reduce((count,group)=>count+group.variants.reduce((sum,variant)=>sum+1+variant.otherVersions.length,0),0)};
}

export function dossierTaskState(task:Pick<PlannerTask,'status'|'archived'>){
  if(task.archived)return {key:'archived',label:'Archivé'};
  const labels:Record<string,string>={draft:'Brouillon',submitted:'À valider',approved:'Validé',rejected:'À corriger'};
  return Object.hasOwn(labels,task.status)?{key:task.status,label:labels[task.status]}:{key:'unknown',label:'État à vérifier'};
}
