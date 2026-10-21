import {normalized,plannerKinds,programmeIdentity,ruleSchema} from './day-planner-model';
import type {Plan,PlannerRecord,PlannerRow,ProgrammeRule} from './day-planner-model';
import {programmeRules,resolveProgrammeRule} from './planner-rules';

export type RecipeChange={rowId:string;programme:string;title:string;before:PlannerRow['kinds'];after:PlannerRow['kinds'];inherited?:boolean};
const canonical=(kinds:PlannerRow['kinds'])=>plannerKinds.filter(kind=>kinds.includes(kind));
const equal=(a:PlannerRow['kinds'],b:PlannerRow['kinds'])=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));

/** The operator can remember an empty recipe without having to pick a file.
 * Preserve an exact association; an inherited recipe must never carry a file
 * from another episode. Existing family scope also remains intact. */
export function recipeMemoryRule(row:PlannerRow,known?:ProgrammeRule,shareFamily=false):ProgrammeRule{
  const programme=programmeIdentity(row),family=shareFamily?normalized(row.title):known?.programme===programme?known.family:undefined;
  return {kind:'rule',name:row.title.slice(0,120),programme,keywords:known?.keywords??row.title,directoryId:known?.directoryId??null,
    preferredPath:known?.programme===programme?known.preferredPath:null,kinds:canonical(row.kinds),...(family?{family}:{})};
}

/** One identity may appear several times in a conductor. Do not remember an
 * arbitrary occurrence if the operator gave those occurrences different kinds. */
export function recipeMemoryCandidates(rows:readonly PlannerRow[],rules:readonly PlannerRecord<ProgrammeRule>[]){
  const index=programmeRules(rules.filter(record=>ruleSchema.safeParse(record.data).success));
  const grouped=new Map<string,{row:PlannerRow;conflict:boolean}>();
  for(const row of rows){if(!row.included)continue;const key=programmeIdentity(row),previous=grouped.get(key);
    if(previous){if(!equal(previous.row.kinds,row.kinds))previous.conflict=true;}
    else grouped.set(key,{row,conflict:false});
  }
  return [...grouped.values()].map(item=>{const resolved=resolveProgrammeRule(item.row,index);return {...item,programme:programmeIdentity(item.row),prior:resolved.exact,known:resolved.data,conflict:item.conflict||resolved.conflict};});
}

/** Team recipes are suggestions, never permission to change an existing draft.
 * A duplicate/invalid/archived rule is not a safe automatic choice. */
export function recipeProposals(rows:readonly PlannerRow[],rules:readonly PlannerRecord<ProgrammeRule>[]):RecipeChange[]{
  const index=programmeRules(rules.filter(record=>ruleSchema.safeParse(record.data).success));
  return rows.filter(row=>row.included).flatMap(row=>{
    const programme=programmeIdentity(row),resolved=resolveProgrammeRule(row,index);
    if(!resolved.data||resolved.conflict||equal(row.kinds,resolved.data.kinds))return [];
    return [{rowId:row.id,programme,title:row.title,before:[...row.kinds],after:canonical(resolved.data.kinds),...(resolved.inherited?{inherited:true}:{})}];
  });
}

/** Check the field inspected by the operator again at application/undo time.
 * Unrelated text, dates, media, crops, formats and the weekly order are untouched. */
export function applyRecipeChanges(plan:Plan,changes:readonly RecipeChange[],undo=false){
  const applied:RecipeChange[]=[],byRow=new Map(changes.map(change=>[change.rowId,change]));
  const rows=plan.rows.map(row=>{
    const change=byRow.get(row.id);if(!change||!row.included||row.sourceRemoved||programmeIdentity(row)!==change.programme)return row;
    const expected=undo?change.after:change.before,next=undo?change.before:change.after;
    if(!equal(row.kinds,expected))return row;
    applied.push(change);return {...row,kinds:[...next]};
  });
  return {plan:applied.length?{...plan,rows}:plan,applied};
}
