/** Independent AE opacity keys begin before the named Outro precomposition.
 * Keep every native 25 fps sample, including this pre-fade, after the operator's
 * unchanged OUT request. Frozen artwork/configuration is never mutated. */
export const AE_COMPLETE_OUT={
  BTV_Evenement:{fps:25,frames:526,previousOutFrame:451,outFrame:443,outStart:17.72,outDuration:3.32},
  BTV_Semainier:{fps:25,frames:658,previousOutFrame:583,outFrame:581,outStart:23.24,outDuration:3.08},
} as const;
export function completeAEOutConfig<T extends {timing:{fps:number;frames:number;outFrame:number;outStart:number;outDuration:number}}>(config:T,id:string):T{
  const expected=AE_COMPLETE_OUT[id as keyof typeof AE_COMPLETE_OUT];if(!expected)return config;
  const timing=config.timing;
  if(timing.fps!==expected.fps||timing.frames!==expected.frames||timing.outFrame!==expected.previousOutFrame&&timing.outFrame!==expected.outFrame)throw Error('Contrat source AE de sortie modifié : '+id);
  return {...config,timing:{...timing,outFrame:expected.outFrame,outStart:expected.outStart,outDuration:expected.outDuration}};
}
/** Arithmetic round-off only (one representable-double relative precision),
 * not a frame/time tolerance. E.g. 4.4+3.32 is 7.720000000000001 while the
 * exact 25 fps endpoint 193/25 is 7.72. Never round a manual OUT request. */
export function aeOutFinished(elapsed:number,outAt:number,duration:number){
  const end=outAt+duration;
  return elapsed>=end||end-elapsed<=Number.EPSILON*Math.max(1,Math.abs(elapsed),Math.abs(end));
}
