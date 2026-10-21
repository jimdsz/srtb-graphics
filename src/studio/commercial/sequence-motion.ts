import {nativeCardMotion} from './native-motion';
import type {NativeCardKind} from './native-motion';

/** A reusable card keeps the native entry/exit without the old text swap. */
export function commercialSequenceCardMotion(kind: NativeCardKind, time: number, start: number, end: number) {
  const motion = nativeCardMotion(kind, time, start, end);
  // The legacy left precomp fades at source30 to replace Gauche by Final.
  // Standalone sequences have a single text and must not blink halfway.
  if (kind === 'left' && motion.visible && motion.sourceTime >= 29.56 && motion.sourceTime <= 30.44) {
    return {...motion, title: {...motion.title, alpha: 1}, body: {...motion.body, alpha: 1}};
  }
  return motion;
}

/** Readable cards settle once, stay still, and leave before the next card enters. */
export function readableSequenceMotion(time:number,start:number,end:number) {
  const ease=(value:number)=>{const t=Math.max(0,Math.min(1,value));return t*t*(3-2*t);};
  const entry=ease((time-start)/.5),exit=ease((time-(end-.35))/.35);
  return {visible:time>=start&&time<end,alpha:entry*(1-exit),dy:18*(1-entry)-8*exit};
}
