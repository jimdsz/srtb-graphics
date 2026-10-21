import type {ProjectData} from './domain';
import {currentStyle,patchTextStyle} from './typography-model';
import type {TextStyle} from './typography-model';

/** Position-only edits keep the original glyphs, layout and animation. */
export function nativeTextStyle(style:Partial<TextStyle>|undefined){return !style||Object.keys(style).every(key=>key==='x'||key==='y');}
export const clampTextPosition=(value:number)=>Math.round(Math.max(-4096,Math.min(4096,value)));
export function positionText(data:ProjectData,field:string,x:number,y:number){return {...data,...patchTextStyle(data,field,{x:clampTextPosition(x),y:clampTextPosition(y)})};}
export function textArrow(event:{key:string;shiftKey?:boolean;ctrlKey?:boolean;altKey?:boolean;metaKey?:boolean}):[number,number]|null{
  if(event.ctrlKey||event.altKey||event.metaKey)return null;
  const directions:Record<string,[number,number]>={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]},delta=Object.hasOwn(directions,event.key)?directions[event.key]:undefined;
  return delta?[delta[0]*(event.shiftKey?10:1),delta[1]*(event.shiftKey?10:1)]:null;
}
export function nudgeText(data:ProjectData,field:string,delta:[number,number]){const style=currentStyle(data,field);return positionText(data,field,(style?.x??0)+delta[0],(style?.y??0)+delta[1]);}
/** Convert output-screen displacement to a transformed parent's local axes. */
export function localDisplacement(matrix:{a:number;b:number;c:number;d:number},x:number,y:number):[number,number]{
  const determinant=matrix.a*matrix.d-matrix.b*matrix.c;
  return Math.abs(determinant)<1e-10?[0,0]:[(matrix.d*x-matrix.c*y)/determinant,(-matrix.b*x+matrix.a*y)/determinant];
}
