import type {BroadcastTemplate,ProjectData} from './domain';
import {fontFamily,prepareTextFonts} from './typography-fonts';
import {patchTextStyle} from './typography-model';
import {proposeWeeklyTitleFit,WEEKLY_TITLE_AREA,weeklyTitleFitRequest} from './weekly-title-fit';

/** One explicit measurement operation; no preview media, frame hooks or writes. */
export async function measureWeeklyTitleFit(template:BroadcastTemplate,data:ProjectData,field:string){
  const request=weeklyTitleFitRequest(template,data,field);
  if(!request)throw Error('La proposition concerne uniquement les titres des sept programmes du semainier TV.');
  // Load only the selected field's font, not unrelated imported fonts in a project.
  await prepareTextFonts({_studio_format:'tv',...patchTextStyle({_studio_format:'tv'},field,{font:request.style.font})},template.module);
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),text=document.createElementNS(ns,'text');
  svg.setAttribute('aria-hidden','true');svg.style.cssText='position:fixed;left:-10000px;top:0;width:1px;height:1px;visibility:hidden;overflow:visible;pointer-events:none';
  const {style}=request;
  text.setAttribute('font-family',fontFamily(style.font,true));text.setAttribute('font-weight',style.bold?'700':'400');text.setAttribute('font-style',style.italic?'italic':'normal');
  text.setAttribute('letter-spacing',String(style.tracking));text.setAttribute('text-anchor',style.align==='left'?'start':style.align==='center'?'middle':'end');text.setAttribute('xml:space','preserve');
  const spans=request.text.split('\n').map(line=>{const span=document.createElementNS(ns,'tspan');span.setAttribute('x','0');span.textContent=line;return span;});
  text.append(...spans);svg.append(text);document.body.append(svg);
  try{return proposeWeeklyTitleFit(request,size=>{
    const pixels=WEEKLY_TITLE_AREA.fontSize*size/100;text.setAttribute('font-size',String(pixels));
    spans.forEach((span,index)=>span.setAttribute('y',String(index*pixels*style.lineHeight)));
    const {x,y,width,height}=text.getBBox();return {x,y,width,height};
  });}finally{svg.remove();}
}
