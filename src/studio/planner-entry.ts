import type {Plan} from './day-planner-model';
import {plannerRowOrder} from './planner-validation';

/** Navigation intent only. Never carries a preparation snapshot or project data. */
export interface PlannerEntry {requestId:string;planId:string;planRevision:number;rowId:string}

export function plannerEntryLocation(plan:Plan,rowId:string){
 const row=plan.rows.find(item=>item.id===rowId);
 if(!row)throw Error('Cette ligne n’existe plus dans la préparation. Actualisez l’accueil pour retrouver les tâches actuelles.');
 const rows=plan.rows.filter(item=>item.broadcastDate===row.broadcastDate&&(!row.included||item.included)).sort(plannerRowOrder);
 return {day:row.broadcastDate,page:Math.floor(rows.findIndex(item=>item.id===rowId)/20),excluded:!row.included};
}
