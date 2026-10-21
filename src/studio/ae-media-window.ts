/** Shared, browser-independent contract for the frozen AE media adapters. */
export const aeTrimTemplate=(id:string)=>['BTV_Renvoi','BTV_Evenement','BTV_Semainier'].includes(id);
export function aeClipWindow(duration:number,start=0,end=0){
  if(!Number.isFinite(duration)||duration<=0||![start,end].every(Number.isFinite)||start<0||end<0||start>86400||end>86400)throw Error('Passage vidéo invalide.');
  const stop=end||duration;
  if(start>=duration||stop>duration+1e-7||stop-start<.04-1e-7)throw Error('Le passage choisi dépasse le média ou dure moins d’une image.');
  return {start,end:stop,length:stop-start};
}
export function aeSourceTime(track:{clips:{start:number;length:number}[]},seconds:number){
  const clip=track.clips[0],raw=Math.max(0,seconds);
  return {seconds:clip.start+Math.min(raw,Math.max(0,clip.length-.04)),ended:raw>=clip.length-.04};
}
