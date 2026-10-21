import {useEffect,useRef} from 'react';
import type {ReactNode} from 'react';
import {animate} from 'motion/mini';
import {scheduleSurfaceAnimation} from './surface-animation';

/** Navigation feedback only: never animate the canvas or remount its renderer. */
export default function SurfaceTransition({identity,children}:{identity:string;children:ReactNode}){
  const surface=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!surface.current||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    return scheduleSurfaceAnimation(surface.current,node=>animate(node,{opacity:[.45,1],transform:['translateY(5px)','translateY(0px)']},{duration:.18,ease:'easeOut'}));
  },[identity]);
  return <div ref={surface} className="surface-transition">{children}</div>;
}
