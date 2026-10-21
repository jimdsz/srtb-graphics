import type {BroadcastField} from './domain';

/** The two BA engines already own their voice tracks; never double them. */
export const supplementalVoiceTemplates = ['BTV_PopUp','BTV_BA_TDS_SUIVI_DE','BTV_Ce_Soir','BTV_Relais_Antenne','BTV_Passerelle_Replay','BTV_Renvoi','BTV_Evenement','BTV_Semainier'] as const;
export function hasSupplementalVoice(template:{id:string;libraryVersion:string}){
  return template.libraryVersion==='1.7.0' && (supplementalVoiceTemplates as readonly string[]).includes(template.id);
}

/** Additive defaults keep existing projects silent and preserve music/media audio. */
export function voiceFields(id:string):Record<string,BroadcastField>{
  if(!(supplementalVoiceTemplates as readonly string[]).includes(id))return {};
  const section={'x-section':'Son · voix off'};
  return {
    _audio_voice_enabled:{...section,type:'boolean',default:false,title:'Activer la voix off'},
    _audio_voice_url:{...section,type:'string','x-control':'audio',default:'',title:'Fichier de voix off',description:'Choisir une voix partagée ou un fichier local. Cette piste est indépendante de la musique et du son des vidéos.'},
    _audio_voice_start_seconds:{...section,type:'number',default:0,minimum:0,maximum:86400,title:'Début du passage dans le fichier (s)'},
    _audio_voice_end_seconds:{...section,type:'number',default:0,minimum:0,maximum:86400,title:'Fin du passage dans le fichier (s)',description:'0 utilise la fin du fichier ; le sélecteur d’extrait permet de choisir un passage précis.'},
    _audio_voice_delay_seconds:{...section,type:'number',default:0,minimum:0,maximum:86400,title:'Départ de la voix après IN (s)'},
    _audio_voice_volume:{...section,type:'number',default:1,minimum:0,maximum:1,title:'Volume de la voix (0 à 1)'},
  };
}
