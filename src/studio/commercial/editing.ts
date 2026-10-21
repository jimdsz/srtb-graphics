import {commercialPageStyle,commercialTextSlots,updateCommercialTextPage} from './model';
import type {CommercialData} from './model';
import {canonicalCommercialLogo,editCommercialLogo} from './logo-layout';
import type {CommercialLogoSize} from './logo-layout';

export interface CommercialSelection {kind:'title'|'body'|'logo';page:number}
export interface CommercialEditBox extends CommercialSelection {x:number;y:number;width:number;height:number;rotation:number}
export const selectionKey=(item:CommercialSelection)=>`${item.kind}-${item.page}`;
const clamp=(value:number,min:number,max:number)=>Math.min(max,Math.max(min,value));
export function elementSettings(data:CommercialData,item:CommercialSelection,logoSize?:CommercialLogoSize|null){
  if(item.kind==='logo'){const logo=data.logo&&logoSize?canonicalCommercialLogo(data.logo,logoSize):data.logo;return {x:logo?.offsetX??0,y:logo?.offsetY??0,scale:logo?.scale??1,min:.25,max:4,limitX:600,limitY:400};}
  const slot=commercialTextSlots(data)[item.page],style=commercialPageStyle(slot?.page??{title:'',body:''},slot?.kind??0),target=item.kind;
  return {x:style[`${target}X`]??0,y:style[`${target}Y`]??0,scale:style[`${target}Scale`],min:target==='title'?.6:.65,max:1.4,limitX:200,limitY:200};
}
export function editCommercialElement(data:CommercialData,item:CommercialSelection,patch:Partial<{x:number;y:number;scale:number}>,logoSize?:CommercialLogoSize|null):CommercialData{
  const current=elementSettings(data,item,logoSize),x=clamp(patch.x??current.x,-current.limitX,current.limitX),y=clamp(patch.y??current.y,-current.limitY,current.limitY),scale=clamp(patch.scale??current.scale,current.min,current.max);
  if(item.kind==='logo')return data.logo?{...data,logo:logoSize?editCommercialLogo(data.logo,{offsetX:x,offsetY:y,scale},logoSize):{...data.logo,offsetX:x,offsetY:y,scale}}:data;
  const slot=commercialTextSlots(data)[item.page];if(!slot)return data;
  return updateCommercialTextPage(data,item.page,{...slot.page,style:{...commercialPageStyle(slot.page,slot.kind),[`${item.kind}X`]:x,[`${item.kind}Y`]:y,[`${item.kind}Scale`]:scale}});
}
