import type {ProjectData} from './domain';
import {textStyles} from './typography-model';
import type {SocialTextFit} from './social-text-fit';

export const PORTRAIT_LAYOUT='_studio_portrait_layout';
export const portraitPanelTemplate=(id:string)=>['BTV_BA_1P','BTV_BA_TDS','BTV_BA_TDS_SUIVI_DE'].includes(id);
export type PortraitLayoutMode='compact'|'legacy';
/** Unmarked customized projects keep their former geometry, including media crops.
 * No stored parameter is reset, normalized or migrated by this read-only decision. */
export function portraitLayoutMode(data:ProjectData):PortraitLayoutMode{
  if(data[PORTRAIT_LAYOUT]==='compact'||data[PORTRAIT_LAYOUT]==='legacy')return data[PORTRAIT_LAYOUT] as PortraitLayoutMode;
  if(Object.keys(textStyles(data)).some(key=>key.startsWith('portrait:')))return 'legacy';
  // The station identifier is independent of the editorial panel. Both the
  // former left default and the supplied artwork's current right default are
  // neutral: choosing the new default must not enlarge the entire 4:5 card.
  // Explicit layout markers and other historic customizations still win.
  if(data._studio_logo_anchor!==undefined&&!['top-left','top-right'].includes(String(data._studio_logo_anchor)))return 'legacy';
  const defaults:Record<string,unknown>={_studio_block_anchor:'original',_studio_block_scale:100,_studio_block_x:0,_studio_block_y:0,_studio_sponsor_x:50};
  if(Object.entries(defaults).some(([key,value])=>data[key]!==undefined&&data[key]!==value))return 'legacy';
  if(Object.entries(data).some(([key,value])=>/^_studio_(intro|body|pack|background|programme_[12])_(x|y|fit)$/.test(key)&&value!==(key.endsWith('_fit')?'cover':50)))return 'legacy';
  // An existing freely placed overlay is part of the old composition too.
  if(data._studio_overlay_logo_enabled)return 'legacy';
  return 'compact';
}
/** Resolve BEFORE applying a new drag/crop/style: the first edit must not switch layout.
 * The explicit marker then round-trips through the normal project schema. */
export function preservePortraitLayout(id:string,before:ProjectData,next:ProjectData):ProjectData{
  if(!portraitPanelTemplate(id)||before._studio_format!=='portrait'||
    (before[PORTRAIT_LAYOUT]&&before[PORTRAIT_LAYOUT]!=='auto')||
    (next[PORTRAIT_LAYOUT]&&next[PORTRAIT_LAYOUT]!=='auto'))return next;
  return {...next,[PORTRAIT_LAYOUT]:portraitLayoutMode(before)};
}

export interface PortraitBox {x:number;y:number;w:number;h:number}
export type PortraitTextKey='theme'|'title'|'day'|'sub'|'credit'|'label';
export interface PortraitTextPart {field:string;x:number;y:number;w:number;h:number;size:number;regular:boolean;maxLines:number}
export interface PortraitTextFit extends SocialTextFit {height?:number;parts?:PortraitTextPart[]}
export interface PortraitContent {theme:string;title:string;day:string;sub:string;credit:string;label:string;sponsor:boolean;mentions:boolean;bottomLogoTop?:number}
export interface PortraitTextSlot {box:PortraitBox;size:number;min:number;regular:boolean;maxLines:number;parts?:PortraitTextPart[]}
export interface PortraitPanel {box:PortraitBox;slots:Partial<Record<PortraitTextKey,PortraitTextSlot>>;logos?:PortraitBox}
export type PortraitMeasure=(text:string,width:number,height:number,size:number,min:number,regular:boolean,maxLines:number,key?:PortraitTextKey)=>PortraitTextFit;
const specs:{key:PortraitTextKey;size:number;min:number;regular:boolean;maxLines:number}[]=[
  {key:'theme',size:30,min:24,regular:true,maxLines:1},
  {key:'title',size:70,min:38,regular:false,maxLines:3},
  {key:'day',size:43,min:29,regular:false,maxLines:3},
  {key:'sub',size:30,min:24,regular:true,maxLines:3},
  {key:'credit',size:25,min:21,regular:true,maxLines:2},
  {key:'label',size:23,min:19,regular:true,maxLines:1},
];
/** Content-sized full-width BTV panel. Dense content may use the existing font
 * minima; it is never clipped, abbreviated, stretched or allowed to cover >58%. */
export function measurePortraitPanel(content:PortraitContent,width:number,height:number,measure:PortraitMeasure):PortraitPanel{
  const margin=80,inside=width-2*margin,top=32,bottom=Math.max(80,content.bottomLogoTop===undefined?0:height-content.bottomLogoTop+24),maxHeight=height*.58;
  let error:unknown;
  for(let shrink=0;shrink<=32;shrink++){
    const factor=1-shrink*.02,gap=Math.max(10,Math.round(16*factor)),slots:PortraitPanel['slots']={};let cursor=top;
    try{
      for(const spec of specs){
        const text=content[spec.key];if(!text.trim())continue;
        if(cursor>top)cursor+=spec.key==='day'?Math.max(12,Math.round(20*factor)):gap;
        const size=Math.max(spec.min,Math.floor(spec.size*factor));
        const fit=measure(text,inside,Infinity,size,spec.min,spec.regular,spec.maxLines,spec.key),h=Math.ceil(fit.height??fit.lines.length*fit.size*1.14);
        slots[spec.key]={box:{x:margin,y:cursor,w:inside,h},size:fit.size,min:fit.size,regular:spec.regular,maxLines:spec.maxLines,parts:fit.parts};cursor+=h;
      }
      let logos:PortraitBox|undefined;
      if(content.sponsor||content.mentions){if(cursor>top)cursor+=gap;logos={x:margin,y:cursor,w:inside,h:65};cursor+=65;}
      const panelHeight=cursor+bottom;
      if(panelHeight>maxHeight)continue;
      const y=height-panelHeight;for(const slot of Object.values(slots))slot.box.y+=y;if(logos)logos.y+=y;
      return {box:{x:0,y,w:width,h:panelHeight},slots,logos};
    }catch(cause){error=cause;}
  }
  if(error)throw error;
  throw Error('Format 4:5 : le contenu dépasse le panneau compact. Raccourcissez les textes, masquez une option ou choisissez la mise en page historique.');
}
