import {COMMERCIAL_MAX_SEQUENCES,COMMERCIAL_MAX_DURATION,COMMERCIAL_MIN_SEQUENCE_DURATION,COMMERCIAL_MAX_TEXT_LINES,commercialPageStyle,commercialTextSlots,commercialSequenceKind,createCommercialSequences,effectiveCommercialDuration} from './model';
import type {CommercialData,CommercialPage,CommercialSequence,CommercialTextStyle} from './model';
import {commercialFontFamily,commercialTextCase,loadCommercialFonts} from './typography';
import {COMMERCIAL_READING_FONT,loadCommercialTemplateFonts} from './template-fonts';
import {paginateReadableText,wrapReadableText} from './text-pagination';

export interface ReadableRect {x:number;y:number;width:number;height:number}
export interface ReadableTextBlock {rect:ReadableRect;pivot:{x:number;y:number};lines:string[];size:number;leading:number;height:number;ascent:number;font:string;letterSpacing:string}
export interface ReadablePageLayout {panel:ReadableRect;title:ReadableTextBlock;body:ReadableTextBlock;style:CommercialTextStyle;maxBodyLines:number;issues:string[]}
export const READABLE_BODY_MINIMUM=42,READABLE_BODY_SIZE=48,READABLE_BODY_LINES=COMMERCIAL_MAX_TEXT_LINES;
export const READABLE_AREA_TOP=224,READABLE_AREA_BOTTOM=732,READABLE_AREA_CENTER_Y=(READABLE_AREA_TOP+READABLE_AREA_BOTTOM)/2;
export const isReadableCommercial=(data:CommercialData)=>data.textMode==='summary'||data.textMode==='full';
const layouts=new WeakMap<CommercialPage,Map<string,ReadablePageLayout>>();

function font(size:number,style:CommercialTextStyle,target:'title'|'body') {
  const family=commercialFontFamily(style[target==='title'?'titleFont':'bodyFont'],COMMERCIAL_READING_FONT);
  return `${style[target==='title'?'titleItalic':'bodyItalic']?'italic ':''}${style[target==='title'?'titleBold':'bodyBold']?'700 ':''}${size}px "${family}"`;
}
export function setReadableTextFont(context:CanvasRenderingContext2D,block:ReadableTextBlock) {context.font=block.font;context.letterSpacing=block.letterSpacing;}
function panelFor(layout:CommercialSequence['layout'],slot:number):ReadableRect {
  const area={y:READABLE_AREA_TOP,height:READABLE_AREA_BOTTOM-READABLE_AREA_TOP};
  if(layout==='columns')return {...area,x:slot?1000:144,width:776};
  if(layout==='left')return {...area,x:160,width:1264};
  if(layout==='right')return {...area,x:496,width:1264};
  const width=layout==='final'?1344:1472;
  return {...area,x:960-width/2,width};
}
function textBlock(context:CanvasRenderingContext2D,text:string,style:CommercialTextStyle,target:'title'|'body',size:number,width:number):ReadableTextBlock {
  const blockFont=font(size,style,target),letterSpacing=`${size*style.tracking}px`;
  context.font=blockFont;context.letterSpacing=letterSpacing;
  const display=commercialTextCase(text,style[target==='title'?'titleCase':'bodyCase']);
  const lines=wrapReadableText(display,width,line=>context.measureText(line).width).map(line=>line.text);
  const leading=size*(target==='title'?1.05:1.28*Math.max(.9,style.lineHeight));
  // Reserve the same font metrics for every line. An accent in one column
  // must not move its header edge or the adjacent body text down.
  const metrics=context.measureText('ÉAg'),ascent=metrics.actualBoundingBoxAscent;
  const glyphHeight=Math.max(ascent+metrics.actualBoundingBoxDescent,size*.65);
  const height=Math.max(0,lines.length-1)*leading+glyphHeight;
  return {rect:{x:0,y:0,width,height},pivot:{x:0,y:0},lines,size,leading,height,ascent,font:blockFont,letterSpacing};
}
export function readablePageLayout(context:CanvasRenderingContext2D,page:CommercialPage,layout:CommercialSequence['layout'],slot=0):ReadablePageLayout {
  const key=`${layout}/${slot}`,cached=layouts.get(page)?.get(key);if(cached)return cached;
  const kind=commercialSequenceKind(layout,slot),style=commercialPageStyle(page,kind,true),panel=panelFor(layout,slot),padding=layout==='columns'?44:64,width=panel.width-padding*2;
  const title=textBlock(context,page.title,style,'title',(kind===0?80:72)*style.titleScale,width);
  const body=textBlock(context,page.body,style,'body',Math.max(READABLE_BODY_MINIMUM,READABLE_BODY_SIZE*style.bodyScale),width);
  const gap=52,titleHeight=Math.min(title.height,title.leading+title.size),bodyAvailable=panel.height-80-titleHeight-gap;
  const glyphHeight=body.height-Math.max(0,body.lines.length-1)*body.leading;
  const maxBodyLines=Math.max(0,Math.min(READABLE_BODY_LINES,Math.floor((bodyAvailable-glyphHeight)/body.leading)+1));
  const visibleBodyHeight=Math.min(body.height,Math.max(0,(maxBodyLines-1)*body.leading+glyphHeight));
  const panelHeight=Math.min(panel.height,Math.max(320,titleHeight+gap+visibleBodyHeight+80));
  if(layout!=='columns')panel.y=READABLE_AREA_CENTER_Y-panelHeight/2;panel.height=panelHeight;
  const titleTop=panel.y+40;
  title.rect={x:panel.x+padding,y:titleTop,width,height:titleHeight};title.pivot={x:panel.x+panel.width/2,y:titleTop+titleHeight/2};
  body.rect={x:panel.x+padding,y:titleTop+titleHeight+gap,width,height:Math.max(0,bodyAvailable)};body.pivot={x:panel.x+panel.width/2,y:body.rect.y+visibleBodyHeight/2};
  const issues:string[]=[];
  setReadableTextFont(context,title);
  if(title.lines.length>2||title.lines.some(line=>context.measureText(line).width>width+.01)||title.height>panel.height-160)issues.push('Le titre est trop long à cette taille. Raccourcissez-le ou réduisez ses réglages.');
  if(page.body.trim()&&(body.lines.length>maxBodyLines||body.height>bodyAvailable+.01))issues.push(`Le texte occupe ${body.lines.length} lignes (${maxBodyLines} maximum). Résumez le message à l’essentiel pour cet écran.`);
  const result={panel,title,body,style,maxBodyLines,issues};
  const entries=layouts.get(page)??new Map<string,ReadablePageLayout>();entries.set(key,result);layouts.set(page,entries);return result;
}

