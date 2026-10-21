import type {BroadcastTemplate,ProjectData} from './domain';
import {baSocialDirect,baSocialSelectedData} from './ba-social-direct';
import {ceSoirBackground} from './ce-soir-background';

export function popupBackgroundVisible(data:ProjectData):boolean {
  if(data._background_visible===false)return false;
  const source=data._media_background_url;
  // Omitted is not empty: partial/default payloads still use the model defaults.
  if(source===undefined)return true;
  if(typeof source==='object'?source.url:source)return true;
  try{const clips=JSON.parse(String(data._media_background_sequence||'[]'));return !Array.isArray(clips)||clips.length>0;}catch{return true;}
}

export function mediaFieldInactive(data:ProjectData,key:string):boolean {
  if(key==='_studio_overlay_logo_url'&&![true,'true',1,'1'].includes(data._studio_overlay_logo_enabled as string|number|boolean))return true;
  if(key.startsWith('_media_background_')&&data._background_visible===false)return true;
  if(key.startsWith('_media_background_')&&ceSoirBackground(data))return true;
  if(/^_media_programme_[12]_/.test(key)&&data._media_mode==='external')return true;
  const audio=key.match(/^(_audio(?:_bed|_voice|_signature)?)_/);
  return !!audio&&data[`${audio[1]}_enabled`]===false;
}

// Runtime copy only: keep the operator's saved alternatives, but do not fetch
// disabled tracks or a single source replaced by an explicit playlist.
export function selectedMediaData(template:BroadcastTemplate,data:ProjectData):ProjectData {
  const next=structuredClone(baSocialDirect(template.id,data)?baSocialSelectedData(data):data);
  if(template.id==='BTV_PopUp'&&!popupBackgroundVisible(data))next._background_visible=false;
  if(template.id==='BTV_Ce_Soir'&&ceSoirBackground(data)&&next._out_mode==='media_end'&&next._out_media_track==='background')next._out_mode='duration';
  for(const key of Object.keys(template.fields)){
    if(!key.endsWith('_url')&&!key.endsWith('_sequence'))continue;
    if(mediaFieldInactive(next,key)){
      next[key]=key.endsWith('_sequence')?'[]':'';
      continue;
    }
    if(key.startsWith('_media_')&&key.endsWith('_url')){
      const sequence=data[key.replace(/_url$/,'_sequence')];
      try{const clips=JSON.parse(String(sequence));if(Array.isArray(clips)&&clips.length)next[key]='';}catch{/* The normal validator reports the malformed list. */}
    }
  }
  return next;
}

export function sequenceLimit(template:BroadcastTemplate){
  return ['BTV_Ce_Soir','BTV_Relais_Antenne','BTV_Passerelle_Replay'].includes(template.id)?8:20;
}
