import {plannerLabels,taskKey} from './day-planner-model';
import type {Plan,PlannerTaskChoice} from './day-planner-model';
import {weeklyChoices} from './planner-weekly';

/** Only tasks actually proposed by this reviewed preparation can be claimed. */
export function assignmentChoices(plan:Plan):PlannerTaskChoice[]{
 const choices:PlannerTaskChoice[]=plan.rows.filter(row=>row.included&&!row.sourceRemoved).flatMap(row=>
  [...new Set(row.kinds)].flatMap(kind=>[...new Set(row.formats)].map(format=>({kind,format,rowIds:[row.id]}))));
 if(plan.weekly?.rowIds.length===7){
  for(const choice of weeklyChoices(plan))if(choice.rowIds.every(id=>!plan.rows.find(row=>row.id===id)?.sourceRemoved))choices.push(choice);
 }
 return choices;
}
export function assignmentRows(plan:Plan){
 return assignmentChoices(plan).map(choice=>{
  const rows=choice.rowIds.map(id=>plan.rows.find(row=>row.id===id)!);
  const format=choice.format==='tv'?'TV':choice.format==='portrait'?'4:5':'9:16';
  return{key:taskKey(choice),label:choice.kind==='weekly'?`Semainier · ${format}`:`${rows[0].title} · ${plannerLabels[choice.kind]} · ${format}`,time:choice.kind==='weekly'?'':rows[0].time};
 });
}