function transformedCorners(rect:ReadableRect,pivot:{x:number;y:number},style:CommercialTextStyle,target:'title'|'body') {
  const angle=Number(style[target==='title'?'titleRotation':'bodyRotation']??0)*Math.PI/180,dx=Number(style[target==='title'?'titleX':'bodyX']??0),dy=Number(style[target==='title'?'titleY':'bodyY']??0);
  return [[rect.x,rect.y],[rect.x+rect.width,rect.y],[rect.x,rect.y+rect.height],[rect.x+rect.width,rect.y+rect.height]].map(([x,y])=>({x:pivot.x+dx+(x-pivot.x)*Math.cos(angle)-(y-pivot.y)*Math.sin(angle),y:pivot.y+dy+(x-pivot.x)*Math.sin(angle)+(y-pivot.y)*Math.cos(angle)}));
}
export function readableTextBounds(context:CanvasRenderingContext2D,block:ReadableTextBlock,style:CommercialTextStyle,target:'title'|'body'):ReadableRect {
  setReadableTextFont(context,block);const align=target==='title'?'center':style.align;
  const width=Math.max(1,...block.lines.map(line=>context.measureText(line).width));
  const rect={x:block.rect.x+(align==='center'?(block.rect.width-width)/2:align==='right'?block.rect.width-width:0),y:block.rect.y,width,height:block.height};
  const points=transformedCorners(rect,block.pivot,style,target),x=Math.min(...points.map(p=>p.x)),y=Math.min(...points.map(p=>p.y));
  return {x,y,width:Math.max(...points.map(p=>p.x))-x,height:Math.max(...points.map(p=>p.y))-y};
}
export function readableTextIssues(context:CanvasRenderingContext2D,data:CommercialData,logo?:ReadableRect,onlySequences?:ReadonlySet<string>):string[] {
  const errors:string[]=[],sequences=createCommercialSequences(data).sequences!;
  commercialTextSlots(data).forEach(({page,sequenceIndex,slot,label})=>{
    if(onlySequences&&!onlySequences.has(sequences[sequenceIndex].id))return;
    const layout=readablePageLayout(context,page,sequences[sequenceIndex].layout,slot);layout.issues.forEach(issue=>errors.push(`${label} : ${issue}`));
    for(const target of ['title','body'] as const){
      if(!page[target].trim())continue;
      // Oversized draft text is not drawn in full. Its undisplayed remainder
      // must not generate misleading displacement or logo-collision errors.
      if(target==='body'&&(layout.body.lines.length>layout.maxBodyLines||layout.body.height>layout.body.rect.height+.01))continue;
      if(target==='title'&&layout.issues.some(issue=>issue.startsWith('Le titre')))continue;
      const box=readableTextBounds(context,layout[target],layout.style,target);
      if(box.x<96||box.y<96||box.x+box.width>1824||box.y+box.height>984)errors.push(`${label} : ${target==='title'?'le titre':'le texte'} sort de la zone lisible. Réduisez son déplacement ou sa rotation.`);
      if(logo&&box.x<logo.x+logo.width+16&&box.x+box.width>logo.x-16&&box.y<logo.y+logo.height+16&&box.y+box.height>logo.y-16)errors.push(`${label} : le logo recouvre ${target==='title'?'le titre':'le texte'}. Déplacez-le dans la zone réservée en bas.`);
    }
  });
  return errors;
}

