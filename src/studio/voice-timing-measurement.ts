import type {BroadcastTemplate,ProjectData} from './domain';
import {promoteVerifiedLocalData} from './local-media';
import {measureVoiceDuration} from './voice-duration';
import type {VoiceDurationProgress} from './voice-duration';
import {voiceRangePatch,voiceTimingFieldNames} from './voice-timing-model';

export interface VoiceTimingMeasureTarget {template:BroadcastTemplate;data:ProjectData;disabled:boolean}
export interface VoiceTimingMeasureState {busy:boolean;phase:'idle'|'reading'|'decoding'|'cancelling'|'success'|'cancelled'|'error';progress:VoiceDurationProgress|null;message:string}
export const initialVoiceTimingMeasureState:VoiceTimingMeasureState={busy:false,phase:'idle',progress:null,message:''};
/** Fingerprint promotion is the same file, not a new source selection. */
export function sameVoiceTimingTarget(before:VoiceTimingMeasureTarget,next:VoiceTimingMeasureTarget){
  if(next.disabled||before.template.id!==next.template.id||before.template.version!==next.template.version)return false;
  const source=(target:VoiceTimingMeasureTarget)=>{
    const value=promoteVerifiedLocalData(target.template,{_audio_voice_url:target.data._audio_voice_url})._audio_voice_url;
    return typeof value==='object'?value.url:value;
  };
  return source(before)===source(next)&&[...voiceTimingFieldNames(before.template).filter(key=>key!=='_audio_voice_url'),'_audio_voice_enabled','_studio_ba_voice_fit'].every(key=>before.data[key]===next.data[key]);
}
/** Explicit measure only. No activation, fit proposal, attestation or persistence.
 * Retain a single decoder until it settles, even if decode cannot abort itself. */
export function createVoiceTimingMeasurement({current,apply,onChange,measure=measureVoiceDuration}:{current:()=>VoiceTimingMeasureTarget;apply:(patch:ProjectData)=>void;onChange:(state:VoiceTimingMeasureState)=>void;measure?:typeof measureVoiceDuration}){
  let state={...initialVoiceTimingMeasureState},active:{controller:AbortController;baseline:VoiceTimingMeasureTarget;promise:Promise<void>}|undefined,disposed=false;
  const emit=(next:VoiceTimingMeasureState)=>{state=next;if(!disposed)try{onChange({...state});}catch{/* View observers cannot strand a decoder. */}};
  function cancel(message='Mesure interrompue. Aucun repère ni activation n’a été appliqué.'){
    if(!active||active.controller.signal.aborted)return;
    active.controller.abort(new DOMException(message,'AbortError'));
    emit({...state,busy:true,phase:'cancelling',message:'Annulation de la mesure… Les repères actuels sont conservés.'});
  }
  function check(){if(active&&!sameVoiceTimingTarget(active.baseline,current()))cancel('La source ou les réglages de voix ont changé. Relancez explicitement la mesure.');}
  function run(){
    if(disposed)return Promise.resolve();if(active)return active.promise;
    const target=current(),source=target.data._audio_voice_url;
    if(target.disabled)return Promise.resolve();
    if(!source||typeof source!=='object'||!source.mimeType.startsWith('audio/')){emit({busy:false,phase:'error',progress:null,message:'Choisissez un fichier audio local ou déjà partagé pour mesurer sa durée décodée.'});return Promise.resolve();}
    const baseline={...target,data:{...target.data,_audio_voice_url:{...source}}},controller=new AbortController();
    const pending={controller,baseline,promise:Promise.resolve()};active=pending;
    emit({busy:true,phase:'reading',progress:null,message:'Lecture locale du fichier audio…'});
    pending.promise=Promise.resolve().then(async()=>{
      try{
        controller.signal.throwIfAborted();
        const duration=await measure(source,controller,progress=>{if(active===pending&&!controller.signal.aborted)emit({busy:true,phase:progress.phase,progress,message:progress.phase==='reading'?'Lecture locale du fichier audio…':'Décodage audio à 48 kHz…'});});
        controller.signal.throwIfAborted();
        if(disposed||active!==pending||!sameVoiceTimingTarget(baseline,current()))throw new DOMException('La source ou les réglages ont changé. Aucun résultat périmé n’a été appliqué.','AbortError');
        if(!Number.isFinite(duration)||duration<.04||duration>600)throw Error('La durée décodée doit être comprise entre 0,04 et 600 secondes.');
        apply(voiceRangePatch(target.template,current().data,{start:0,end:duration}));
        emit({busy:false,phase:'success',progress:state.progress,message:`Fichier entier : ${duration.toFixed(6)} s décodées. Écoutez la voix et vérifiez son calage ; l’état de la piste est inchangé.`});
      }catch(cause){
        const cancelled=controller.signal.aborted||cause instanceof DOMException&&cause.name==='AbortError';
        emit({busy:false,phase:cancelled?'cancelled':'error',progress:state.progress,message:cancelled?(controller.signal.reason?.message|| (cause instanceof Error?cause.message:'Mesure interrompue. Aucun repère appliqué.')):cause instanceof Error?cause.message:String(cause)});
      }finally{if(active===pending)active=undefined;}
    });
    return pending.promise;
  }
  return {run,cancel,check,snapshot:()=>state,busy:()=>!!active,dispose(){disposed=true;cancel();return active?.promise??Promise.resolve();}};
}
