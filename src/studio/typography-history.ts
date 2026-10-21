import type {ProjectData} from './domain';
import {styleKey,textStyles,TYPOGRAPHY_KEY} from './typography-model';
import type {TextStyle} from './typography-model';
export interface TextStyleUndo {key:string;before:Partial<TextStyle>|undefined;after:Partial<TextStyle>|undefined}
export function textStyleUndo(before:ProjectData,after:ProjectData,field:string):TextStyleUndo{const key=styleKey(field,String(before._studio_format||'tv'));return {key,before:textStyles(before)[key],after:textStyles(after)[key]};}
/** Undo our own unchanged properties only. Later moves/edits and other fields win. */
export function undoTextStyle(data:ProjectData,undo:TextStyleUndo):ProjectData{
  const styles=textStyles(data),current={...styles[undo.key]};
  for(const key of new Set([...Object.keys(undo.before||{}),...Object.keys(undo.after||{})]) as Set<keyof TextStyle>){
    if(undo.before?.[key]===undo.after?.[key]||current[key]!==undo.after?.[key])continue;
    if(undo.before&&Object.hasOwn(undo.before,key))Object.assign(current,{[key]:undo.before[key]});else delete current[key];
  }
  if(Object.keys(current).length)styles[undo.key]=current;else delete styles[undo.key];
  return {[TYPOGRAPHY_KEY]:JSON.stringify(styles)};
}
