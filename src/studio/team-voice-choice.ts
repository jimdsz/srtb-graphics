import type {BroadcastTemplate,MediaAsset,ProjectData} from './domain';
import {baVoicePlacement} from './ba-voice-placement';
import {voiceSourcePatch,voiceRangePatch} from './voice-timing-model';
import {baSocialDirect} from './ba-social-direct';
export function sharedVoiceSource(asset:MediaAsset){return {url:`/api/graphics/media/${asset.id}/content`,name:asset.name,mimeType:asset.mime_type};}
export function teamVoiceLabel(name:string){return name.replace(/\.[^.]+$/,'').replace(/^aujourdh[’']?ui$/i,"Aujourd’hui");}
export function teamVoiceActivation(template:BroadcastTemplate,data:ProjectData,duration:number):ProjectData{
 if(!Number.isFinite(duration)||duration<.04||duration>600)throw Error('Durée de voix incompatible.');
 const patch:ProjectData={...voiceRangePatch(template,data,{start:0,end:duration}),_audio_voice_enabled:true};
 if(baSocialDirect(template.id,data)){
  Object.assign(patch,{_studio_ba_voice_fit:'manual',_audio_voice_intro_offset_seconds:0});
 }else if(template.id==='BTV_BA_1P'){
  const p=baVoicePlacement(duration,'fit-complete');
  Object.assign(patch,{_studio_ba_voice_fit:'fit-complete',_audio_voice_intro_offset_seconds:p.intro,_audio_voice_outro_offset_seconds:p.outro});
 }
 return patch;
}
export function chooseSharedVoice(template:BroadcastTemplate,data:ProjectData,asset:MediaAsset){
 if(asset.status!=='ready'||!asset.mime_type.startsWith('audio/'))throw Error('Choisissez une voix audio partagée et prête.');
 return {...voiceSourcePatch(template,data,sharedVoiceSource(asset)),_audio_voice_enabled:false};
}