/** Explicit pagination: no summary, no lost character, no mutation before success. */
export async function splitCommercialPages(data:CommercialData,options:{index?:number;signal?:AbortSignal}={}):Promise<CommercialData> {
  if(!isReadableCommercial(data))throw Error('Choisissez d’abord « Synthèse visuelle » ou « Texte intégral » pour répartir le contenu.');
  options.signal?.throwIfAborted();await loadCommercialTemplateFonts();await loadCommercialFonts(commercialTextSlots(data).map(slot=>slot.page),options.signal);options.signal?.throwIfAborted();
  const canvas=document.createElement('canvas'),context=canvas.getContext('2d');if(!context)throw Error('Le moteur de dessin est indisponible.');
  try {
    const original=createCommercialSequences(data),target=options.index===undefined?undefined:commercialTextSlots(original)[options.index]?.sequenceIndex;
    if(options.index!==undefined&&target===undefined)throw Error('Cette séquence n’existe plus. Sélectionnez-la à nouveau.');
    const sequences:CommercialSequence[]=[],changedIds=new Set<string>();
    original.sequences!.forEach((sequence,sequenceIndex)=>{
      if(target!==undefined&&sequenceIndex!==target){sequences.push(sequence);return;}
      const pages=sequence.pages.map((page,slot)=>{
        const layout=readablePageLayout(context,page,sequence.layout,slot);
        if(layout.issues.some(issue=>issue.startsWith('Le titre')))throw Error(`Séquence ${sequenceIndex+1} : ${layout.issues[0]}`);
        setReadableTextFont(context,layout.body);
        const measure=(text:string)=>context.measureText(commercialTextCase(text,layout.style.bodyCase)).width;
        return paginateReadableText(page.body,layout.body.rect.width,layout.maxBodyLines,measure);
      });
      const count=Math.max(...pages.map(chunks=>chunks.length));
      if(count===1){sequences.push(sequence);return;}
      if(sequence.pages.some(page=>!page.body.trim()))throw Error(`Séquence ${sequenceIndex+1} : complétez les deux colonnes avant de répartir leur texte.`);
      for(let i=0;i<count;i++){
        const active=pages.map((chunks,slot)=>chunks[i]!==undefined?slot:-1).filter(slot=>slot>=0);
        const layout=sequence.layout==='columns'&&active.length===1?(active[0]===0?'left':'right'):sequence.layout;
        const id=i===0?sequence.id:crypto.randomUUID();changedIds.add(id);
        sequences.push({...sequence,id,layout,duration:Math.max(COMMERCIAL_MIN_SEQUENCE_DURATION,sequence.duration/count),pages:active.map(slot=>({...sequence.pages[slot],body:pages[slot][i],...(sequence.pages[slot].style?{style:{...sequence.pages[slot].style}}:{})}))});
      }
    });
    if(sequences.length>COMMERCIAL_MAX_SEQUENCES)throw Error(`Ce texte demande ${sequences.length} séquences. Une annonce en accepte ${COMMERCIAL_MAX_SEQUENCES} ; répartissez le contenu dans plusieurs annonces.`);
    const result={...original,sequences};
    if(effectiveCommercialDuration(result)>COMMERCIAL_MAX_DURATION)throw Error('Ce texte dépasse les 10 minutes d’une annonce. Répartissez le contenu dans plusieurs annonces.');
    const errors=readableTextIssues(context,result,undefined,changedIds);if(errors.length)throw Error(errors.join('\n'));
    return result;
  }finally{canvas.width=canvas.height=0;}
}
