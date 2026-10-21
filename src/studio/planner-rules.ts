import {normalized,plannerKinds,programmeIdentity} from './day-planner-model';
import type {PlannerRecord,PlannerRow,ProgrammeRule} from './day-planner-model';

/** Never promote a first/last-wins rule to a remembered editorial decision.
 * Archived records do not compete; exact repetitions of one record are harmless. */
export function programmeRules(records:readonly PlannerRecord<ProgrammeRule>[]){
 const unique=new Map<string,PlannerRecord<ProgrammeRule>>(),conflicts=new Set<string>();
 for(const record of records){
  if(record.archived)continue;
  const key=record.data.programme,prior=unique.get(key);
  if(conflicts.has(key))continue;
  if(prior&&(prior.id!==record.id||prior.revision!==record.revision||JSON.stringify(prior.data)!==JSON.stringify(record.data))){unique.delete(key);conflicts.add(key);}
  else unique.set(key,record);
 }
 const families=new Map<string,ProgrammeRule>(),familyConflicts=new Set<string>();
 const same=(a:ProgrammeRule,b:ProgrammeRule)=>a.directoryId===b.directoryId&&normalized(a.keywords)===normalized(b.keywords)&&JSON.stringify(plannerKinds.filter(k=>a.kinds.includes(k)))===JSON.stringify(plannerKinds.filter(k=>b.kinds.includes(k)));
 for(const record of records){
  const family=record.data.family;if(record.archived||!family)continue;
  if(conflicts.has(record.data.programme)){families.delete(family);familyConflicts.add(family);continue;}
  if(familyConflicts.has(family))continue;
  // Carry only the agreed folder/search/recipe. NEVER carry an episode's file.
  const data={...record.data,preferredPath:null},prior=families.get(family);
  if(prior&&!same(prior,data)){families.delete(family);familyConflicts.add(family);}
  else families.set(family,data);
 }
 return {unique,conflicts,families,familyConflicts};
}

export function resolveProgrammeRule(row:Pick<PlannerRow,'title'|'subtitle'>,index:ReturnType<typeof programmeRules>){
 const key=programmeIdentity(row),family=normalized(row.title),exact=index.unique.get(key);
 if(index.conflicts.has(key))return {exact:undefined,data:undefined,inherited:false,conflict:true};
 if(exact)return {exact,data:exact.data,inherited:false,conflict:false};
 const conflict=index.familyConflicts.has(family),data=conflict?undefined:index.families.get(family);
 return {exact:undefined,data,inherited:!!data,conflict};
}

export function plannerRuleQuery(rows:readonly Pick<PlannerRow,'title'|'subtitle'>[]){
 return {programmes:[...new Set(rows.map(programmeIdentity).filter(Boolean))],families:[...new Set(rows.map(row=>normalized(row.title)).filter(Boolean))]};
}

/** Sharing beyond this exact episode is a separate, visible operator choice. */
export function plannerMemoryRule(row:PlannerRow,directoryId:string,path:string,reuse:boolean):ProgrammeRule{
 return {kind:'rule',name:row.title.slice(0,120),programme:programmeIdentity(row),keywords:row.title,directoryId,preferredPath:path,kinds:[...row.kinds],...(reuse&&normalized(row.title)?{family:normalized(row.title)}:{})};
}
