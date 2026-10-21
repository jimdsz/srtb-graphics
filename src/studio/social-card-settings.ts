import type {ProjectData} from './domain';
import {blockPlacement} from './placement';
import type {LayoutBox} from './placement';

export const socialCardKey=(format:'portrait'|'vertical',setting:'scale'|'compact')=>`_studio_${format}_card_${setting}`;
export const compactCardTemplate=(id:string)=>['BTV_BA_1P','BTV_BA_TDS','BTV_BA_TDS_SUIVI_DE','BTV_Renvoi','BTV_Evenement','BTV_Semainier'].includes(id);
export function socialCardScale(data:ProjectData){
  if(data._studio_format!=='portrait'&&data._studio_format!=='vertical')return 100;
  const n=Number(data[socialCardKey(data._studio_format,'scale')]??100);
  return Number.isFinite(n)?Math.min(100,Math.max(50,n)):100;
}
export function compactSocialCard(data:ProjectData){
  return (data._studio_format==='portrait'||data._studio_format==='vertical')&&data[socialCardKey(data._studio_format,'compact')]!==false;
}
/** An additional proportional transform, shared by preview and export. Keep the
 * existing placement and bottom edge, without scaling screen-space text offsets.
 * 100% is exactly the previous transform; TV never reads these settings. */
export function socialCardPlacement(box:LayoutBox,width:number,height:number,data:ProjectData){
  const placed=blockPlacement(box,width,height,data._studio_format==='vertical',data),ratio=socialCardScale(data)/100;
  if(ratio===1)return placed;
  return {x:placed.x+box.w*placed.scale*(1-ratio)/2,y:placed.y+box.h*placed.scale*(1-ratio),scale:placed.scale*ratio};
}
