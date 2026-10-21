export interface SocialTextFit {lines:string[];size:number}
export interface SocialTextBounds {width:number;actualBoundingBoxLeft?:number;actualBoundingBoxRight?:number}
export interface SocialDisplayTextFit extends SocialTextFit {scale?:number;adjustment?:'lines'|'size'}
class SocialTextOverflow extends Error {}
type Measure=(text:string,size:number)=>SocialTextBounds;
function wrap(text:string,width:number,size:number,measure:Measure){
  const lines:string[]=[];
  for(const paragraph of text.split('\n')){
    let line='';for(const word of paragraph.split(/\s+/).filter(Boolean)){
      const proposed=line?line+' '+word:word;
      if(line&&measure(proposed,size).width>width){lines.push(line);line=word;}else line=proposed;
    }lines.push(line);
  }
  return lines;
}
function extent(bounds:SocialTextBounds){return Math.max(bounds.width,(bounds.actualBoundingBoxLeft??0)+(bounds.actualBoundingBoxRight??bounds.width));}
/** Shared by layout measurement and painting: never estimate text from its character count. */
export function fitSocialText(text:string,width:number,height:number,size:number,min:number,maxLines:number,measure:Measure):SocialTextFit{
  for(let s=size;s>=min;s--){
    const lines=wrap(text,width,s,measure);
    if(lines.length<=maxLines&&lines.length*s*1.14<=height&&lines.every(line=>extent(measure(line,s))<=width))return {lines,size:s};
  }
  throw new SocialTextOverflow(`Format social : « ${text.slice(0,75)} » dépasse sa zone. Raccourcissez ce texte ou répartissez-le sur moins de lignes.`);
}

/** Editorial overflow is advice, never a fatal rendering error. Keep the native
 * fit first, then allow extra lines at charter sizes. As a final visual fallback,
 * scale measured glyphs uniformly instead of asking Canvas for microscopic fonts.
 * Layout measurement continues to use the strict fitter and its charter minima. */
export function fitSocialTextForDisplay(text:string,width:number,height:number,size:number,min:number,maxLines:number,measure:Measure):SocialDisplayTextFit{
  if(!(width>0&&Number.isFinite(width)&&height>0&&size>=min&&min>0&&Number.isFinite(size)))throw new RangeError('Zone de texte social invalide.');
  try{return fitSocialText(text,width,height,size,min,maxLines,measure);}catch(error){if(!(error instanceof SocialTextOverflow))throw error;}
  try{return {...fitSocialText(text,width,height,size,min,Infinity,measure),adjustment:'lines'};}catch(error){if(!(error instanceof SocialTextOverflow))throw error;}
  const lines=wrap(text,width,min,measure),measuredWidth=Math.max(0,...lines.map(line=>extent(measure(line,min))));
  const scale=Math.min(1,width/Math.max(1,measuredWidth),height/(lines.length*min*1.14));
  return {lines,size:min,scale,adjustment:'size'};
}
