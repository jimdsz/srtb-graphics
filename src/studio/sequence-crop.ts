import {z} from 'zod';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import type {FieldValue,ProjectData} from './domain';
import {cropMotionKey,cropMotionSchema,interpolateCrop,readCropMotions} from './crop-motion';
import {locateClip} from './media-position';
import type {ClipPosition} from './media-position';

export const sequenceCropKey=(kind:string)=>`_studio_${kind}_sequence_crops`;
export interface CropClip {url:FieldValue;start:number;end:number}
const style=z.object({x:z.number().min(0).max(100),y:z.number().min(0).max(100),fit:z.enum(['cover','contain']),motion:cropMotionSchema.optional()}).strict();
const entry=z.object({source:z.string().regex(/^[a-f0-9]{64}$/),portrait:style.optional(),vertical:style.optional()}).strict();
const schema=z.array(entry.nullable()).max(20);
export type SequenceCrops=z.infer<typeof schema>;
export type SequenceCropStyle=z.infer<typeof style>;
/** Hash only the already-selected reference, not the media bytes. The digest is
 * an identity guard, never a URL to fetch or an authorization to read a file. */
export function clipSourceKey(clip:CropClip){return bytesToHex(sha256(new TextEncoder().encode(typeof clip.url==='object'?clip.url.url:String(clip.url||''))));}
export function parseSequenceCrops(value:unknown):SequenceCrops{
  if(typeof value!=='string'||value.length>24000)throw Error('Trop de repères de cadrage dans cette liste. Retirez des repères avant d’en ajouter.');
  let input:unknown;try{input=JSON.parse(value);}catch{throw Error('Cadrages des passages illisibles.');}
  const result=schema.safeParse(input);if(!result.success)throw Error('Cadrages des passages invalides : vérifiez les positions et les repères.');return result.data;
}
export function readSequenceCrops(data:ProjectData,kind:string):SequenceCrops{try{return parseSequenceCrops(data[sequenceCropKey(kind)]??'[]');}catch{return [];}}
export function sequenceCropsPatch(kind:string,entries:SequenceCrops):ProjectData{
  const trimmed=[...entries];while(trimmed.length&&trimmed.at(-1)===null)trimmed.pop();
  const json=JSON.stringify(trimmed);parseSequenceCrops(json);return {[sequenceCropKey(kind)]:json};
}
/** Structural edits carry settings by the old index, including duplicate clips
 * using the same file. A replaced source starts without inherited crop points. */
export function editCropSequence(data:ProjectData,kind:string,clips:CropClip[],origins:number[]):ProjectData{
  const entries=readSequenceCrops(data,kind),next=clips.map((clip,index)=>{const entry=entries[origins[index]];return entry?.source===clipSourceKey(clip)?entry:null;});
  // Turning the primary source into the first passage must not discard a
  // movement the user has just prepared. Only the exact same source/marks
  // inherit it; inserting or replacing another source never does.
  if(clips.length===1&&origins[0]===-1&&String(data[`_media_${kind}_sequence`]||'[]')==='[]'){
    const primary={url:data[`_media_${kind}_url`]||'',start:Number(data[`_media_${kind}_start_seconds`]||0),end:Number(data[`_media_${kind}_end_seconds`]||0)},clip=clips[0];
    if(clipSourceKey(primary)===clipSourceKey(clip)&&primary.start===clip.start&&primary.end===clip.end){
      const motions=readCropMotions(data,kind),item:NonNullable<SequenceCrops[number]>={source:clipSourceKey(clip)};
      for(const format of ['portrait','vertical'] as const){const motion=motions[format];item[format]=style.parse({x:Number(data[`_studio_${kind}_x`]??50),y:Number(data[`_studio_${kind}_y`]??50),fit:data[`_studio_${kind}_fit`]??'cover',motion:motion?.start===clip.start&&motion.end===clip.end?motion:undefined});}
      next[0]=item;
    }
  }
  return {[`_media_${kind}_sequence`]:JSON.stringify(clips),...sequenceCropsPatch(kind,next)};
}
export function cropForClip(data:ProjectData,kind:string,clip:CropClip,index:number){
  const format=data._studio_format;if(format!=='portrait'&&format!=='vertical')return;
  const item=readSequenceCrops(data,kind)[index];return item?.source===clipSourceKey(clip)?item[format]:undefined;
}
/** Reuse the single-clip editor, with isolated per-passage settings. No new
 * properties are ever inserted into the frozen native engine's clip schema. */
