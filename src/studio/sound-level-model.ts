import type {BroadcastTemplate} from './domain';

export const SILENT_SLIDER_DB=-60;
export function soundFields(template:BroadcastTemplate){return Object.entries(template.fields).filter(([key,field])=>field.type==='boolean'&&/^(?:_media_.*_audio|_audio(?:_.*)?)_enabled$/.test(key));}
export function soundTracks(template:BroadcastTemplate){return soundFields(template).map(([key,field])=>{
  const prefix=key.replace(/_enabled$/,'').replace(/_audio$/,'');
  // _audio_enabled is the native model bed, not a media stream.
  const base=key==='_audio_enabled'?'_audio':prefix;
  const level=[`${base}_gain`,`${base}_volume`].find(name=>template.fields[name]?.type==='number');
  const maximum=level?Number(template.fields[level].maximum??1):1;
  return {key,field,level,maximum};
});}
export function soundFieldNames(template:BroadcastTemplate){return [...soundTracks(template).flatMap(track=>track.level?[track.key,track.level]:[track.key]),...(template.id==='BTV_Ce_Soir'?['_audio_signature_url']:[])];}
export function gainToDb(gain:number){return gain>0?20*Math.log10(gain):-Infinity;}
export function dbToGain(db:number,maximum:number){if(!Number.isFinite(db)||!Number.isFinite(maximum)||maximum<=0)throw Error('Niveau sonore invalide.');return db<=SILENT_SLIDER_DB?0:Math.min(maximum,10**(db/20));}
export function gainLabel(gain:number){const db=gainToDb(gain);return Number.isFinite(db)?`${db>0?'+':''}${db.toFixed(1)} dB`:'Silence';}
