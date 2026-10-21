import {normalized} from './day-planner-model';
import type {Plan,PlannerRow} from './day-planner-model';
import type {Programme} from './channel-model';
import type {ProgrammeMatch} from './planner-programmes';
import {applyProgrammeMatches} from './planner-programmes';
import {searchRead} from './planner-team-search';

export type ProgrammeBatchMode='link'|'copy';
export interface ProgrammeBatchMatch extends Omit<ProgrammeMatch,'status'>{status:'ready'|'unchanged'|'ambiguous'|'unmatched'|'stale'}
export interface ProgrammeBatchGroup {programme:Programme;matches:ProgrammeBatchMatch[]}
export interface ProgrammeBatchSkipped {rowId:string;rowTitle:string;reason:string}
type Page={programmes:Programme[];next:string|null};
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const LIMIT=10000;

/** A truncated catalogue cannot establish that an alias is unique. Read all
 * pages or reject the entire review, including after a channel transition. */
export async function readProgrammeCatalogue(load:(cursor:string|null,signal:AbortSignal)=>Promise<Page>,signal:AbortSignal,channel:string,currentChannel:()=>string):Promise<Programme[]>{
 const rows:Programme[]=[],ids=new Set<string>(),cursors=new Set<string>();let cursor:string|null=null,pages=0;
 const guard=()=>{signal.throwIfAborted();if(currentChannel()!==channel)throw Error('La chaîne a changé. Fermez cette revue et recommencez.');};
 do{
  guard();if(++pages>101)throw Error('La liste des fiches est trop grande ou instable. Aucune correspondance n’a été appliquée.');
  const page=await searchRead(s=>load(cursor,s),signal,15000,'La liste des fiches ne répond pas. Réessayez ; votre préparation reste inchangée.');guard();
  if(!page||!Array.isArray(page.programmes)||page.programmes.length>100||(page.next!==null&&typeof page.next!=='string')||(!page.programmes.length&&page.next!==null))throw Error('La liste des fiches est incomplète. Réessayez.');
  for(const p of page.programmes){
   if(!p||typeof p.id!=='string'||!p.id||p.channel_id!==channel||!Number.isInteger(p.revision)||p.revision<1||ids.has(p.id))throw Error('La liste des fiches a changé. Réessayez depuis le début.');
   ids.add(p.id);rows.push(p);
  }
  if(rows.length>LIMIT||(rows.length===LIMIT&&page.next!==null))throw Error('Plus de 10 000 fiches : la revue groupée est suspendue. Aucune liste tronquée n’est utilisée.');
  cursor=page.next;
  if(cursor!==null){if(!cursor||cursors.has(cursor))throw Error('La pagination des fiches a changé. Réessayez depuis le début.');cursors.add(cursor);}
 }while(cursor!==null);
 return rows;
}

export function reviewProgrammeBatch(plan:Plan,programmes:Programme[],mode:ProgrammeBatchMode):ProgrammeBatchMatch[]{
 const names=new Map<string,Programme[]>(),ids=new Map<string,Programme[]>();
 for(const p of programmes){
  if(p.archived)continue;
  ids.set(p.id,[...(ids.get(p.id)||[]),p]);
  for(const key of new Set([p.name,...p.data.aliases].map(normalized).filter(Boolean)))names.set(key,[...(names.get(key)||[]),p]);
 }
 return plan.rows.filter(row=>!row.sourceRemoved).map(row=>{
  const candidates=(row.programmeId?ids.get(row.programmeId):names.get(normalized(row.title)))||[];
  const before=structuredClone(row),base={rowId:row.id,rowTitle:row.title,candidates,before,after:null};
  if(candidates.length!==1)return {...base,status:candidates.length?'ambiguous':'unmatched',reason:candidates.length?'Plusieurs fiches correspondent. Aucun choix automatique.':'Aucune correspondance exacte et unique.'};
  const p=candidates[0];
  if(row.programmeId&&row.programmeRevision!==undefined&&row.programmeRevision>p.revision)return {...base,status:'stale',reason:'La fiche reçue est plus ancienne que la révision déjà liée. Aucun retour en arrière.'};
  const after:PlannerRow={...before,programmeId:p.id,programmeRevision:p.revision,...(mode==='copy'?{title:p.data.name,category:p.data.category||before.category,kinds:p.data.recurring||p.data.recipe.length?[...p.data.recipe]:before.kinds}:{})};
  return {...base,after,status:equal(before,after)?'unchanged':'ready',reason:row.programmeId?'Fiche déjà liée à cette ligne.':'Titre ou variante de nom exacte.'};
 });
}

export function groupProgrammeBatch(matches:ProgrammeBatchMatch[]):ProgrammeBatchGroup[]{
 const groups=new Map<string,ProgrammeBatchGroup>();
 for(const match of matches){
  if(!['ready','unchanged'].includes(match.status)||match.candidates.length!==1)continue;
  const programme=match.candidates[0],key=programme.id;
  let group=groups.get(key);if(!group){group={programme,matches:[]};groups.set(key,group);}group.matches.push(match);
 }
 return [...groups.values()];
}

/** Re-read before presenting the final review. A changed shared record is
 * excluded, never silently substituted by its newer (or older) revision. */
export function refreshProgrammeBatch(plan:Plan,matches:ProgrammeBatchMatch[],selected:string[],programmes:Programme[],mode:ProgrammeBatchMode){
 const current=new Map(plan.rows.map(row=>[row.id,row])),fresh=new Map(reviewProgrammeBatch(plan,programmes,mode).map(match=>[match.rowId,match]));
 const wanted=new Set(selected),valid:ProgrammeBatchMatch[]=[],skipped:ProgrammeBatchSkipped[]=[];
 for(const match of matches){
  if(!wanted.has(match.rowId)||match.status!=='ready')continue;
  const row=current.get(match.rowId),next=fresh.get(match.rowId);
  const reason=!row||!equal(row,match.before)?'La ligne a été retouchée depuis la sélection. Vos choix sont conservés.':!next||next.status!=='ready'||!equal(next.candidates,match.candidates)||!equal(next.after,match.after)?'La fiche a changé depuis la sélection. Relancez les correspondances.':'';
  if(reason)skipped.push({rowId:match.rowId,rowTitle:match.rowTitle,reason});else valid.push(match);
 }
 return {matches:valid,skipped};
}

export function currentProgrammeBatch(plan:Plan,matches:ProgrammeBatchMatch[]){
 const rows=new Map(plan.rows.map(row=>[row.id,row]));
 const valid:ProgrammeBatchMatch[]=[],skipped:ProgrammeBatchSkipped[]=[];
 for(const match of matches){
  if(match.status==='ready'&&equal(rows.get(match.rowId),match.before))valid.push(match);
  else skipped.push({rowId:match.rowId,rowTitle:match.rowTitle,reason:'La ligne a été retouchée depuis la revue. Vos choix sont conservés.'});
 }
 return {matches:valid,skipped};
}

export function applyProgrammeBatch(plan:Plan,matches:ProgrammeBatchMatch[]){
 const ready=currentProgrammeBatch(plan,matches).matches;
 const next=applyProgrammeMatches(plan,ready.map(match=>({...match,status:'matched'})),ready.map(match=>match.rowId));
 return {plan:next,changed:ready.length};
}
