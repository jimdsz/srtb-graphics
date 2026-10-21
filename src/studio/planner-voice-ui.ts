import {plannerVoicePatch,plannerVoicePlacement} from './planner-voice';
import type {PlannerVoice,PlannerVoiceKind} from './planner-voice-model';

const secondsFormat=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:3});
export const plannerVoiceSeconds=(value:number)=>secondsFormat.format(value);

/** Lightweight row summaries must not load the audio dialog or its decoder. */
export function plannerVoiceDescription(kind:PlannerVoiceKind,voice?:PlannerVoice,airDate?:string){
  if(!voice)return {label:'Sans voix off',detail:'Choisir et caler',error:''};
  try{
    plannerVoicePatch(kind,voice,airDate);
    const timing=plannerVoicePlacement(kind,voice);
    return {label:`« ${voice.cue} »`,detail:kind==='ba'?`Intro +${plannerVoiceSeconds(timing.intro!)} s · carton +${plannerVoiceSeconds(timing.carton!)} s`:`Départ +${plannerVoiceSeconds(timing.delay!)} s`,error:''};
  }catch(cause){return {label:`« ${voice.cue} » · à vérifier`,detail:'Reconfirmer ou ajuster',error:cause instanceof Error?cause.message:String(cause)};}
}
