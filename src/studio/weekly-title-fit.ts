import type {BroadcastTemplate,ProjectData} from './domain';
import {currentStyle,DEFAULT_TEXT_CASE,defaultTextCaseData,patchTextStyle,shapedText,styleDefaults} from './typography-model';
import type {TextStyle} from './typography-model';

// Stable SOUSTEXTE pose in the pinned AE source: [1801,1000] minus [-.8,0].
// Keep the model's horizontal margins; this is not a promise about moving poses.
export const WEEKLY_TITLE_AREA={left:119,right:1802,top:0,bottom:1080,anchorX:1801.8,anchorY:1000,fontSize:41} as const;
// The right anchor ends the typographic advance, not every glyph's ink box.
// Allow at most two output pixels of terminal ink beyond the nominal edge;
// never relax the left fitting edge or the permitted manual anchor position.
export const WEEKLY_TITLE_RIGHT_INK_ALLOWANCE=2;
type Template=Pick<BroadcastTemplate,'id'|'version'|'libraryVersion'|'module'|'fields'>;
export interface WeeklyTitleFitRequest {signature:string;field:string;text:string;style:TextStyle}
export interface WeeklyTitleBounds {x:number;y:number;width:number;height:number}
export type WeeklyTitleFitProposal={signature:string;current:number}&(
  {kind:'unchanged'}|{kind:'resize';size:number}|{kind:'unavailable';reason:string}
);

export function canFitWeeklyTitle(template:Template,data:ProjectData,field:string){
  return template.id==='BTV_Semainier'&&template.version==='1.0.0'&&template.libraryVersion==='1.7.0'&&(!data._studio_format||data._studio_format==='tv')&&/^programme_[1-7]_title$/.test(field)&&Object.hasOwn(template.fields,field);
}
export function weeklyTitleFitRequest(template:Template,data:ProjectData,field:string):WeeklyTitleFitRequest|null{
  if(!canFitWeeklyTitle(template,data,field))return null;
  const own=currentStyle(data,field),style={...styleDefaults,...own};
  const signature=JSON.stringify([template.id,template.version,template.libraryVersion,template.module,field,data._studio_format??'tv',data[field],data[DEFAULT_TEXT_CASE],own]);
  return {signature,field,style,text:shapedText(defaultTextCaseData(template,data)[field],own??{})};
}

/** The caller measures the actual font at each candidate size. In particular,
 * fixed tracking, italic overhangs and imported fonts must not be approximated
 * by multiplying the current advance or counting characters. */
export function proposeWeeklyTitleFit(request:WeeklyTitleFitRequest,measure:(size:number)=>WeeklyTitleBounds):WeeklyTitleFitProposal{
  const {style,text,signature}=request,current=style.size,base={signature,current};
  const unavailable=(reason:string):WeeklyTitleFitProposal=>({...base,kind:'unavailable',reason});
  if(!text.trim())return unavailable('Saisissez un titre pour proposer une taille.');
  if(style.rotation!==0)return unavailable('La rotation empêche cette proposition de largeur. Les réglages manuels restent disponibles.');
  const x=WEEKLY_TITLE_AREA.anchorX+style.x,y=WEEKLY_TITLE_AREA.anchorY+style.y;
  if(x<WEEKLY_TITLE_AREA.left||x>WEEKLY_TITLE_AREA.right||y<WEEKLY_TITLE_AREA.top||y>WEEKLY_TITLE_AREA.bottom)return unavailable('Le point d’ancrage est hors de la zone du modèle. Ajustez sa position ou conservez votre placement manuel.');
  const fits=(size:number)=>{
    const box=measure(size);
    if(!Object.values(box).every(Number.isFinite)||box.width<=0||box.height<=0)throw Error('La police ne fournit pas de mesure exploitable. Vérifiez la police puis réessayez.');
    return x+box.x>=WEEKLY_TITLE_AREA.left&&x+box.x+box.width<=WEEKLY_TITLE_AREA.right+WEEKLY_TITLE_RIGHT_INK_ALLOWANCE&&y+box.y>=WEEKLY_TITLE_AREA.top&&y+box.y+box.height<=WEEKLY_TITLE_AREA.bottom;
  };
  if(fits(current))return {...base,kind:'unchanged'};
  // At most 390 measurements, only on explicit request. Descending integer
  // candidates also handle negative tracking without assuming monotonic bounds.
  for(let size=Math.ceil(current)-1;size>=10;size--)if(fits(size))return {...base,kind:'resize',size};
  return unavailable('Aucune taille entre 10 % et la taille actuelle ne tient dans cette zone avec ce style et ce placement. Ajustez manuellement la mise en forme.');
}
export function applyWeeklyTitleFit(template:Template,data:ProjectData,field:string,proposal:WeeklyTitleFitProposal):ProjectData{
  const current=weeklyTitleFitRequest(template,data,field);
  if(!current||current.signature!==proposal.signature)throw Error('Le texte, le style ou le format a changé. Demandez une nouvelle proposition.');
  if(proposal.kind!=='resize'||!Number.isInteger(proposal.size)||proposal.size<10||proposal.size>=current.style.size)throw Error('Cette proposition ne peut pas être appliquée.');
  return patchTextStyle(data,field,{size:proposal.size});
}
