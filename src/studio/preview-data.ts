import type {ProjectData} from './domain';

/** A paused frame seek has no running-clock elapsed time in the BA engine. */
export function previewSeconds(status:{phase?:string;elapsed?:number;frame?:number}):number|undefined{
  if(status.phase==='inspection'&&Number.isFinite(status.frame))return status.frame!/25;
  if(Number.isFinite(status.elapsed))return status.elapsed;
  if(Number.isFinite(status.frame))return status.frame!/25;
}

export function previewData(data:ProjectData,muted:boolean,nativeMute=false,audioPrepared=false):ProjectData{
  // Native master mute already silences video sound. Rewriting its enable flags
  // would make BA rebuild and re-download the entire video when toggling sound.
  // Standalone audio remains lazy until the first explicit activation; once
  // prepared, the native master mute keeps its buffers reusable.
  const suppress=muted&&!(nativeMute&&audioPrepared);
  return Object.fromEntries(Object.entries(data).map(([key,value])=>[
    key,suppress&&/^(?:_media_.*_audio|_audio(?:_.*)?)_enabled$/.test(key)&&!(nativeMute&&key.startsWith('_media_'))?false:value,
  ]));
}
