import {z} from 'zod';
import type {BroadcastTemplate,FieldValue,ProjectData} from './domain';

export const IMAGE_SIZES='_studio_image_sizes';
const keyPattern=/^(tv|portrait|vertical):_media_[a-z0-9_]+_(?:url|sequence:\d{1,2})$/;
const schema=z.record(z.string().regex(keyPattern),z.number().min(10).max(300)).refine(value=>Object.keys(value).length<=180);
export type ImageSizes=Record<string,number>;
export function parseImageSizes(value:unknown):ImageSizes{
  if(typeof value!=='string'||value.length>12000)throw Error('Réglages de taille des images invalides.');
  let input:unknown;try{input=JSON.parse(value);}catch{throw Error('Réglages de taille des images illisibles.');}
  const parsed=schema.safeParse(input);if(!parsed.success)throw Error('La taille des images doit être comprise entre 10 et 300 %.');return parsed.data;
}
export function readImageSizes(data:ProjectData):ImageSizes{try{return parseImageSizes(data[IMAGE_SIZES]??'{}');}catch{return {};}}
export function imageSizeKey(data:ProjectData,field:string){return `${data._studio_format||'tv'}:${field}`;}
export function imageScale(data:ProjectData,field:string){return readImageSizes(data)[imageSizeKey(data,field)]??100;}
export function imageSizePatch(data:ProjectData,field:string,scale:number):ProjectData{
  const next={...readImageSizes(data)},key=imageSizeKey(data,field);
  if(scale===100)delete next[key];else next[key]=scale;
  const json=JSON.stringify(next);parseImageSizes(json);return {[IMAGE_SIZES]:json};
}
export function reorderImageSizes(data:ProjectData,sequence:string,origins:number[]):ProjectData{
  const previous=readImageSizes(data),next={...previous};
  for(const format of ['tv','portrait','vertical']){
    const prefix=`${format}:${sequence}:`;
    for(const key of Object.keys(next))if(key.startsWith(prefix))delete next[key];
    origins.forEach((origin,index)=>{const value=previous[prefix+origin];if(value!==undefined)next[prefix+index]=value;});
  }
  return {[IMAGE_SIZES]:JSON.stringify(next)};
}
export function isResizableImage(value:FieldValue|undefined){
  if(value&&typeof value==='object')return /^image\/(png|jpeg|webp|svg\+xml)$/.test(value.mimeType);
  return typeof value==='string'&&/\.(png|jpe?g|webp|svg)(?:[?#]|$)/i.test(value);
}
export function imageSizeFields(template:BroadcastTemplate){return Object.keys(template.fields).filter(key=>/^_media_.*_(url|sequence)$/.test(key));}
/** Scale within the original source frame, retaining aspect ratio and alpha.
 * Every native/media compositor therefore sees the same adjusted picture. */
export function resizedImageGeometry(width:number,height:number,percent:number,maxEdge=3840){
  const bounded=Math.min(1,maxEdge/Math.max(width,height));
  const w=Math.max(1,Math.round(width*bounded)),h=Math.max(1,Math.round(height*bounded)),scale=percent/100;
  return {width:w,height:h,x:w*(1-scale)/2,y:h*(1-scale)/2,w:w*scale,h:h*scale};
}
