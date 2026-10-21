import type {BroadcastField,BroadcastTemplate,ProjectData} from './domain';
import {baTextDefaults,baTextKey} from './text-editing';
import {voiceFields} from './voice-fields';
import {overlayLogoFields,overlayLogoKey} from './logo-model';
import {APPOINTMENT_DISPLAY,appointmentEngineData} from './appointment-display';
import {PORTRAIT_LAYOUT,portraitPanelTemplate} from './social-portrait-layout';
import {cropMotionKey} from './crop-motion';
import {sequenceCropKey} from './sequence-crop';
import {socialCardKey} from './social-card-settings';
import {aeTrimTemplate} from './ae-media-window';
import {ceilFrameSeconds} from './frame-time';
import {relayFields,relayKeys} from './relay-placement';
import {renvoiSignageFields} from './renvoi-signage';
import {CE_SOIR_BACKGROUND,ceSoirBackgroundFields} from './ce-soir-background';
import {ceSoirAudioFields} from './ce-soir-audio';

/** Studio settings are versioned independently; only explicit adapter fields cross the engine boundary. */
export const PRESENTATIONS={tv:{label:'Télévision · 16:9',width:1920,height:1080},portrait:{label:'Portrait · 4:5',width:1080,height:1350},vertical:{label:'Vertical · 9:16',width:1080,height:1920}} as const;
export type Presentation=keyof typeof PRESENTATIONS;
export const ANNOUNCEMENTS=['Ce soir','Demain','Aujourd’hui','Tout de suite','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'] as const;
/** Recognize imported/uppercase labels without rewriting the user's saved text. */
export function announcementPreset(value:unknown){
  const normalized=String(value??'').trim().replace(/'/g,'’').toLocaleLowerCase('fr');
  return ANNOUNCEMENTS.find(day=>day.toLocaleLowerCase('fr')===normalized);
}
export function presentation(data:ProjectData){const value=data._studio_format;return typeof value==='string'&&Object.hasOwn(PRESENTATIONS,value)?value as Presentation:'tv';}
export function dimensions(data:ProjectData){return PRESENTATIONS[presentation(data)];}
export function engineData(data:ProjectData,editorTypography=false):ProjectData{
  const native=Object.fromEntries(Object.entries(data).filter(([key])=>!key.startsWith('_studio_')||key==='_studio_ba_voice_fit'||editorTypography&&(baTextKey(key)||[...relayKeys,CE_SOIR_BACKGROUND,'_studio_typography','_studio_default_text_case','_studio_image_sizes'].includes(key)||overlayLogoKey(key))));
  // Some frozen engines round to the nearest frame. Feed them the same OUT
  // boundary as inspection/export without changing the saved requested value.
  const duration=native._out_duration_seconds;
  if(typeof duration==='number'&&Number.isFinite(duration)&&duration>=0)native._out_duration_seconds=ceilFrameSeconds(duration);
  // Keep hidden appointments in the project, but never send them to the simple BA.
  if(data._studio_ba_mode==='simple')for(const n of [2,3]){native[`_jour_${n}`]='';native[`_heure_${n}`]='';}
  return appointmentEngineData(data,native);
}
export function presentationFields(fields:Record<string,BroadcastField>,id:string):Record<string,BroadcastField>{
  const extra:Record<string,BroadcastField>={_studio_format:{type:'string',default:'tv',enum:Object.keys(PRESENTATIONS),title:'Format de composition'}};
  if(id==='BTV_Relais_Antenne')Object.assign(extra,relayFields);
  if(id==='BTV_Renvoi')Object.assign(extra,renvoiSignageFields);
  if(id==='BTV_Ce_Soir')Object.assign(extra,ceSoirBackgroundFields,ceSoirAudioFields,{
    _audio_enabled:{...fields._audio_enabled,title:'Musique de fond'},
    _audio_url:{...fields._audio_url,title:'Fichier de musique','x-section':'Son · musique de fond'},
    _audio_loop:{...fields._audio_loop,title:'Répéter la musique jusqu’à la sortie','x-section':'Son · musique de fond'},
    _audio_start_seconds:{...fields._audio_start_seconds,'x-section':'Son · musique de fond'},
    _audio_end_seconds:{...fields._audio_end_seconds,'x-section':'Son · musique de fond'},
  });
  for(const format of ['portrait','vertical'] as const){
    extra[socialCardKey(format,'scale')]={type:'number',default:100,minimum:50,maximum:100,title:`Taille du carton ${format==='portrait'?'4:5':'9:16'}`};
    extra[socialCardKey(format,'compact')]={type:'boolean',default:true,title:`Espaces réduits du carton ${format==='portrait'?'4:5':'9:16'}`};
  }
  if(portraitPanelTemplate(id))extra[PORTRAIT_LAYOUT]={type:'string',default:'auto',enum:['auto','compact','legacy'],title:'Mise en page du panneau 4:5'};
  extra._studio_typography={type:'string',default:'{}',maxLength:48000,title:'Édition des textes'};
  // Missing in older projects means the native, historically saved casing.
  extra._studio_default_text_case={type:'string',default:'original',enum:['original','upper'],title:'Casse par défaut des textes'};
  extra._studio_image_sizes={type:'string',default:'{}',maxLength:12000,title:'Dimensions des images'};
  extra._studio_logo_anchor={type:'string',default:'top-left',enum:['top-left','top-right','top-center','bottom-left','bottom-right'],title:'Position du logo BTV'};
  extra._studio_block_anchor={type:'string',default:'original',enum:['original','top','center','bottom'],title:'Position du bloc titre et rendez-vous'};
  extra._studio_block_scale={type:'number',default:100,minimum:70,maximum:100,title:'Taille du bloc'};
  for(const axis of ['x','y'])extra['_studio_block_'+axis]={type:'number',default:0,minimum:-100,maximum:100,title:'Décalage du bloc'};
  extra._studio_sponsor_x={type:'number',default:50,minimum:0,maximum:100,title:'Alignement des sponsors'};
  if(id==='BTV_BA_1P')extra._studio_ba_mode={type:'string',default:'multiple',enum:['simple','multiple'],title:'Rendez-vous de la bande-annonce'};
  if(id==='BTV_BA_1P')extra[APPOINTMENT_DISPLAY]={type:'string',default:'text',enum:['text','hidden','logo'],title:'Affichage du rendez-vous'};
  if(id==='BTV_BA_1P')extra._studio_ba_voice_fit={type:'string',default:'source',enum:['source','fit-complete','manual'],title:'Placement de la voix BA',description:'Source : créneaux natifs. Voix complète : adaptation explicitement acceptée. Calage personnalisé : départs d’introduction et de carton indépendants ; le jingle baisse autour de la voix sans modifier le passage.'};
  if(id==='BTV_BA_1P')for(const [key,value]of Object.entries(baTextDefaults))extra[key]={type:'number',default:value,minimum:key.endsWith('scale')?20:key.endsWith('_x')?-800:-500,maximum:key.endsWith('scale')?200:key.endsWith('_x')?800:500,title:'Réglage du titre BA'};
  for(const key of Object.keys(fields).filter(key=>key.startsWith('_media_')&&key.endsWith('_url'))){
    const kind=key.slice(7,-4);
    if(aeTrimTemplate(id))for(const [suffix,title] of [['start_seconds','Début du passage (s)'],['end_seconds','Fin du passage (s)']])extra[`_media_${kind}_${suffix}`]={type:'number',default:0,minimum:0,maximum:86400,title,description:'0 en sortie = fin du fichier. Le passage est conservé en aperçu et export ; à sa fin, la dernière image reste affichée.','x-section':fields[key]['x-section']||'Médias'};
    if(aeTrimTemplate(id))extra[`_media_${kind}_sequence`]={type:'string',default:'[]',maxLength:20000,title:'Montage des extraits','x-control':'sequence','x-section':fields[key]['x-section']||'Médias'};
    if(aeTrimTemplate(id)){
      extra[`_media_${kind}_audio_enabled`]={type:'boolean',default:false,title:`Son des extraits · ${fields[key].title||kind}`,'x-section':'Son des médias'};
      extra[`_media_${kind}_volume`]={type:'number',default:1,minimum:0,maximum:1,title:'Volume des extraits','x-section':'Son des médias'};
    }
    extra[cropMotionKey(kind)]={type:'string',default:'{}',maxLength:24000,title:'Repères de cadrage social'};
    if(`${key.slice(0,-4)}_sequence` in fields||aeTrimTemplate(id))extra[sequenceCropKey(kind)]={type:'string',default:'[]',maxLength:24000,title:'Cadrages des passages'};
    extra[`_studio_${kind}_fit`]={type:'string',default:'cover',enum:['cover','contain'],title:'Cadrage social'};
    for(const axis of ['x','y'])extra[`_studio_${kind}_${axis}`]={type:'number',default:50,minimum:0,maximum:100,title:'Position du média'};
  }
  // Older schemas identify audio by key but omit x-control. The media picker
  // must still list sounds (and open an audio-only local chooser), not videos.
  const native=Object.fromEntries(Object.entries(fields).map(([key,field])=>[key,
    /^_audio(?:_bed|_voice)?_url$/.test(key)?{...field,'x-control':'audio'}:field]));
  return {...voiceFields(id),...native,...extra,...overlayLogoFields()};
}
export function simpleBaDefaults(data:ProjectData):ProjectData{return {...data,_studio_ba_mode:'simple',_jour_1:'Ce soir',_heure_1:'20h30',_jour_2:'',_heure_2:'',_jour_3:'',_heure_3:'',_audio_voice_enabled:false};}
export function changeAnnouncement(data:ProjectData,day:string):ProjectData{
  // Never play yesterday's recorded day underneath a newly selected announcement.
  return {...data,_jour_1:day,_audio_voice_enabled:day===data._jour_1?data._audio_voice_enabled:false};
}
export function projectTemplateName(template:BroadcastTemplate,data:ProjectData){return template.id==='BTV_BA_1P'&&data._studio_ba_mode==='simple'?'Bande-annonce simple · un rendez-vous':template.name;}

export {locateClip} from './media-position';
export type {ClipPosition} from './media-position';
