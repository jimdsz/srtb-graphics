import {z} from 'zod';
import type {FieldValue} from './domain';
import type {CropClip} from './sequence-crop';
import {mediaKind} from './media-trim';

const descriptor=z.object({url:z.string(),name:z.string(),mimeType:z.string()}).strict();
const clipsSchema=z.array(z.object({url:z.union([z.string(),descriptor]),start:z.number(),end:z.number()}).strict()).max(20);

/** Keep the native playlist payload unchanged. Invalid drafts remain visible to
 * the editor instead of silently reverting to the original source. */
export function parseMontage(value:unknown):CropClip[]|null{
  if(value===undefined||value==='')return [];
  if(typeof value!=='string'||value.length>20000)return null;
  try{const parsed=clipsSchema.safeParse(JSON.parse(value));return parsed.success?parsed.data:null;}catch{return null;}
}

export function montageSource(value:FieldValue|undefined):string{
  return typeof value==='object'?value.url:typeof value==='string'?value:'';
}

export function montageLabel(value:FieldValue|undefined):string{
  if(typeof value==='object'&&value.name.trim())return value.name;
  const source=montageSource(value);
  if(!source)return 'Choisir un média';
  if(source.startsWith('local-media:')||source.startsWith('blob:'))return 'Média local';
  const filename=source.split(/[?#]/)[0].split('/').at(-1)||source;
  try{return decodeURIComponent(filename);}catch{return filename;}
}

/** A zero OUT means "until the source ends", never a zero-length excerpt. */
export function montageClipDuration(clip:CropClip):number|null{
  if(montageClipIssue(clip)||clip.end===0)return null;
  return (Math.round(clip.end*25)-Math.round(clip.start*25))/25;
}

/** seconds is the known subtotal; do not present it as a total if unknown > 0. */
export function montageDuration(clips:CropClip[],rate=1):{seconds:number;unknown:number}{
  const speed=Number.isFinite(rate)&&rate>0?rate:1;
  let frames=0,unknown=0;
  for(const clip of clips){const duration=montageClipDuration(clip);if(duration===null)unknown++;else frames+=Math.round(duration*25);}
  return {seconds:frames/25/speed,unknown};
}

export function montageClipIssue(clip:CropClip):string|null{
  if(!montageSource(clip.url).trim())return 'Choisissez un média pour cet extrait.';
  if(!Number.isFinite(clip.start)||!Number.isFinite(clip.end)||clip.start<0||clip.end<0||clip.start>86400||clip.end>86400)
    return 'Le début et la fin doivent être compris entre 0 et 86 400 secondes.';
  if(mediaKind(clip.url)==='image'&&(clip.start!==0||clip.end===0))
    return 'Pour une image, indiquez un début à 0 et une durée d’affichage positive.';
  if(clip.end!==0&&Math.round(clip.end*25)<=Math.round(clip.start*25))
    return 'Placez la fin après le début, avec au moins une image (0,04 s).';
  return null;
}

export function seedMontageClip(primary:FieldValue='',start=0,end=0):CropClip{
  const url=typeof primary==='object'?{...primary}:typeof primary==='string'?primary:'';
  return mediaKind(url)==='image'?{url,start:0,end:end||5}:{url,start,end};
}

export type MontageAction=
  |{type:'move';from:number;to:number}
  |{type:'duplicate';index:number}
  |{type:'remove';index:number}
  |{type:'append';clip:CropClip;origin?:number};
export interface MontageEdit {clips:CropClip[];origins:number[]}
const copyClip=(clip:CropClip):CropClip=>({...clip,url:typeof clip.url==='object'?{...clip.url}:clip.url});

/** origins bind crop motion and image scale to the exact old occurrence, even
 * when several excerpts use the same file. -1 denotes a newly selected source. */
export function montageEdit(clips:CropClip[],action:MontageAction):MontageEdit{
  const origins=clips.map((_,index)=>index),next=clips.map(copyClip);
  const check=(index:number)=>{if(!Number.isInteger(index)||index<0||index>=clips.length)throw Error('Cet extrait n’existe plus.');};
  switch(action.type){
    case 'move':{
      check(action.from);check(action.to);
      next.splice(action.to,0,next.splice(action.from,1)[0]);
      origins.splice(action.to,0,origins.splice(action.from,1)[0]);
      break;
    }
    case 'duplicate':
      check(action.index);next.splice(action.index+1,0,copyClip(clips[action.index]));origins.splice(action.index+1,0,action.index);break;
    case 'remove':
      check(action.index);next.splice(action.index,1);origins.splice(action.index,1);break;
    case 'append':{
      const origin=action.origin??-1;if(origin!==-1)check(origin);
      next.push(copyClip(action.clip));origins.push(origin);break;
    }
  }
  return {clips:next,origins};
}
