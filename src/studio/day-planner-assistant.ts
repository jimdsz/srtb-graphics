import {normalized,rankMedia,timeSchema} from './day-planner-model';
import type {PlannerRow,DirectoryIndex,PlannerRecord,ProgrammeRule} from './day-planner-model';
import {programmeRules,resolveProgrammeRule} from './planner-rules';
import {defaultWeeklyStart,weeklyPeriod} from './planner-weekly-period';
import {recurringProgramme} from './day-planner-recurrence';

/** Proposals only. A score is a filename heuristic, not content recognition. */
export function mediaProposals(rows:PlannerRow[],directory:PlannerRecord<DirectoryIndex>,rules:PlannerRecord<ProgrammeRule>[],includeAssigned=false){
 const index=programmeRules(rules);
 return rows.filter(r=>r.included&&(!r.media||includeAssigned)).map(row=>{
  const resolved=resolveProgrammeRule(row,index),ruleConflict=resolved.conflict,rule=resolved.exact;
  if(row.media){
   const file=row.location?.directoryId===directory.id?directory.data.files.find(f=>f.path===row.location?.path):undefined;
   return {row,ruleConflict,rule,matches:file?[{file,score:100,reason:'Média enregistré · contenu à vérifier sur ce poste'}]:[],suggested:file?.path||''};
  }
  const matches=rankMedia(row,directory,resolved.data).map(match=>resolved.inherited?{...match,reason:`Recette de l’émission · ${match.reason}`} :match);
  const best=matches[0];
  const unambiguous=!!best&&!best.manual&&best.score>=80&&(!matches[1]||best.score-matches[1].score>=20);
  return {row,ruleConflict,rule,matches,suggested:!directory.data.partial&&!ruleConflict&&unambiguous?best.file.path:''};
 });
}

/** Seven calendar days, never seven arbitrary available dates. A missing day stays
 * empty; actual air dates take precedence over the source sheet's day. */
export function proposeWeeklySchedule(rows:PlannerRow[],startDate:string){
 const dates=weeklyPeriod(startDate);
 const time=(row:PlannerRow)=>row.time.length===5?row.time+':00':row.time;
 const priority=(row:PlannerRow)=>(row.media?100:0)+(time(row)>='19:00:00'&&time(row)<='23:00:00'?20:0)+(row.kinds.includes('ba')?10:0);
 const days=dates.map(date=>{
  const candidates=rows.filter(row=>row.included&&row.airDate===date&&timeSchema.safeParse(row.time).success&&row.kinds.length&&row.title.trim()&&normalized(row.category)!=='information'&&!recurringProgramme(row.raw||row.title));
  candidates.sort((a,b)=>priority(b)-priority(a)||time(a).localeCompare(time(b))||a.id.localeCompare(b.id));
  return {date,rowId:candidates[0]?.id??null};
 });
 return {startDate,endDate:dates[6],days,rowIds:days.flatMap(day=>day.rowId?[day.rowId]:[])};
}
/** Backwards-compatible callers get a proposal only, never a mutation. */
export function proposeWeek(rows:PlannerRow[],startDate=defaultWeeklyStart(rows)){
 return startDate?proposeWeeklySchedule(rows,startDate).rowIds:[];
}
