import {useSyncExternalStore} from 'react';

const query='(prefers-reduced-motion: reduce)';
const snapshot=()=>typeof matchMedia==='function'&&matchMedia(query).matches;
const serverSnapshot=()=>true;
function subscribe(onChange:()=>void){
  const preference=matchMedia(query);
  preference.addEventListener('change',onChange);
  return()=>preference.removeEventListener('change',onChange);
}

/** Keep ongoing indicators in sync when the OS preference changes mid-task. */
export function useReducedMotionPreference(){
  return useSyncExternalStore(subscribe,snapshot,serverSnapshot);
}
