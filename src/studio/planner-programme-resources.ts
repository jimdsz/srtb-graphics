import type {Programme} from './channel-model';
import type {PlannerRow} from './day-planner-model';
import type {PreparationProfile,VoiceData} from './preparation-profile-model';
import {voiceDataSchema,sharedProfileAsset} from './preparation-profile-model';
import {normalizeAnnouncement} from './derivation-announcements';
import {searchRead} from './planner-team-search';

export type ProgrammeResources={programme:Programme|null;warning:string};
/** Read only an explicitly linked programme. A later shared revision is not
 * silently substituted into a reviewed preparation. No disk/media IO here. */
export async function readProgrammeResources(row:Pick<PlannerRow,'programmeId'|'programmeRevision'>,get:(id:string,signal:AbortSignal)=>Promise<Programme>,signal:AbortSignal):Promise<ProgrammeResources>{
 if(!row.programmeId)return {programme:null,warning:''};
 try{
  const p=await searchRead(s=>get(row.programmeId!,s),signal,10000,'La fiche émission ne répond pas. Vos choix restent disponibles.');
  signal.throwIfAborted();
  if(p.id!==row.programmeId||p.archived)throw Error('Fiche indisponible.');
  if(p.revision!==row.programmeRevision)return {programme:null,warning:'La fiche émission a changé. Confirmez à nouveau son rapprochement pour utiliser ses nouvelles ressources.'};
  return {programme:p,warning:''};
 }catch(error){
  signal.throwIfAborted();
  if([401,403].includes(Number((error as {status?:number})?.status)))throw error;
  return {programme:null,warning:'Ressources de la fiche indisponibles. Choisissez vos fichiers ou réessayez ; aucun choix existant ne change.'};
 }
}
export function programmeVoiceProposal(profile:PreparationProfile,cue:string):VoiceData|null{
 if(profile.kind!=='voice'||profile.archived||!profile.validated_by||!profile.validated_at)return null;
 const result=voiceDataSchema.safeParse(profile.data);if(!result.success)return null;
 const data=result.data;
 // A usual voice may say Tuesday, while this edition is for Wednesday.
 // Never re-label that recording or treat an episode-local file as shared.
 if(!sharedProfileAsset.test(data.source.url)||data.cue.kind!=='announcement'||normalizeAnnouncement(data.cue.value)!==normalizeAnnouncement(cue))return null;
 return data;
}
