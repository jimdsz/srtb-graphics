/** Qualification policy only; never imported by the production renderer. */
export interface LogoDifference {
  frame:number;
  max:number;
  offContourChanged:number;
  interiorChanged:number;
  alphaMax:number;
  premultipliedMax:number;
  premultipliedMean:number;
}
export function qualifiedLogoDifference(record:LogoDifference){
  // All RGBA bytes, including small deltas and transparent pixels, must match
  // in settled poses. A count using a tolerance is not byte equality.
  if([record.frame,record.max,record.offContourChanged,record.interiorChanged,record.alphaMax,record.premultipliedMax,record.premultipliedMean].some(value=>!Number.isFinite(value)||value<0))return false;
  return record.frame>=20?record.max===0:
    record.offContourChanged===0&&record.interiorChanged===0&&
    record.alphaMax<=64&&record.premultipliedMax<=64&&record.premultipliedMean<=.01;
}
// Include every held V shape and colour discontinuity, not just settled poses.
export const logoProofFrames=Array.from({length:80},(_,frame)=>frame);
