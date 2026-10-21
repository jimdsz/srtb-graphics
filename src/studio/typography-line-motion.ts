import {setSvgAttribute} from './svg-attributes';

export interface NativeLineMotion {opacity:number;y:number}
/** These source subtitles animate one line, not each glyph. The native short
 * placeholder retains that line's evaluated animator. Read it after drawnFrame;
 * never seek or approximate its selector/easing here. A custom multiline value
 * remains one editor block following the original single source line. */
export function nativeLineMotion(element:any,templateId:string):NativeLineMotion|undefined{
  if(!['BTV_Renvoi','BTV_Semainier'].includes(templateId)||element?.data?.nm!=='SOUSTEXTE')return;
  const text=element.data.t,animator=text?.a?.[0],effect=animator?.a,selector=animator?.s;
  const doc=element.textProperty?.currentData;
  // Only the qualified source contract has a vertical translation with no
  // baseline, path, scale or rotation contribution in its glyph matrix.
  if(text?.a?.length!==1||selector?.b!==4||selector.r!==1||selector.rn!==0||text.p?.m!=null||
    Object.keys(effect||{}).some(key=>key!=='p'&&key!=='o')||effect?.o?.a!==0||effect.o.k!==0||
    effect.p?.a!==0||!Array.isArray(effect.p.k)||effect.p.k[0]!==0||effect.p.k[2]!==0||
    effect.p.k[1]!== (templateId==='BTV_Renvoi'?-10:0)||doc?.ps||doc?.ls)return;
  const index=doc?.l?.findIndex((letter:any)=>!letter.n)??-1;
  const letter=element.textAnimator?.renderedLetters?.[index];
  const matrix=typeof letter?.m==='string'?letter.m.match(/^matrix\(([^)]+)\)$/)?.[1].split(/[ ,]+/).map(Number):undefined;
  // A recognized but not-yet-rendered native line is not an opaque overlay.
  if(!matrix||matrix.length!==6||!matrix.every(Number.isFinite)||matrix[0]!==1||matrix[1]!==0||matrix[2]!==0||matrix[3]!==1||
    !Number.isFinite(letter.o)||letter.o<0||letter.o>1)return {opacity:0,y:0};
  // matrix[4] includes the placeholder's right/centre alignment. Copying it
  // would move the customized text according to A's width, not its own width.
  return {opacity:letter.o,y:matrix[5]};
}

export function applyNativeLineMotion(text:SVGTextElement,motion:NativeLineMotion|undefined){
  setSvgAttribute(text,'opacity',motion?String(motion.opacity):null);
  setSvgAttribute(text,'transform',motion?`translate(0 ${motion.y})`:null);
}
