import type {Plan,PlannerRow} from './day-planner-model';
import type {ProfileAsset} from './preparation-profile-model';
import {profileAssetSchema} from './preparation-profile-model';
import {logoImageMime} from './planner-logo-selection';
import {plannerRecoveryFingerprint as fingerprint} from './planner-local-recovery-model';

/** A local review, never a shared rule or permission to decode/upload an image. */
export interface PlannerLogoReview {
 source:string;sourceHash:string;sourceRowId:string;logo:ProfileAsset|null;rows:PlannerRow[];
}
export interface PlannerLogoChange {before:PlannerRow;after:PlannerRow}
export interface PlannerLogoResult {plan:Plan;changes:PlannerLogoChange[];skipped:string[];sourceChanged:boolean}
const retained=(row:PlannerRow)=>row.included&&!row.sourceRemoved;
const same=(a:unknown,b:unknown)=>fingerprint(a)===fingerprint(b);
const sameLink=(a:PlannerRow,b:PlannerRow)=>a.id===b.id&&a.programmeId===b.programmeId&&a.programmeRevision===b.programmeRevision;
const sameSource=(plan:Plan,review:PlannerLogoReview)=>plan.source===review.source&&plan.sourceHash===review.sourceHash;

export function reviewPlannerLogo(plan:Plan,rowId:string,logo:ProfileAsset|null):PlannerLogoReview {
 if(plan.rows.length>600||new Set(plan.rows.map(row=>row.id)).size!==plan.rows.length)throw Error('Les lignes de cette préparation doivent être relues avant de reprendre un logo.');
 const source=plan.rows.find(row=>row.id===rowId);
 if(!source||!retained(source))throw Error('Cette ligne n’est plus retenue dans la préparation.');
 if(logo){profileAssetSchema.parse(logo);if(!logoImageMime(logo.mimeType))throw Error('Choisissez une image PNG, JPEG ou WebP vérifiée.');}
 // A removal is deliberately never propagated. Names cannot establish identity.
 const others=logo&&source.programmeId?plan.rows.filter(row=>row.id!==rowId&&retained(row)&&row.programmeId===source.programmeId):[];
 return structuredClone({source:plan.source,sourceHash:plan.sourceHash,sourceRowId:rowId,logo,rows:[source,...others]});
}

/** Compare the complete rows that were shown. Any concurrent change is kept,
 * including an unchanged-looking programme name with a different durable ID. */
export function applyPlannerLogoReview(plan:Plan,review:PlannerLogoReview,selectedIds:readonly string[],replaceIds:readonly string[]=[]):PlannerLogoResult {
 const selected=new Set(selectedIds),replacements=new Set(replaceIds),changes:PlannerLogoChange[]=[],skipped:string[]=[];
 const original=review.rows.find(row=>row.id===review.sourceRowId),source=plan.rows.find(row=>row.id===review.sourceRowId);
 if(!sameSource(plan,review)||!original||!source||!retained(source)||!same(original,source)||new Set(plan.rows.map(row=>row.id)).size!==plan.rows.length){
  return {plan,changes,skipped:[...selected],sourceChanged:true};
 }
 const candidates=new Map(review.rows.map(row=>[row.id,row]));
 const rows=plan.rows.map(row=>{
  if(!selected.has(row.id))return row;
  const before=candidates.get(row.id),isSource=row.id===review.sourceRowId;
  if(!before||!retained(row)||!same(before,row)||(!isSource&&(!review.logo||!original.programmeId||row.programmeId!==original.programmeId))||(!isSource&&row.logo&&!replacements.has(row.id))){skipped.push(row.id);return row;}
  if(same(row.logo??null,review.logo))return row;
  const after={...row,logo:review.logo?structuredClone(review.logo):null};
  changes.push(structuredClone({before:row,after}));return after;
 });
 for(const id of selected)if(!plan.rows.some(row=>row.id===id))skipped.push(id);
 return {plan:changes.length?{...plan,rows}:plan,changes,skipped,sourceChanged:false};
}

/** Undo only our logo value. Later episode/text/media/voice edits are merged,
 * never restored from a snapshot. A changed logo/link/reimport stays intact. */
export function undoPlannerLogoChanges(plan:Plan,review:PlannerLogoReview,applied:readonly PlannerLogoChange[]):PlannerLogoResult {
 const changes:PlannerLogoChange[]=[],skipped:string[]=[];
 if(!sameSource(plan,review))return {plan,changes,skipped:applied.map(change=>change.after.id),sourceChanged:true};
 const expected=new Map(applied.map(change=>[change.after.id,change]));
 const rows=plan.rows.map(row=>{
  const change=expected.get(row.id);if(!change)return row;
  if(!retained(row)||!sameLink(row,change.after)||!same(row.logo,change.after.logo)){skipped.push(row.id);return row;}
  const restored={...row};
  if(Object.hasOwn(change.before,'logo'))restored.logo=change.before.logo?structuredClone(change.before.logo):change.before.logo;
  else delete restored.logo;
  changes.push(structuredClone({before:row,after:restored}));return restored;
 });
 for(const id of expected.keys())if(!plan.rows.some(row=>row.id===id))skipped.push(id);
 return {plan:changes.length?{...plan,rows}:plan,changes,skipped,sourceChanged:false};
}
