import {patchPlannerRow,plannerWeeklySchema} from './day-planner-model';
import type {Plan,PlannerRow,PlannerWeekly,PlannerTaskChoice} from './day-planner-model';
import {defaultWeeklyStart,weeklyPeriod} from './planner-weekly-period';

/** Optional on old documents; reading a default never dirties a saved list. */
export function plannerWeekly(plan:Plan|null):PlannerWeekly{
  return plan?.weekly??{rowIds:[],formats:['tv']};
}
export function weeklyProposalStart(plan:Plan):string{
  return plan.weekly?.startDate??defaultWeeklyStart(plan.rows);
}
/** Advisory only: a deliberate editorial selection may contain two programmes
 * on one day or outside the proposed period. Never replace it implicitly. */
export function weeklySelectionReview(plan:Plan){
  const startDate=weeklyProposalStart(plan);
  const dates=startDate?weeklyPeriod(startDate):[];
  const selected=plannerWeekly(plan).rowIds.map(id=>plan.rows.find(row=>row.id===id));
  const counts=new Map<string,number>();
  for(const row of selected)if(row)counts.set(row.airDate,(counts.get(row.airDate)??0)+1);
  return {startDate,endDate:dates[6]??'',missingDates:dates.filter(date=>!counts.has(date)),
    duplicateDates:[...counts].filter(([,count])=>count>1).map(([date])=>date).sort(),
    outsideRowIds:plannerWeekly(plan).rowIds.filter((id,i)=>!selected[i]||!dates.includes(selected[i]!.airDate))};
}
export function updatePlannerWeekly(plan:Plan,patch:Partial<PlannerWeekly>):Plan{
  const weekly=plannerWeeklySchema.parse({...plannerWeekly(plan),...patch});
  if(weekly.rowIds.some(id=>!plan.rows.some(row=>row.id===id&&row.included)))throw Error('Choisissez un programme retenu dans cette préparation.');
  return {...plan,weekly};
}
export function patchPlannerProgramme(plan:Plan,id:string,patch:Partial<PlannerRow>):Plan{
  const next={...plan,rows:plan.rows.map(row=>row.id===id?patchPlannerRow(row,patch):row)};
  // An explicit exclusion removes only that slot, never its source file or draft.
  if(patch.included===false&&next.weekly?.rowIds.includes(id))next.weekly={...next.weekly,rowIds:next.weekly.rowIds.filter(value=>value!==id)};
  return next;
}
export function setPlannerIncluded(plan:Plan,ids:readonly string[],included:boolean):Plan{
  const selected=new Set(ids),next={...plan,rows:plan.rows.map(row=>selected.has(row.id)?{...row,included}:row)};
  if(!included&&next.weekly)next.weekly={...next.weekly,rowIds:next.weekly.rowIds.filter(id=>!selected.has(id))};
  return next;
}
export function moveWeeklyProgramme(ids:readonly string[],id:string,direction:-1|1){
  const next=[...ids],from=next.indexOf(id),to=from+direction;
  if(from>=0&&to>=0&&to<next.length)[next[from],next[to]]=[next[to],next[from]];
  return next;
}
export function weeklyChoices(plan:Plan):PlannerTaskChoice[]{
  const weekly=plannerWeeklySchema.parse(plannerWeekly(plan));
  if(weekly.rowIds.length!==7)throw Error('Choisissez sept programmes pour le semainier.');
  if(weekly.rowIds.some(id=>!plan.rows.some(row=>row.id===id&&row.included)))throw Error('Le semainier contient un programme écarté ou absent.');
  return weekly.formats.map(format=>({kind:'weekly',rowIds:[...weekly.rowIds],format}));
}
