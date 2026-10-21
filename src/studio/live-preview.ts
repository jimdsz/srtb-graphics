import type {BroadcastTemplate,ProjectData} from './domain';
import {currentStyle,textFields,TYPOGRAPHY_KEY} from './typography-model';
import {nativeTextStyle} from './typography-position';
import {parseCropMotion} from './crop-motion';
import {parseSequenceCrops} from './sequence-crop';
import {renvoiSignageAvailable,renvoiSignageKey} from './renvoi-signage';

/** A fast edit must not bypass a media, timing, voice or layout validation. */
export function liveTextEdit(template:BroadcastTemplate,before:ProjectData,next:ProjectData,social=false){
  const fields=new Set(textFields(template).map(([key])=>key));
  const changed=[...new Set([...Object.keys(before),...Object.keys(next)])].filter(key=>JSON.stringify(before[key])!==JSON.stringify(next[key]));
  if(!changed.length)return true;
  const crop=(key:string)=>{
    const match=/^_studio_(.+)_(x|y|fit|crop_motion|sequence_crops)$/.exec(key);if(!social||!match||!template.fields[`_media_${match[1]}_url`])return false;
    if(match[2]==='sequence_crops'){try{if(!template.fields[`_media_${match[1]}_sequence`])return false;parseSequenceCrops(next[key]);return true;}catch{return false;}}
    if(match[2]==='crop_motion'){try{parseCropMotion(next[key]);return true;}catch{return false;}}
    return match[2]==='fit'?['cover','contain'].includes(String(next[key])):typeof next[key]==='number'&&Number.isFinite(next[key])&&Number(next[key])>=0&&Number(next[key])<=100;
  };
  const card=(key:string)=>{
    if(!social)return false;
    if(key==='_studio_portrait_layout')return ['auto','compact','legacy'].includes(String(next[key]));
    if(/^_studio_(portrait|vertical)_card_compact$/.test(key))return typeof next[key]==='boolean';
    if(/^_studio_(portrait|vertical)_card_scale$/.test(key))return typeof next[key]==='number'&&Number.isFinite(next[key])&&Number(next[key])>=50&&Number(next[key])<=100;
    return false;
  };
  const signage=(key:string)=>!social&&renvoiSignageAvailable(template,next)&&renvoiSignageKey(key)&&typeof next[key]==='boolean';
  if(changed.some(key=>key!==TYPOGRAPHY_KEY&&!fields.has(key)&&!crop(key)&&!card(key)&&!signage(key)))return false;
  if(social)return true;
  for(const field of fields){
    const oldStyle=currentStyle(before,field),newStyle=currentStyle(next,field);
    // Entering custom typography must establish the same native placeholder and
    // auto-fit geometry as a freshly exported scene. Leaving it restores the real
    // native glyphs. Subsequent styled edits can reuse that canonical geometry.
    if(nativeTextStyle(oldStyle)!==nativeTextStyle(newStyle))return false;
    if(before[field]!==next[field]){
      if(nativeTextStyle(newStyle)||!!String(before[field]??'').trim()!==!!String(next[field]??'').trim())return false;
    }
  }
  return true;
}

/** Coalesce typing and sliders, never repeat a failed snapshot in a loop. */
export function previewUpdateNeeded(signature:string,applied:string,attempted:string,ready:boolean,blocked:boolean){
  return ready&&!blocked&&signature!==applied&&signature!==attempted;
}
