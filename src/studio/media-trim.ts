import type {FieldValue,ProjectData} from './domain';

export const frameTime=(seconds:number)=>Math.round(seconds*25)/25;
export function timeLabel(seconds:number){
  const frames=Math.max(0,Math.round(seconds*25)),s=Math.floor(frames/25);
  return `${Math.floor(s/3600).toString().padStart(2,'0')}:${Math.floor(s/60)%60<10?'0':''}${Math.floor(s/60)%60}:${(s%60).toString().padStart(2,'0')}.${(frames%25*4).toString().padStart(2,'0')}`;
}
export function mediaKind(value:FieldValue):'video'|'audio'|'image'|null{
  const mime=typeof value==='object'?value.mimeType:'';
  if(mime.startsWith('video/'))return 'video';if(mime.startsWith('audio/'))return 'audio';if(mime.startsWith('image/'))return 'image';
  const url=typeof value==='object'?value.url:String(value);
  if(/\.(mp4|webm|m4v|ogv)(?:[?#]|$)/i.test(url))return 'video';
  if(/\.(mp3|mpeg|wav|m4a|ogg)(?:[?#]|$)/i.test(url))return 'audio';
  if(/\.(png|jpe?g|webp|gif|svg)(?:[?#]|$)/i.test(url))return 'image';return null;
}
export function markedRange(which:'start'|'end',position:number,start:number,end:number,duration:number){
  const limit=Math.floor(Math.min(duration,86400)*25)/25;
  const at=Math.max(0,Math.min(limit,frameTime(position)));
  if(which==='start'){
    const next=Math.min(at,Math.max(0,limit-.04));
    return {start:frameTime(next),end:end&&end<=next?frameTime(Math.min(limit,next+.04)):end};
  }
  const next=Math.max(.04,at);
  return {start:start>=next?frameTime(Math.max(0,next-.04)):start,end:next};
}
/** A different source must not inherit offsets beyond its duration or an old playlist. */
export function replaceMedia(name:string,value:FieldValue,fields:Record<string,unknown>):ProjectData{
  const patch:ProjectData={[name]:value},prefix=name.replace(/_url$/,'');
  if(`${prefix}_start_seconds` in fields)patch[`${prefix}_start_seconds`]=0;
  if(`${prefix}_end_seconds` in fields)patch[`${prefix}_end_seconds`]=mediaKind(value)==='image'?5:0;
  if(`${prefix}_sequence` in fields)patch[`${prefix}_sequence`]='[]';
  if(`${prefix}_in_seconds` in fields)patch[`${prefix}_in_seconds`]=0;
  if(`${prefix}_out_seconds` in fields)patch[`${prefix}_out_seconds`]=0;
  const motion=`_studio_${name.slice(7,-4)}_crop_motion`;
  if(name.startsWith('_media_')&&motion in fields)patch[motion]='{}';
  const crops=`_studio_${name.slice(7,-4)}_sequence_crops`;
  if(name.startsWith('_media_')&&crops in fields)patch[crops]='[]';
  if(name==='_audio_voice_url'&&'_audio_voice_enabled' in fields)patch._audio_voice_enabled=false;
  return patch;
}
export function activateMedia(name:string):ProjectData{
  if(name.startsWith('_media_background_'))return {_background_visible:true};
  if(/^_media_programme_[12]_/.test(name))return {_media_mode:'internal'};
  const audio=name.match(/^(_audio(?:_bed|_voice)?)_/);return audio?{[`${audio[1]}_enabled`]:true}:{};
}
