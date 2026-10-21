import {normalized,planSchema} from './day-planner-model';
import type {Plan,PlannerRow} from './day-planner-model';
const fields=['airDate','broadcastDate','time','duration','title','subtitle','category'] as const;
type Field=typeof fields[number];
export interface ConductorChange {kind:'added'|'removed'|'changed';rowId:string;title:string;before?:PlannerRow;after?:PlannerRow;fields:Field[];preserved:Field[]}
export interface ConductorDiff {plan:Plan;changes:ConductorChange[];sameSource:boolean}
const key=(r:PlannerRow)=>`${r.broadcastDate}|${normalized(r.title)}|${normalized(r.subtitle)}`;
/** Match only unambiguous programme/episode occurrences. Cell positions are not
 * identities: inserting a row in Excel must never swap two programmes' media. */
export function compareConductors(current:Plan,incoming:Plan):ConductorDiff{
 if(current.sourceHash===incoming.sourceHash)return {plan:current,changes:[],sameSource:true};
 const baseline=current.sourceRows??current.rows.filter(r=>!r.sourceRemoved),unused=new Set(baseline.map(r=>r.id));
 const result=new Map(current.rows.map(r=>[r.id,structuredClone(r)])),sources:PlannerRow[]=[],changes:ConductorChange[]=[];
 for(const [index,fresh]of incoming.rows.entries()){
  const candidates=baseline.filter(r=>unused.has(r.id)&&key(r)===key(fresh));
  const exact=candidates.filter(r=>r.time===fresh.time&&r.airDate===fresh.airDate);
  const original=candidates.length===1?candidates[0]:exact.length===1?exact[0]:undefined;
  if(!original){
   const id=`import:${incoming.sourceHash.slice(0,24)}:${index}`,row={...structuredClone(fresh),id};
   result.set(id,row);sources.push(structuredClone(row));changes.push({kind:'added',rowId:id,title:row.title,after:row,fields:[],preserved:[]});continue;
  }
  unused.delete(original.id);const edited=result.get(original.id)!;const changed=fields.filter(f=>original[f]!==fresh[f]),preserved=changed.filter(f=>edited[f]!==original[f]);
  // Keep media, trim, voices, recipes, title edits and every private project.
  const merged={...edited,raw:fresh.raw,sheet:fresh.sheet,cell:fresh.cell,sourceRemoved:false};
  for(const field of changed)if(!preserved.includes(field))Object.assign(merged,{[field]:fresh[field]});
  result.set(original.id,merged);sources.push({...structuredClone(fresh),id:original.id});
  if(changed.length)changes.push({kind:'changed',rowId:original.id,title:edited.title,before:original,after:fresh,fields:changed,preserved});
 }
 for(const id of unused){const old=result.get(id);if(!old)continue;result.set(id,{...old,included:false,sourceRemoved:true,issues:[...old.issues,'Retiré du nouveau conducteur. Les projets existants sont conservés.'].slice(-15)});changes.push({kind:'removed',rowId:id,title:old.title,before:old,fields:[],preserved:[]});}
 const rows=[...result.values()],weekly=current.weekly?{...current.weekly,rowIds:current.weekly.rowIds.filter(id=>rows.some(r=>r.id===id&&r.included))}:undefined;
 return {plan:planSchema.parse({...current,source:incoming.source,sourceHash:incoming.sourceHash,rows,sourceRows:sources,...(weekly?{weekly}:{})}),changes,sameSource:false};
}
