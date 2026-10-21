import type {BroadcastField,ProjectData} from './domain';

// The opening passage of the existing BA accompaniment, not a new soundtrack.
export const CE_SOIR_SIGNATURE_URL='/library/v1.7.0/BTV_BA_1P/sourceassets/BTV_BA1P -23LUFS.wav';
const section={'x-section':'Son · signature d’ouverture'};
export const ceSoirAudioFields:Record<string,BroadcastField>={
  _audio_signature_enabled:{...section,type:'boolean',default:false,title:'Signature BTV · ouverture'},
  _audio_signature_url:{...section,type:'string',default:CE_SOIR_SIGNATURE_URL,'x-control':'audio',title:'Fichier de la signature'},
  _audio_signature_volume:{...section,type:'number',default:1,minimum:0,maximum:1,title:'Volume de la signature'},
};
export const ceSoirSignatureKeys=Object.keys(ceSoirAudioFields);
export function ceSoirSignaturePreset():ProjectData{return {_audio_signature_enabled:true,_audio_signature_url:CE_SOIR_SIGNATURE_URL,_audio_signature_volume:1};}
/** Reuse the same bounded audio loader/player as the voice, with its own track.
 * The native BA opening occupies 0–9.68 s and is played once, never at OUT. */
export function ceSoirSignatureData(data:ProjectData):ProjectData{return {
  _audio_voice_enabled:data._audio_signature_enabled??false,
  _audio_voice_url:data._audio_signature_url??CE_SOIR_SIGNATURE_URL,
  _audio_voice_volume:data._audio_signature_volume??1,
  _audio_voice_start_seconds:0,_audio_voice_end_seconds:9.68,_audio_voice_delay_seconds:0,
};}
