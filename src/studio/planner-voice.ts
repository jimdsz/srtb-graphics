import {getTemplate,ParameterError,templateDefaults} from './domain';
import type {ProjectData} from './domain';
import {normalizeAnnouncement} from './derivation-announcements';
import {baVoicePlacement} from './ba-voice-placement';
import {BA_CARTON_START,voiceTimingKeys} from './voice-timing-model';
import {makeTimeline} from './video/timeline';
import {plannerVoiceSchema} from './planner-voice-model';
import type {PlannerVoice,PlannerVoiceKind} from './planner-voice-model';
import type {Plan,PlannerTaskChoice} from './day-planner-model';

export const plannerTemplates={ba:'BTV_BA_1P',popup:'BTV_PopUp',tds:'BTV_BA_TDS',renvoi:'BTV_Renvoi',event:'BTV_Evenement',weekly:'BTV_Semainier'} as const;
export function plannerVoiceCue(kind:PlannerVoiceKind,airDate?:string){
  if(kind==='weekly')return 'Cette semaine';
  if(kind==='tds')return 'Tout de suite';
  if(!airDate||!/^\d{4}-\d{2}-\d{2}$/.test(airDate)||!Number.isFinite(Date.parse(airDate))||new Date(airDate).toISOString().slice(0,10)!==airDate)return '';
  const day=new Intl.DateTimeFormat('fr-FR',{weekday:'long',timeZone:'UTC'}).format(new Date(airDate+'T12:00:00Z'));
  return day[0].toLocaleUpperCase('fr')+day.slice(1);
}
export function selectedPlannerVoice(plan:Plan,choice:PlannerTaskChoice):PlannerVoice|undefined{
  return choice.kind==='weekly'?plan.weekly?.voice:plan.rows.find(row=>row.id===choice.rowIds[0])?.voices?.[choice.kind];
}
export function plannerVoicePlacement(kind:PlannerVoiceKind,voice:PlannerVoice){
  const duration=voice.end-voice.start,placement=voice.placement;
  if(kind==='ba'){
    if(placement.mode==='single')throw new ParameterError('Choisissez les départs de la voix à l’introduction et au carton de la BA.');
    const fit=baVoicePlacement(duration,placement.mode==='ba-auto'?'fit-complete':'manual',placement.mode==='ba-manual'?{intro:placement.intro,outro:BA_CARTON_START+placement.carton}:undefined);
    return {duration,intro:fit.intro,carton:fit.outro-BA_CARTON_START,delay:undefined};
  }
  if(placement.mode!=='single')throw new ParameterError('Cet habillage utilise un seul départ vocal après IN.');
  return {duration,intro:undefined,carton:undefined,delay:placement.delay};
}
/** Same calculation in the dialog and server. No stretching or silent trimming. */
export function plannerVoicePatch(kind:PlannerVoiceKind,input:PlannerVoice,airDate?:string,settings?:ProjectData):ProjectData{
  const parsed=plannerVoiceSchema.safeParse(input);
  if(!parsed.success)throw new ParameterError('Vérifiez le fichier, le passage et la confirmation de la voix.');
  const voice=parsed.data,cue=plannerVoiceCue(kind,airDate);
  if(!cue||normalizeAnnouncement(voice.cue)!==normalizeAnnouncement(cue))throw new ParameterError(`La voix annonçant « ${voice.cue} » ne correspond plus à « ${cue||'date à préciser'} ». Écoutez et confirmez à nouveau le bon fichier dans Voix & calage.`);
  const template=getTemplate(plannerTemplates[kind]),keys=voiceTimingKeys(template)!;
  const timing=plannerVoicePlacement(kind,voice),patch:ProjectData={_audio_voice_url:voice.source,_audio_voice_enabled:true,[keys.start]:voice.start,[keys.end]:voice.end};
  if(template.fields._audio_voice_volume)patch._audio_voice_volume=1;
  if(kind==='ba'){
    Object.assign(patch,{_audio_voice_intro_offset_seconds:timing.intro!,_audio_voice_outro_offset_seconds:BA_CARTON_START+timing.carton!,_studio_ba_voice_fit:voice.placement.mode==='ba-auto'?'fit-complete':'manual'});
  }else{
    const data=settings??templateDefaults(template),timeline=makeTimeline(template.id,data,{},Number(data._out_duration_seconds||12),false);
    const end=(timeline.frames-timeline.terminalHoldFrames)/25;
    if(timing.delay!+timing.duration>end+1/48000)throw new ParameterError(`La voix se termine à ${(timing.delay!+timing.duration).toFixed(2)} s, après cet habillage (${end.toFixed(2)} s). Avancez son départ ou choisissez un passage plus court ; aucune coupe automatique.`);
    patch._audio_voice_delay_seconds=timing.delay!;
  }
  return patch;
}

export function plannerVoiceAssets(plan:Plan){
  return [...plan.rows.flatMap(row=>Object.values(row.voices??{})),...(plan.weekly?.voice?[plan.weekly.voice]:[])].filter((v):v is PlannerVoice=>!!v).map(v=>({value:v.source,kind:'audio' as const}));
}
