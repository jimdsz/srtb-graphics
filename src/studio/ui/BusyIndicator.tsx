import {LoaderCircle} from 'lucide-react';
import {motion} from 'motion/react';
import {useReducedMotionPreference} from './useReducedMotionPreference';

/** Used only while real work is pending; decorative beside a visible status. */
export default function BusyIndicator({size=18}:{size?:number}){
  const reduced=useReducedMotionPreference();
  return <motion.span className="busy-indicator" aria-hidden="true" animate={{rotate:reduced?0:360}} transition={reduced?{duration:0}:{duration:1.2,repeat:Infinity,ease:'linear'}}><LoaderCircle size={size}/></motion.span>;
}
