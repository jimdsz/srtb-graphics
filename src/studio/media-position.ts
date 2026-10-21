/** Shared source clock, without importing template/schema construction. */
export interface ClipPosition {index:number;time:number}
export function locateClip(clips:{start:number;length:number}[],seconds:number,loop:boolean,rate=1):ClipPosition|undefined{
  if(!clips.length)return;
  const total=clips.reduce((n,c)=>n+c.length,0);if(!(total>0))return;
  let position=Math.max(0,seconds)*rate;
  if(Number.isFinite(total))position=loop?position%total:Math.min(position,Math.max(0,total-.04));
  let index=0;while(index<clips.length-1&&position>=clips[index].length)position-=clips[index++].length;
  return {index,time:clips[index].start+position};
}
