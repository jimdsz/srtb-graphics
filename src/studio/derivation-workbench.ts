import {isMediaField,isSequenceField,validateProjectData} from './domain';
import type {BroadcastTemplate,ProjectData,Project} from './domain';
import {derivationRequestSchema} from './derivation-model';
import type {DerivationTarget,DerivationRequest,DerivationAnnouncement} from './derivation-model';
import type {VideoOptions} from './video/export';
import {TIMINGS} from './video/timeline';

/** A UI refusal, never an asset grant. Existing server validators remain final. */
export function foreignLibraryFields(template:BroadcastTemplate,data:ProjectData):string[]{
  const own=`/library/v${template.libraryVersion}/${template.id}/`,found:string[]=[];
  const foreign=(value:unknown)=>{const url=typeof value==='string'?value:value&&typeof value==='object'&&'url'in value?String(value.url):'';return url.startsWith('/library/')&&!url.startsWith(own);};
  for(const [key,field]of Object.entries(template.fields)){
    if(isMediaField(key,field)&&foreign(data[key]))found.push(key);
    if(isSequenceField(key,field))try{if((JSON.parse(String(data[key]||'[]')) as {url:unknown}[]).some(clip=>foreign(clip.url)))found.push(key);}catch{/* The normal validator reports malformed sequences. */}
  }
  return [...new Set(found)];
}
export const foreignReuseNotice='Ce projet lié utilise des ressources du modèle source. La duplication et les favoris d’équipe ne transportent pas cette provenance : remplacez ces ressources par vos fichiers locaux ou des médias partagés avant de le réutiliser ainsi. Le projet lié reste modifiable et exportable.';

export function derivationIntent(template:BroadcastTemplate,project:Project,title:string,data:ProjectData,name:string,targets:DerivationTarget[],replayUrl:string,requestId:string,announcements:DerivationAnnouncement[]=[]):DerivationRequest{
  return structuredClone(derivationRequestSchema.parse({requestId,name,sourceRevision:project.revision,sourceTitle:title,sourceData:validateProjectData(template,data),targets,...(targets.includes('replay')?{replayUrl}: {}),...(announcements.length?{announcements}:{})}));
}
export function defaultDerivationOptions(project:Pick<Project,'template_id'|'data'>):VideoOptions{
  const programme=['BTV_BA_1P','BTV_Renvoi','BTV_Evenement','BTV_Semainier'].includes(project.template_id);
  return {format:programme?'mp4':'mov',audio:programme,removeBackground:false,background:'#000000',manualOut:Number(project.data._out_duration_seconds||TIMINGS[project.template_id]?.stop||12)};
}
