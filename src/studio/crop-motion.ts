import {z} from 'zod';
import type {ProjectData} from './domain';
import {locateClip} from './media-position';
import type {ClipPosition} from './media-position';

export const cropMotionKey=(kind:string)=>`_studio_${kind}_crop_motion`;
const point=z.object({at:z.number().min(0).max(86400),x:z.number().min(0).max(100),y:z.number().min(0).max(100),transition:z.enum(['smooth','linear','cut'])}).strict();
export const cropMotionSchema=z.object({start:z.number().min(0).max(86400),end:z.number().min(0).max(86400),duration:z.number().positive().max(86400),points:z.array(point).min(1).max(120)}).strict().superRefine((value,ctx)=>{
  if(value.end&&value.end<=value.start)ctx.addIssue({code:'custom',message:'Fin du passage invalide.'});
  for(let i=0;i<value.points.length;i++)if(value.points[i].at>value.duration||i>0&&value.points[i].at<=value.points[i-1].at)ctx.addIssue({code:'custom',message:'Repères de cadrage hors du passage ou non ordonnés.'});
});
const schema=z.object({portrait:cropMotionSchema.optional(),vertical:cropMotionSchema.optional()}).strict();
export type CropPoint=z.infer<typeof point>;
export type CropMotion=z.infer<typeof cropMotionSchema>;
export type CropMotions=z.infer<typeof schema>;
export function parseCropMotion(value:unknown):CropMotions{
  if(typeof value!=='string'||value.length>24000)throw Error('Les repères de cadrage sont invalides.');
  let parsed:unknown;try{parsed=JSON.parse(value);}catch{throw Error('Les repères de cadrage sont illisibles.');}
  const checked=schema.safeParse(parsed);if(!checked.success)throw Error('Les repères de cadrage doivent être ordonnés, dans le passage et dans le cadre (120 maximum par format).');
  return checked.data;
}
export function readCropMotions(data:ProjectData,kind:string):CropMotions{try{return parseCropMotion(data[cropMotionKey(kind)]??'{}');}catch{return {};}}
export function currentCropMotion(data:ProjectData,kind:string):CropMotion|undefined{
  const format=data._studio_format;if(format!=='portrait'&&format!=='vertical')return;
  return readCropMotions(data,kind)[format];
}
/** Source time relative to the selected IN, before playback speed. Changed
 * trims or an active playlist invalidate points, never the media itself. */
export function cropMotionMatches(data:ProjectData,kind:string,motion:CropMotion){
  return String(data[`_media_${kind}_sequence`]||'[]')==='[]'&&motion.start===Number(data[`_media_${kind}_start_seconds`]||0)&&motion.end===Number(data[`_media_${kind}_end_seconds`]||0);
}
export function interpolateCrop(points:CropPoint[],seconds:number,fallback:{x:number;y:number}){
  if(!points.length)return fallback;
  if(seconds<=points[0].at)return {x:points[0].x,y:points[0].y};
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i];if(seconds>b.at)continue;
    let t=(seconds-a.at)/(b.at-a.at);
    if(b.transition==='cut')t=seconds<b.at?0:1;
    else if(b.transition==='smooth')t=t*t*(3-2*t);
    return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
  }
  const last=points.at(-1)!;return {x:last.x,y:last.y};
}
export function motionCrop(data:ProjectData,kind:string,seconds:number,motion:CropMotion|null|undefined=currentCropMotion(data,kind),track?:{clips:{start:number;length:number}[];loop:boolean;rate?:number},presented?:ClipPosition){
  const fallback={x:Number(data[`_studio_${kind}_x`]??50),y:Number(data[`_studio_${kind}_y`]??50)};
  if(!motion||!cropMotionMatches(data,kind,motion))return fallback;
  // The resolved native track is authoritative: AE models can loop a short
  // untrimmed video even when their form has no loop setting. Use the same
  // source position as the decoder, including its last-frame hold.
  // A still without OUT has an infinite native duration. Its crop movement
  // retains the explicit editor duration and loop setting below.
  const at=track?.clips.length===1&&Number.isFinite(track.clips[0].length)?presented??locateClip(track.clips,seconds,track.loop,track.rate):undefined;
  if(at)return interpolateCrop(motion.points,Math.max(0,at.time-track!.clips[at.index].start),fallback);
  const rate=Number(data[`_media_${kind}_rate`]??1),elapsed=Math.max(0,seconds)*rate;
  const local=data[`_media_${kind}_loop`]===true?elapsed%motion.duration:Math.min(elapsed,motion.duration);
  return interpolateCrop(motion.points,local,fallback);
}
export function patchCropMotion(data:ProjectData,kind:string,motion:CropMotion|undefined):ProjectData{
  const format=data._studio_format;if(format!=='portrait'&&format!=='vertical')throw Error('Choisissez le format 4:5 ou 9:16 pour recadrer.');
  const all=readCropMotions(data,kind);if(motion)all[format]=motion;else delete all[format];
  const json=JSON.stringify(all);parseCropMotion(json);return {[cropMotionKey(kind)]:json};
}
export function placeCropPoint(motion:CropMotion,point:CropPoint):CropMotion{
  const points=motion.points.filter(value=>Math.abs(value.at-point.at)>.019);points.push(point);points.sort((a,b)=>a.at-b.at);
  if(points.length>120)throw Error('120 repères maximum. Retirez un repère avant d’en ajouter.');
  return {...motion,points};
}
