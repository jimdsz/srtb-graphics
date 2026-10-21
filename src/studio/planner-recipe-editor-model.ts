import {normalized,plannerKinds,programmeIdentity,ruleSchema} from './day-planner-model';
import type {PlannerRecord,PlannerRow,ProgrammeRule} from './day-planner-model';
import {programmeRules,resolveProgrammeRule} from './planner-rules';
import {plannerRecoveryFingerprint as fingerprint} from './planner-local-recovery-model';
import type {RecipeChange} from './planner-recipes';

export type RecipeScope='episode'|'programme';
export type RecipeHabitObservation={programme:string;candidate:{name:string;kinds:PlannerRow['kinds'];directoryId:string|null};confirmations:number;revision:number|null;ruleId?:string|null;ruleRevision?:number|null;state?:string|null};
export const canonicalRecipe=(kinds:readonly PlannerRow['kinds'][number][])=>plannerKinds.filter(kind=>kinds.includes(kind));
export const sameRecipe=(a:PlannerRow['kinds'],b:PlannerRow['kinds'])=>fingerprint(canonicalRecipe(a))===fingerprint(canonicalRecipe(b));

export function recipeEditorContext(row:PlannerRow,records:readonly PlannerRecord<ProgrammeRule>[]){
 const unique=new Map<string,PlannerRecord<ProgrammeRule>>();
 for(const record of records){
  if(!record.id||!Number.isInteger(record.revision)||record.revision<1||!ruleSchema.safeParse(record.data).success)throw Error('Les recettes reçues sont incomplètes. Relisez-les avant de mémoriser.');
  const prior=unique.get(record.id);
  if(prior&&fingerprint(prior)!==fingerprint(record))throw Error('Deux versions contradictoires de la même règle ont été reçues.');
  if(!record.archived)unique.set(record.id,record);
 }
 const rules=[...unique.values()],index=programmeRules(rules),resolved=resolveProgrammeRule(row,index);
 const family=normalized(row.title),families=rules.filter(rule=>rule.data.family===family);
 return {rules,resolved,families,key:fingerprint(rules.map(rule=>({id:rule.id,revision:rule.revision,data:rule.data})).sort((a,b)=>a.id.localeCompare(b.id)))};
}

/** Explicit scope API. Legacy recipeMemoryRule(false) keeps its old meaning.
 * This helper alone may intentionally remove an existing family association. */
export function explicitRecipeMemory(row:PlannerRow,kinds:PlannerRow['kinds'],scope:RecipeScope,records:readonly PlannerRecord<ProgrammeRule>[]){
 if(!row.included||row.sourceRemoved||!normalized(row.title))throw Error('Choisissez un programme retenu avec un titre.');
 const context=recipeEditorContext(row,records),{resolved,families}=context;
 if(resolved.conflict)throw Error('Des règles contradictoires existent. Aucune recette partagée ne sera remplacée.');
 if(scope==='programme'&&families.length>1)throw Error('Plusieurs règles portent cette émission. Leur regroupement doit être vérifié avant toute modification partagée.');
 const prior=scope==='programme'?(families[0]??resolved.exact):resolved.exact;
 const known=prior?.data??resolved.data,programme=prior?.data.programme??programmeIdentity(row);
 const data:ProgrammeRule={kind:'rule',name:prior?.data.name??row.title.slice(0,120),programme,keywords:known?.keywords??row.title,directoryId:known?.directoryId??null,
  preferredPath:prior?.data.preferredPath??null,kinds:canonicalRecipe(kinds),...(scope==='programme'?{family:normalized(row.title)}:{})};
 return {prior:prior??null,data,contextKey:context.key,narrows:!!prior?.data.family&&scope==='episode',inherited:!prior&&!!resolved.inherited,exactRemainsPrior:scope==='programme'&&!!resolved.exact&&resolved.exact.id!==prior?.id};
}

export function editedRecipeChange(row:PlannerRow,kinds:PlannerRow['kinds']):RecipeChange{
 return {rowId:row.id,programme:programmeIdentity(row),title:row.title,before:canonicalRecipe(row.kinds),after:canonicalRecipe(kinds)};
}
