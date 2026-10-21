import type {BroadcastTemplate,FieldValue,ProjectData} from './domain';
import {replaceMedia} from './media-trim';
import {baVoiceDucking,baVoicePlacement} from './ba-voice-placement';
import type {BAVoicePlacementMode} from './ba-voice-placement';
import {baSocialDirect} from './ba-social-direct';

export const BA_CARTON_START=64.8;
export function voiceTimingKeys(template:BroadcastTemplate){
  if(!template.fields._audio_voice_url)return;
  const ba=template.id==='BTV_BA_1P',start=ba?'_audio_voice_in_seconds':'_audio_voice_start_seconds',end=ba?'_audio_voice_out_seconds':'_audio_voice_end_seconds';
  if(!template.fields[start]||!template.fields[end])return;
  return {ba,start,end,placement:ba?['_audio_voice_intro_offset_seconds','_audio_voice_outro_offset_seconds']:['_audio_voice_delay_seconds']};
}
export function voiceTimingFieldNames(template:BroadcastTemplate){const keys=voiceTimingKeys(template);return keys?['_audio_voice_url',keys.start,keys.end,...keys.placement]:[];}
export function voiceSourcePatch(template:BroadcastTemplate,data:ProjectData,value:FieldValue):ProjectData{
  const url=(value:FieldValue|undefined)=>typeof value==='object'?value.url:String(value??'');
  if(url(value)===url(data._audio_voice_url??template.fields._audio_voice_url?.default))return {_audio_voice_url:value};
  return {...replaceMedia('_audio_voice_url',value,template.fields),...(voiceTimingKeys(template)?.ba&&data._studio_ba_voice_fit==='fit-complete'?{_studio_ba_voice_fit:'manual'}:{})};
}
export function voiceTimingWarning(template:BroadcastTemplate,data:ProjectData){
  const keys=voiceTimingKeys(template);if(!keys?.ba)return '';
  const start=Number(data[keys.start]??0),end=Number(data[keys.end]??0);
  if(end===0)return 'Repère OUT de la voix non défini pour la BA. Utilisez le fichier entier (durée décodée) ou renseignez la fin du passage avant d’activer la piste. La durée du lecteur ne valide pas ce repère.';
  if(data._audio_voice_enabled!==true)return '';
  if(baSocialDirect(template.id,data)){
    const delay=Number(data[keys.placement[0]]??0);
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end-start<.04||!Number.isFinite(delay)||delay<0)return 'Choisissez un passage vocal d’au moins 0,04 s et un départ positif ou nul.';
    if(data._out_mode==='duration'&&delay+end-start>Number(data._out_duration_seconds)+1e-9)return 'La voix dépasse la fin des extraits. Déplacez son départ ou allongez la durée ; aucune coupe automatique.';
    return '';
  }
  try{
    baVoicePlacement(end-start,String(data._studio_ba_voice_fit||'source') as BAVoicePlacementMode,{intro:Number(data[keys.placement[0]]),outro:Number(data[keys.placement[1]])});
    baVoiceDucking(data);return '';
  }catch(cause){return cause instanceof Error?cause.message:String(cause);}
}
export function voiceRangePatch(template:BroadcastTemplate,data:ProjectData,range:Partial<{start:number;end:number}>):ProjectData{
  const keys=voiceTimingKeys(template);if(!keys)throw Error('Ce modèle ne possède pas de passage vocal réglable.');
  for(const value of Object.values(range))if(!Number.isFinite(value)||value<0)throw Error('Le repère vocal doit être une durée positive ou nulle.');
  return {...range.start!==undefined?{[keys.start]:range.start}:{},...range.end!==undefined?{[keys.end]:range.end}:{},...(keys.ba&&data._studio_ba_voice_fit==='fit-complete'?{_studio_ba_voice_fit:'manual'}:{})};
}
/** UI carton seconds are relative to OUT; the engine stores its source timeline. */
export function voicePlacementPatch(template:BroadcastTemplate,which:'intro'|'outro'|'delay',seconds:number):ProjectData{
  const keys=voiceTimingKeys(template);if(!keys||!Number.isFinite(seconds)||seconds<0)throw Error('Le départ vocal doit être une durée positive ou nulle.');
  if(keys.ba){if(which==='delay')throw Error('Choisissez le départ intro ou carton de la BA.');return {[which==='intro'?keys.placement[0]:keys.placement[1]]:which==='outro'?BA_CARTON_START+seconds:seconds,_studio_ba_voice_fit:'manual'};}
  if(which!=='delay')throw Error('Ce modèle possède un seul départ vocal.');
  return {[keys.placement[0]]:seconds};
}
