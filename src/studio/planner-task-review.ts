import {latestPlannerTask,plannerTaskChoice,taskKey} from './day-planner-model';
import type {PlannerTask,PlannerTaskChoice} from './day-planner-model';

/** Ordinary preparation reopens the newest known edition, never silently
 * regenerates or overwrites an operator's work. Explicit editions survive retry. */
export function reusePlannerChoices(choices:readonly PlannerTaskChoice[],tasks:readonly PlannerTask[]){
  return choices.map(choice=>{
    if(choice.edition!==undefined)return choice;
    const latest=latestPlannerTask(choice,tasks),saved=latest&&plannerTaskChoice(latest);
    return saved?{...choice,...saved}:choice;
  });
}

/** Only an explicit operator action calls this. A global list revision is not
 * proof of stale content; it merely makes a new, non-destructive edition possible. */
export function updatedPlannerChoices(choices:readonly PlannerTaskChoice[],tasks:readonly PlannerTask[],revision:number){
  let changed=0;
  const next=choices.map(choice=>{
    const latest=latestPlannerTask(choice,tasks);
    if(!latest||!Number.isSafeInteger(revision)||revision<2)return choice;
    const updated=latest.sourceRevision>=revision?{...choice,...plannerTaskChoice(latest)}:{...choice,edition:revision};
    if(taskKey(updated)!==taskKey(choice))changed++;
    return updated;
  });
  return {choices:next,changed};
}

/** An interrupted edition cannot be submitted against a different list version.
 * Already recorded projects are still safe to retrieve without writing. */
export function pendingPlannerEditions(choices:readonly PlannerTaskChoice[],tasks:readonly PlannerTask[],revision:number){
  const known=new Set(tasks.map(task=>task.key));
  return choices.filter(choice=>!known.has(taskKey(choice))&&choice.edition!==undefined&&choice.edition!==revision);
}

export function plannerTaskReview(task:PlannerTask,revision?:number,dirty=false){
  if(dirty)return `Créé depuis la liste r${task.sourceRevision} · modifications non enregistrées à vérifier`;
  if(revision!==undefined&&task.sourceRevision<revision)return `Créé depuis la liste r${task.sourceRevision} · liste actuelle r${revision} : à vérifier`;
  return `Créé depuis la liste r${task.sourceRevision}`;
}

export function plannerCreationNotice(confirmedNew:number,existing:number){
  const parts=[...(confirmedNew?[`${confirmedNew} nouveau${confirmedNew>1?'x':''} brouillon${confirmedNew>1?'s':''} confirmé${confirmedNew>1?'s':''}`]:[]),...(existing?[`${existing} projet${existing>1?'s':''} existant${existing>1?'s':''} retrouvé${existing>1?'s':''}, sans modification`]:[])];
  return `${parts.join(' · ')}. Contrôlez les textes, horaires, médias et le son avant export.`;
}
