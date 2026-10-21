import {motion} from 'motion/react';
import {useReducedMotionPreference} from './useReducedMotionPreference';

/** Animate only the visual fill. The accessible value always reports measured work. */
export default function ProgressGauge({value,label}:{value:number;label:string}){
  const reduced=useReducedMotionPreference();
  const percent=Math.min(100,Math.max(0,Number.isFinite(value)?value:0));
  return <div className="progress-gauge" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(percent)}>
    <span className="progress-track" aria-hidden="true"><motion.span className="progress-fill" initial={false} animate={{scaleX:percent/100}} transition={{duration:reduced?0:.18,ease:'easeOut'}}/></span><span className="progress-value">{Math.floor(percent)} %</span>
  </div>;
}
