import type {ProjectData} from './domain';

/** Supplied transparent white artwork; never recolour or reconstruct the mark. */
export const SOCIAL_BRAND_ASSET='/social/v2/btv-logo-horizontal-white.png';
export const SOCIAL_BRAND_SOURCE_SIZE={width:3050,height:688} as const;
export interface SocialBrandBox {x:number;y:number;w:number;h:number}
const anchors=new Set(['top-left','top-right','top-center','bottom-left','bottom-right']);
const brandAnchor=(data:ProjectData)=>anchors.has(String(data._studio_logo_anchor))?String(data._studio_logo_anchor):'top-right';

/** Logical output pixels shared by full-resolution export and bounded previews.
 * Card transforms do not move the station identifier. Explicit anchors do. */
export function socialBrandGeometry(data:ProjectData,width:number,height:number,signature=false):SocialBrandBox{
  const vertical=data._studio_format==='vertical',anchor=brandAnchor(data),right=vertical?150:80;
  const w=signature?360:288,h=w*SOCIAL_BRAND_SOURCE_SIZE.height/SOCIAL_BRAND_SOURCE_SIZE.width;
  const x=anchor.endsWith('left')?80:anchor.endsWith('center')?(width-w)/2:width-right-w;
  const y=anchor.startsWith('bottom')?height-(vertical?220:65)-h:vertical?150:48;
  return {x,y,w,h};
}

/** Keep INÉDIT in the free part of the header, including an explicit left or
 * centre anchor. Bottom logos leave the entire header available for the label. */
export function socialBrandLabelBox(data:ProjectData,width:number,height:number,signature=false):SocialBrandBox{
  const logo=socialBrandGeometry(data,width,height,signature),vertical=data._studio_format==='vertical';
  const left=80,right=width-(vertical?150:80),top=vertical?150:48,h=54,gap=32;
  const y=top+Math.max(0,(logo.h-h)/2);
  if(brandAnchor(data).startsWith('bottom'))return {x:left,y,w:right-left,h};
  const before=Math.max(0,logo.x-left-gap),after=Math.max(0,right-logo.x-logo.w-gap);
  return before>=after?{x:left,y,w:before,h}:{x:logo.x+logo.w+gap,y,w:after,h};
}