export function clipCropData(data:ProjectData,kind:string,clip:CropClip,index:number):ProjectData{
  const current=cropForClip(data,kind,clip,index),format=String(data._studio_format);
  return {...data,[`_media_${kind}_url`]:clip.url,[`_media_${kind}_start_seconds`]:clip.start,[`_media_${kind}_end_seconds`]:clip.end,[`_media_${kind}_sequence`]:'[]',
    [`_studio_${kind}_x`]:current?.x??data[`_studio_${kind}_x`]??50,[`_studio_${kind}_y`]:current?.y??data[`_studio_${kind}_y`]??50,[`_studio_${kind}_fit`]:current?.fit??data[`_studio_${kind}_fit`]??'cover',
    [cropMotionKey(kind)]:JSON.stringify(current?.motion?{[format]:current.motion}:{})};
}
export function patchClipCrop(data:ProjectData,kind:string,clip:CropClip,index:number,patch:ProjectData):ProjectData{
  const format=data._studio_format;if(format!=='portrait'&&format!=='vertical')throw Error('Choisissez un format social.');
  const entries=readSequenceCrops(data,kind),settings={...clipCropData(data,kind,clip,index),...patch},source=clipSourceKey(clip);
  while(entries.length<=index)entries.push(null);
  entries[index]={...(entries[index]?.source===source?entries[index]:{}),source,[format]:style.parse({
    x:Number(settings[`_studio_${kind}_x`]),y:Number(settings[`_studio_${kind}_y`]),fit:settings[`_studio_${kind}_fit`],motion:readCropMotions(settings,kind)[format],
  })};
  return sequenceCropsPatch(kind,entries);
}
/** Only trusted source resolvers may carry a binding across URL aliases. A
 * stale guard is deliberately not rebound to a replacement file. */
export function rebindSequenceCrops(data:ProjectData,kind:string,before:CropClip[],after:CropClip[]):ProjectData{
  if(before.length!==after.length)return {};
  let changed=false;const entries=readSequenceCrops(data,kind).map((entry,index)=>{
    const old=before[index],next=after[index];if(!entry||!old||!next||old.start!==next.start||old.end!==next.end||entry.source!==clipSourceKey(old))return entry;
    const source=clipSourceKey(next);if(source===entry.source)return entry;changed=true;return {...entry,source};
  });return changed?sequenceCropsPatch(kind,entries):{};
}
/** Parse and bind once per settings revision, never once per rendered frame. */
export function matchedSequenceCrops(data:ProjectData,kind:string):Array<SequenceCropStyle|undefined>{
  const format=data._studio_format;if(format!=='portrait'&&format!=='vertical')return [];
  try{
    const clips=JSON.parse(String(data[`_media_${kind}_sequence`]||'[]')) as CropClip[],entries=readSequenceCrops(data,kind);
    return clips.map((clip,index)=>{
      const item=entries[index],value=item?.source===clipSourceKey(clip)?item[format]:undefined,motion=value?.motion;
      return value&&motion&&(motion.start!==clip.start||motion.end!==clip.end)?{...value,motion:undefined}:value;
    });
  }catch{return [];}
}
export function sequenceCropAt(styles:Array<SequenceCropStyle|undefined>,seconds:number,track:{clips:{start:number;end:number;length:number}[];loop:boolean;rate?:number},presented?:ClipPosition){
  const at=presented??locateClip(track.clips,seconds,track.loop,track.rate);if(!at)return;
  const value=styles[at.index];if(!value)return;
  const clip=track.clips[at.index],motion=value.motion;
  if(!clip)return;
  // locateClip has already applied playback speed, looping and source IN.
  const position=motion&&motion.start===clip.start&&(motion.end===0||motion.end===clip.end)?interpolateCrop(motion.points,Math.max(0,at.time-clip.start),value):value;
  return {x:position.x,y:position.y,fit:value.fit};
}
