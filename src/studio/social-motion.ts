import type {VideoTimeline} from './video/timeline';

/** Output-clock phases only. The source/audio clocks and native TV timings stay
 * intact: the social signatures replace the TV artwork, not the soundtrack. */
export interface SocialSignature {phase:'intro'|'transition'|'outro';start:number;end:number;elapsed:number}
// The signatures cover the native media/jingle windows. Social titles have
// their own readable entrance from the first frame; the delayed AE title keys
// belong to the unmodified television composition only.
export const TDS_SOCIAL_MOTION={introTitleStart:0,introEnd:109/25,followupStart:345/25,followupTitleStart:345/25,followupEnd:415/25} as const;
export const SOCIAL_SETTLE_SECONDS=.36;

/** OUT freezes the programme and its subtle settle, including an early manual
 * OUT. No phase ever resets an already readable card to invisible. */
export function tdsSocialCardMotion(id:string,seconds:number,outAt:number){
  if(id!=='BTV_BA_TDS'&&id!=='BTV_BA_TDS_SUIVI_DE')return;
  const held=Math.min(seconds,outAt),second=id==='BTV_BA_TDS_SUIVI_DE'&&held>=TDS_SOCIAL_MOTION.followupStart;
  const start=second?TDS_SOCIAL_MOTION.followupTitleStart:TDS_SOCIAL_MOTION.introTitleStart;
  return {second,elapsed:held-start,duration:SOCIAL_SETTLE_SECONDS};
}
const entries:Record<string,number>={
  BTV_BA_1P:4.36,BTV_Ce_Soir:1.6,BTV_Renvoi:2.8,
  BTV_Evenement:4.08,BTV_Semainier:2.96,
  BTV_BA_TDS:TDS_SOCIAL_MOTION.introEnd,BTV_BA_TDS_SUIVI_DE:TDS_SOCIAL_MOTION.introEnd,
};
const closing=new Set([...Object.keys(entries),'BTV_BA_TDS','BTV_BA_TDS_SUIVI_DE']);
export function socialSignature(id:string,seconds:number,timeline:Pick<VideoTimeline,'outAt'|'duration'>):SocialSignature|undefined{
  if(id==='BTV_BA_1P')return; // Direct excerpt: no bookend, transition or tail.
  if(seconds<0||seconds>=timeline.duration||!closing.has(id))return;
  // The weekly final announcement has its own scene before OUT. An early
  // manual OUT still takes precedence, and an unlimited hold never invents OUT.
  const endStart=id==='BTV_Semainier'?Math.min(19.8,timeline.outAt):timeline.outAt;
  if(seconds>=endStart)return {phase:'outro',start:endStart,end:timeline.duration,elapsed:seconds-endStart};
  const entry=Math.min(entries[id]||0,endStart);
  if(seconds<entry)return {phase:'intro',start:0,end:entry,elapsed:seconds};
  if(id==='BTV_BA_TDS_SUIVI_DE'&&seconds>=TDS_SOCIAL_MOTION.followupStart&&seconds<TDS_SOCIAL_MOTION.followupEnd){
    const start=TDS_SOCIAL_MOTION.followupStart;return {phase:'transition',start,end:Math.min(TDS_SOCIAL_MOTION.followupEnd,endStart),elapsed:seconds-start};
  }
}

export function socialSignatureOpacity(signature:SocialSignature,seconds:number){
  if(signature.phase!=='outro'||!Number.isFinite(signature.end))return 1;
  return socialEndOpacity(seconds,signature.start,signature.end);
}

/** Hold an already complete end card, then fade the complete composition.
 * Even a 720 ms OUT has a readable hold; it never fades while re-entering. */
export function socialEndOpacity(seconds:number,outAt:number,end:number){
  if(!Number.isFinite(end)||seconds<outAt)return 1;
  const fade=Math.min(.48,Math.max(.04,(end-outAt)/2));
  const t=Math.min(1,Math.max(0,(seconds-(end-fade))/fade));
  return 1-t*t*(3-2*t);
}

/** The automatic title block reads centrally on a long signature, then meets
 * the exact content layout before the first excerpt frame. Explicit placement
 * remains the editor's choice. Short OUTs and follow-up cuts stay settled. */
export function socialSignatureLift(signature:SocialSignature|undefined,id:string){
  if(!signature||signature.phase==='transition')return 0;
  const length=signature.end-signature.start;
  const entry=entries[id]||0,entryMove=Math.min(.48,entry);
  const introLift=(at:number)=>{const t=Math.min(1,Math.max(0,(at-(entry-entryMove))/entryMove));return 1-t*t*(3-2*t);};
  if(signature.phase==='outro'){
    // A live manual OUT may arrive during IN. Continue from its current
    // placement instead of teleporting the card to the excerpt position.
    const initial=entry&&signature.start<entry?introLift(signature.start):0;
    if(length<1.5)return initial;
    const t=Math.min(1,Math.max(0,signature.elapsed/.48));
    return initial+(1-initial)*t*t*(3-2*t);
  }
  return introLift(signature.elapsed);
}
