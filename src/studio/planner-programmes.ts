import {normalized} from './day-planner-model';
import type {Plan,PlannerRow} from './day-planner-model';
import type {Programme} from './channel-model';

export interface ProgrammeMatch {
 rowId:string;rowTitle:string;status:'matched'|'ambiguous'|'unmatched';
 candidates:Programme[];before:PlannerRow;after:PlannerRow|null;
 reason:string;
}
/** Exact aliases only: a similar title is not evidence of the same programme.
 * Episode/date/media selection never becomes a shared programme default. */
export function reviewProgrammeMatches(plan:Plan,programmes:Programme[]):ProgrammeMatch[]{
 const available=programmes.filter(p=>!p.archived);
 return plan.rows.filter(row=>!row.sourceRemoved).map(row=>{
  const candidates=available.filter(p=>row.programmeId?p.id===row.programmeId:[p.name,...p.data.aliases].some(name=>normalized(name)===normalized(row.title)));
  const before=structuredClone(row);
  if(candidates.length!==1)return{rowId:row.id,rowTitle:row.title,status:candidates.length?'ambiguous':'unmatched',candidates,before,after:null,reason:candidates.length?'Plusieurs fiches correspondent. Aucun choix automatique.':'Aucune fiche identifiée avec certitude.'};
  const p=candidates[0],after:PlannerRow={...before,programmeId:p.id,programmeRevision:p.revision,title:p.data.name,category:p.data.category||before.category,kinds:p.data.recurring||p.data.recipe.length?[...p.data.recipe]:before.kinds};
  return{rowId:row.id,rowTitle:row.title,status:'matched',candidates,before,after,reason:p.data.recurring?'Émission récurrente : réutilisez son habillage validé ; seuls les livrables de sa recette sont proposés.':row.programmeId?'Fiche déjà liée à cette entrée.':'Titre ou variante de nom exacte.'};
 });
}
export function applyProgrammeMatches(plan:Plan,matches:ProgrammeMatch[],selectedRowIds:string[]):Plan{
 const selected=new Set(selectedRowIds),byId=new Map(matches.map(m=>[m.rowId,m]));
 return{...plan,rows:plan.rows.map(row=>{
  const match=byId.get(row.id);
  // A delayed dialog must never replace edits made after its review opened.
  if(!selected.has(row.id)||!match?.after||match.status!=='matched'||JSON.stringify(row)!==JSON.stringify(match.before))return row;
  return structuredClone(match.after);
 })};
}
