import {COMMERCIAL_WIDTH, COMMERCIAL_HEIGHT, COMMERCIAL_FPS, COMMERCIAL_MAX_TEXT_LINES, commercialTimeline, commercialPageStyle, commercialTextSlots, commercialSequenceTimeline} from './model';
import {preparePreviewBackground, prepareExportBackground} from './background';
import {nativeCardMotion, nativeSignatureMotion, NATIVE_SIGNATURE_GEOMETRY} from './native-motion';
import {commercialSequenceCardMotion,readableSequenceMotion} from './sequence-motion';
import {drawReadableSequenceThreads} from './sequence-threads';
import {loadCommercialFonts, commercialFontFamily, commercialTextCase} from './typography';
import type {CommercialData, CommercialPage, CommercialLogo, CommercialSequence, CommercialTextStyle} from './model';
import type {CommercialEditBox,CommercialSelection} from './editing';
import {commercialLogoBounds,commercialLogoPadding,COMMERCIAL_FOOTER_BASELINE,fitCommercialLogoToAsset} from './logo-layout';
import {loadCommercialLogoAsset,paintCommercialLogo} from './logo-presentation';
import type {CommercialLogoAsset} from './logo-presentation';
import {isReadableCommercial,readablePageLayout,readableTextIssues,setReadableTextFont} from './readable-layout';
import type {ReadableRect} from './readable-layout';
import {loadCommercialTemplateFonts as fonts,COMMERCIAL_REGULAR_FONT as REGULAR,COMMERCIAL_SEMIBOLD_FONT as SEMIBOLD} from './template-fonts';
export {commercialLogoBounds} from './logo-layout';

const WHITE = '#f9fbf4';
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (t: number, a: number, b: number) => {const q = clamp((t - a) / (b - a)); return q * q * q * (q * (q * 6 - 15) + 10);};

/** Paragraph wrapping retains authored line breaks and splits overlong words. */
export function wrapCommercialText(text: string, width: number, measure: (s: string) => number): string[] {
  const result: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    const words = paragraph.trim().split(/\s+/); let line = '';
    for (const word of words) {
      if (line && measure(`${line} ${word}`) <= width) {line += ` ${word}`; continue;}
      if (line) {result.push(line); line = '';}
      if (measure(word) <= width) {line = word; continue;}
      for (const glyph of [...word]) {
        if (line && measure(line + glyph) > width) {result.push(line); line = '';}
        line += glyph;
      }
    }
    result.push(line);
  }
  return result;
}

function setTextFont(c: CanvasRenderingContext2D, size: number, style: CommercialTextStyle, target: 'title'|'body') {
  const family = commercialFontFamily(style[target+'Font' as keyof CommercialTextStyle] as string|undefined, target==='title'?SEMIBOLD:REGULAR);
  c.font = `${style[target+'Italic' as keyof CommercialTextStyle]?'italic ':''}${style[target+'Bold' as keyof CommercialTextStyle]?'700 ':''}${size}px "${family}"`; c.letterSpacing = `${size * style.tracking}px`;
}
function textTransform(c: CanvasRenderingContext2D, style: CommercialTextStyle, target:'title'|'body', x:number,y:number) {
  const dx=Number(style[target+'X' as keyof CommercialTextStyle]??0),dy=Number(style[target+'Y' as keyof CommercialTextStyle]??0),angle=Number(style[target+'Rotation' as keyof CommercialTextStyle]??0);
  c.translate(x+dx,y+dy); c.rotate(angle*Math.PI/180); c.translate(-x,-y);
}
const textMoved=(style:CommercialTextStyle,target:'title'|'body')=>!!(style[target+'X' as keyof CommercialTextStyle]||style[target+'Y' as keyof CommercialTextStyle]||style[target+'Rotation' as keyof CommercialTextStyle]);
function displayedData(data:CommercialData):CommercialData {
  const display=(page:CommercialPage,index:number)=>{const style=commercialPageStyle(page,index);return {...page,title:commercialTextCase(page.title,style.titleCase),body:commercialTextCase(page.body,style.bodyCase)};};
  const slots = commercialTextSlots(data);
  return {...data,pages:data.pages.map(display),...(data.sequences?{sequences:data.sequences.map((sequence,sequenceIndex)=>({...sequence,pages:slots.filter(slot=>slot.sequenceIndex===sequenceIndex).map(slot=>display(slot.page,slot.kind))}))}:{})};
}
function fittedTitle(c: CanvasRenderingContext2D, text: string, size: number, width: number, tracking = -.01, style?:CommercialTextStyle) {
  if(style)setTextFont(c,size,style,'title');else c.font = `${size}px "${SEMIBOLD}"`; c.letterSpacing = `${size * tracking}px`;
  const actual = c.measureText(text).width;
  if (actual > width) {size *= width / actual; if(style)setTextFont(c,size,style,'title');else c.font = `${size}px "${SEMIBOLD}"`; c.letterSpacing = `${size * tracking}px`;}
  return size;
}
function centeredGlyphs(c: CanvasRenderingContext2D, text: string, x: number, y: number) {
  c.textAlign = 'center'; c.textBaseline = 'alphabetic'; const m = c.measureText(text);
  c.fillText(text, x, y + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
  return [x-m.actualBoundingBoxLeft,y-(m.actualBoundingBoxAscent+m.actualBoundingBoxDescent)/2,m.actualBoundingBoxLeft+m.actualBoundingBoxRight,m.actualBoundingBoxAscent+m.actualBoundingBoxDescent] as const;
}
function paragraph(c: CanvasRenderingContext2D, lines: string[], x: number, top: number, leading: number, width = 0, align: CanvasTextAlign = 'left', stableAscent?:number) {
  c.textAlign = align; c.textBaseline = 'alphabetic';
  if (align === 'center') x += width / 2; else if (align === 'right') x += width;
  const ascent = stableAscent ?? c.measureText(lines.find(line => line.trim()) || 'Ag').actualBoundingBoxAscent;
  lines.forEach((line, i) => c.fillText(line, x, top + ascent + leading * i));
  const metrics=lines.map(line=>c.measureText(line||' ')),left=Math.min(...metrics.map(m=>x-m.actualBoundingBoxLeft)),right=Math.max(...metrics.map(m=>x+m.actualBoundingBoxRight));
  return [left,top,Math.max(30,right-left),Math.max(30,(lines.length-1)*leading+ascent+Math.max(...metrics.map(m=>m.actualBoundingBoxDescent)))] as const;
}
function rememberElement(c:CanvasRenderingContext2D,boxes:CommercialEditBox[]|undefined,item:CommercialSelection,rect:readonly[number,number,number,number]){
  if(!boxes||c.globalAlpha<.3)return;
  const [x,y,width,height]=rect,m=c.getTransform(),point=m.transformPoint({x:x+width/2,y:y+height/2});
  boxes.push({...item,x:point.x,y:point.y,width:Math.max(35,width*Math.hypot(m.a,m.b)),height:Math.max(30,height*Math.hypot(m.c,m.d)),rotation:Math.atan2(m.b,m.a)*180/Math.PI});
}
function roundRect(c: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  c.beginPath(); c.roundRect(x, y, width, height, radius); c.fill();
}
function cornerFrame(c: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, length: number, stroke: number, alpha: number) {
  c.save(); c.globalAlpha *= alpha; c.strokeStyle = WHITE; c.lineWidth = stroke;
  for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const px = sx === 1 ? x : x + width, py = sy === 1 ? y : y + height;
    c.beginPath(); c.moveTo(px + sx * length, py); c.lineTo(px, py); c.lineTo(px, py + sy * length); c.stroke();
  }
  c.restore();
}

function central(c: CanvasRenderingContext2D, page: CommercialPage, time: number, start: number, end: number,boxes?:CommercialEditBox[],pageIndex=0) {
  const motion = nativeCardMotion('central', time, start, end), entry = smooth(time, start, start + 1.25);
  if (!motion.visible) return;
  c.save(); c.translate(960, 540 + 24 * (1 - entry)); c.scale(motion.rootScale, motion.rootScale); c.translate(-960, -540);
  const layer = (part: {alpha:number;scale:number;dy:number}, draw:()=>void) => {c.save(); c.globalAlpha = part.alpha; c.translate(960,540+part.dy); c.scale(part.scale,part.scale); c.translate(-960,-540); draw(); c.restore();};
  layer(motion.corners, () => cornerFrame(c, 526.5, 282.5, 867, 515, 95.5, 4.97, .5));
  const style = commercialPageStyle(page, 0);
  layer(motion.title, () => {textTransform(c,style,'title',960,373.86);c.fillStyle = style.titleColor; fittedTitle(c, page.title, 104.37 * style.titleScale, (2179 - 30) * .49 * .71, style.tracking,style); rememberElement(c,boxes,{kind:'title',page:pageIndex},centeredGlyphs(c, page.title, 960, 373.86));});
  layer(motion.header, () => {c.fillStyle = style.titleColor; c.fillRect(903, 446, 114, 13.6);});
  const {size,leading,lines} = centralBodyLayout(c,page);
  setTextFont(c,size,style,'body'); c.fillStyle = style.bodyColor;
  // Author limits are enforced before export; clip to the native card opening.
  layer(motion.body, () => {c.save(); if(!textMoved(style,'body')){c.beginPath(); c.rect(596, 487, 728, 270); c.clip();} textTransform(c,style,'body',962.334,492+Math.max(1,lines.length)*leading/2); rememberElement(c,boxes,{kind:'body',page:pageIndex},paragraph(c, lines, 602.79, 492, leading, 719.088, style.align)); c.restore();}); c.restore();
}
interface BodyLayout {size:number;leading:number;lines:string[];height:number;ratio:number}
const fittedBodies = new WeakMap<CommercialPage,Map<string,BodyLayout>>();
function fittedBody(c:CanvasRenderingContext2D,page:CommercialPage,kind:number,width:number,maximum:number,size:number,leading:number,minimum:number):BodyLayout {
  const key=`${kind}/${width}/${maximum}/${size}/${leading}/${minimum}`,cache=fittedBodies.get(page)??new Map<string,BodyLayout>(),cached=cache.get(key);
  if(cached)return cached;
  const remember=(layout:BodyLayout)=>{cache.set(key,layout);fittedBodies.set(page,cache);return layout;};
  const style=commercialPageStyle(page,kind);
  const measure=(ratio:number)=>{setTextFont(c,size*ratio,style,'body');const lines=wrapCommercialText(page.body,width,text=>c.measureText(text).width),metrics=c.measureText('ÉAg');return {size:size*ratio,leading:leading*ratio,lines,height:Math.max(0,lines.length-1)*leading*ratio+metrics.actualBoundingBoxAscent+metrics.actualBoundingBoxDescent,ratio};};
  const original=measure(1); if(original.height<=maximum)return remember(original);
  let low=Math.min(1,minimum/size),high=1,best=measure(low);
  if(best.height>maximum)return remember(best);
  for(let i=0;i<14;i++){const ratio=(low+high)/2,layout=measure(ratio);if(layout.height<=maximum){low=ratio;best=layout;}else high=ratio;}
  return remember(best);
}
function centralBodyLayout(c:CanvasRenderingContext2D,page:CommercialPage) {
  const short=page.body.trim().length<=260,style=commercialPageStyle(page,0);
  return fittedBody(c,page,0,719.088,264,(short?31.95:26.625)*style.bodyScale,(short?38.766:38.34)*style.bodyScale*style.lineHeight,22);
}
interface CardLayout {width: number; header: number; height: number; lines: string[]; size: number; leading: number; padding: number; bodyWidth: number; scale: number}
function cardLayout(c: CanvasRenderingContext2D, page: CommercialPage, right: boolean, maximum=right?620.8:582.4): CardLayout {
  const scale = right ? .52 : .51, short = page.body.trim().length <= 260, style = commercialPageStyle(page, right ? 2 : 1);
  const size = (short ? 180 : 125) * .35 * scale * style.bodyScale, leading = (short ? 220 : 180) * .35 * scale * style.bodyScale * style.lineHeight;
  const bodyWidth = 3376 * .35 * scale;
  const header = 200 * scale, padding = 40 * scale;
  const fitted=fittedBody(c,page,right?2:1,bodyWidth,maximum-header-padding*2,size,leading,20);
  const height = Math.max(300 * scale, header + fitted.height + padding * 2);
  return {width: 1297 * scale, header, height, lines:fitted.lines, size:fitted.size, leading:fitted.leading, padding, bodyWidth, scale};
}
function cardAvailableHeight(data:CommercialData,index:number) {
    const maximum = index===2?620.8:index===3?564.4:582.4;
    let available: number = maximum;
    if (data.logo?.position === 'bottom-center' && index !== 2 && !data.logo.offsetX && !data.logo.offsetY) {
      const logoHeight = 80 * data.logo.scale, logoTop = Math.min(944, 984 - logoHeight / 2) - logoHeight / 2;
      available = Math.min(available, logoTop - 24 - (index === 1 ? 297.6 : 315.6));
    } else if (data.logo?.position === 'top-right' && index === 2 && !data.logo.offsetX && !data.logo.offsetY) {
      const logoHeight = 80 * data.logo.scale, logoBottom = Math.max(136, 96 + logoHeight / 2) + logoHeight / 2;
      available = Math.min(available, 750.8 - logoBottom - 24);
    }
    return available;
}
function layoutErrors(c: CanvasRenderingContext2D, data: CommercialData,logo?:ReadableRect) {
  if(isReadableCommercial(data))return readableTextIssues(c,data,logo);
  const errors: string[] = [];
  const fits=(s:CommercialTextStyle,target:'title'|'body',rect:[number,number,number,number],pivot:[number,number])=>{
    const angle=Number(s[target+'Rotation' as keyof CommercialTextStyle]??0)*Math.PI/180,dx=Number(s[target+'X' as keyof CommercialTextStyle]??0),dy=Number(s[target+'Y' as keyof CommercialTextStyle]??0),[x,y,w,h]=rect;
    return [[x,y],[x+w,y],[x,y+h],[x+w,y+h]].every(([px,py])=>{const rx=px-pivot[0],ry=py-pivot[1],ax=pivot[0]+dx+rx*Math.cos(angle)-ry*Math.sin(angle),ay=pivot[1]+dy+rx*Math.sin(angle)+ry*Math.cos(angle);return ax>=24&&ax<=1896&&ay>=24&&ay<=1056;});
  };
  commercialTextSlots(data).forEach(({page,kind:index,label})=>{
    const s=commercialPageStyle(page,index),right=index===2,isCentral=index===0,maximum=cardAvailableHeight(data,index),body=isCentral?centralBodyLayout(c,page):null,layout=isCentral?null:cardLayout(c,page,right,maximum),x=isCentral||index===3?960:right?1413:511,y=index===3?540:522;
    const lineCount=page.body.trim()?(body??layout)!.lines.length:0;
    if(lineCount>COMMERCIAL_MAX_TEXT_LINES)errors.push(`${label} : le texte occupe ${lineCount} lignes (${COMMERCIAL_MAX_TEXT_LINES} maximum). Résumez le message à l’essentiel pour cet écran.`);
    if(page.body.trim()&&(isCentral?body!.height>264:layout!.height>maximum))errors.push(`${label} : le texte dépasse encore le cadre à la taille minimale lisible. Répartissez-le sur une autre séquence ou réduisez les retours à la ligne.`);
    const top=layout?(right?y+440*layout.scale-layout.height:y-440*layout.scale):492,headerTop=layout?(right?top+layout.height-layout.header:top):373.86;
    const titleY=isCentral?373.86:headerTop+layout!.header/2;
    if(textMoved(s,'title')){fittedTitle(c,page.title,(isCentral?104.37:170*.65*layout!.scale)*s.titleScale,isCentral?(2179-30)*.49*.71:(1297-30)*.65*layout!.scale,s.tracking,s);const m=c.measureText(page.title),h=m.actualBoundingBoxAscent+m.actualBoundingBoxDescent;if(!fits(s,'title',[x-m.width/2,titleY-h/2,m.width,h],[x,titleY]))errors.push(`${label} : le titre sort de l’image. Réduisez son déplacement ou sa rotation.`);}
    if(textMoved(s,'body')){
      const size=isCentral?body!.size:layout!.size,leading=isCentral?body!.leading:layout!.leading,width=isCentral?719.088:layout!.bodyWidth;
      setTextFont(c,size,s,'body');const bodyLines=isCentral?body!.lines:layout!.lines,m=c.measureText('ÉAg'),h=(bodyLines.length-1)*leading+m.actualBoundingBoxAscent+m.actualBoundingBoxDescent,bodyTop=isCentral?492:(right?top+layout!.padding:top+layout!.header+layout!.padding),pivotY=isCentral?492+Math.max(1,bodyLines.length)*leading/2:(right?top:top+layout!.header)+(layout!.height-layout!.header)/2;
      if(!fits(s,'body',[isCentral?602.79:x-width/2,bodyTop,width,h],[isCentral?962.334:x,pivotY]))errors.push(`${label} : le texte sort de l’image. Réduisez son déplacement ou sa rotation.`);
    }
  });
  return errors;
}
function readableCard(c:CanvasRenderingContext2D,page:CommercialPage,layoutName:CommercialSequence['layout'],slot:number,time:number,start:number,end:number,boxes:CommercialEditBox[]|undefined,pageIndex:number,backgroundOnly=false) {
  const motion=readableSequenceMotion(time,start,end);if(!motion.visible)return;
  const layout=readablePageLayout(c,page,layoutName,slot),{panel,title,body,style}=layout;
  c.save();c.translate(0,motion.dy);c.globalAlpha=motion.alpha;
  if(backgroundOnly){
    // Each block gets its own soft veil, with no rectangular edge or header.
    // Draw these before the travelling threads, and all text above the threads.
    c.save();c.translate(panel.x+panel.width/2,panel.y+panel.height/2);c.scale(panel.width/2+(layoutName==='columns'?120:264),420);
    const shade=c.createRadialGradient(0,0,0,0,0,1);
    shade.addColorStop(0,'rgba(3,22,14,.64)');shade.addColorStop(.5,'rgba(3,22,14,.48)');shade.addColorStop(1,'rgba(3,22,14,0)');
    c.fillStyle=shade;c.fillRect(-1,-1,2,2);c.restore();c.restore();return;
  }
  c.save();textTransform(c,style,'title',title.pivot.x,title.pivot.y);setReadableTextFont(c,title);c.fillStyle=style.titleColor;
  rememberElement(c,boxes,{kind:'title',page:pageIndex},paragraph(c,title.lines.slice(0,2),title.rect.x,title.rect.y,title.leading,title.rect.width,'center',title.ascent));c.restore();
  const width=120*smooth(time,start+.08,start+.5);c.fillStyle='#c7a24b';roundRect(c,panel.x+panel.width/2-width/2,body.rect.y-27,width,2,1);
  c.save();
  const reveal=smooth(time,start+.12,start+.62);c.globalAlpha*=reveal;c.translate(0,10*(1-reveal));
  textTransform(c,style,'body',body.pivot.x,body.pivot.y);setReadableTextFont(c,body);c.fillStyle=style.bodyColor;
  // An unfinished draft shows the readable portion alongside its explicit
  // density warning. The complete string remains stored; export rejects it.
  rememberElement(c,boxes,{kind:'body',page:pageIndex},paragraph(c,body.lines.slice(0,Math.max(1,layout.maxBodyLines)),body.rect.x,body.rect.y,body.leading,body.rect.width,style.align,body.ascent));c.restore();c.restore();
}
export interface CommercialTextLines {index:number;lines:number;maxLines:number}
export interface CommercialLayoutMeasurement {errors:string[];textLines:CommercialTextLines[]}
/** Counts full body layout before preview clipping; titles have a separate limit. */
function measuredTextLines(context:CanvasRenderingContext2D,data:CommercialData):CommercialTextLines[] {
  const readable=isReadableCommercial(data),spans=readable?commercialSequenceTimeline(data):[];
  return commercialTextSlots(data).map(({page,index,kind,sequenceIndex,slot})=>{
    const layout=readable?readablePageLayout(context,page,spans[sequenceIndex].layout,slot):null;
    const body=layout?.body??(kind===0?centralBodyLayout(context,page):cardLayout(context,page,kind===2,cardAvailableHeight(data,kind)));
    return {index,lines:page.body.trim()?body.lines.length:0,maxLines:layout?.maxBodyLines??COMMERCIAL_MAX_TEXT_LINES};
  });
}
/** Uses the same loaded fonts, styles and wrapping as preview and export. */
export async function measureCommercialLayout(data: CommercialData): Promise<CommercialLayoutMeasurement> {
  await fonts(); await loadCommercialFonts(commercialTextSlots(data).map(slot=>slot.page)); const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
  if (!context) throw Error('Le moteur de dessin est indisponible.');
  try {const display=displayedData(data);return {errors:layoutErrors(context,display),textLines:measuredTextLines(context,display)};}
  finally {canvas.width = canvas.height = 0;}
}
function card(c: CanvasRenderingContext2D, page: CommercialPage, right: boolean, x: number, y: number, motion: ReturnType<typeof nativeCardMotion>, heightOverride?: number,boxes?:CommercialEditBox[],pageIndex=right?2:1,maximum=right?620.8:582.4) {
  if (!motion.visible) return;
  const layout = cardLayout(c, page, right,maximum), {width, header, padding, lines, leading, size, bodyWidth, scale} = layout;
  const height = heightOverride ?? layout.height, top = right ? y + 440 * scale - height : y - 440 * scale;
  const left = x - width / 2, headerTop = right ? top + height - header : top;
  c.save(); c.translate(x,y); c.scale(motion.rootScale,motion.rootScale); c.translate(-x,-y);
  const panelHeight = height * motion.panel.scaleY, panelTop = right ? top + height - panelHeight : top;
  c.globalAlpha = motion.panel.alpha; c.fillStyle = 'rgba(0,0,0,.5)'; roundRect(c, left, panelTop + motion.panel.dy, width, panelHeight, 25 * scale);
  c.globalAlpha = motion.header.alpha; c.fillStyle = '#ffffff'; roundRect(c, left, headerTop + motion.header.dy, width, header, 25 * scale);
  const style = commercialPageStyle(page, right ? 2 : 1);
  c.globalAlpha = motion.title.alpha;
  c.save();textTransform(c,style,'title',x,headerTop+header/2);c.fillStyle = style.titleColor; fittedTitle(c, page.title, 170 * .65 * scale * style.titleScale, (1297 - 30) * .65 * scale, style.tracking,style); rememberElement(c,boxes,{kind:'title',page:pageIndex},centeredGlyphs(c, page.title, x, headerTop + header / 2 + motion.title.dy));c.restore();
  c.globalAlpha = motion.body.alpha;
  c.fillStyle = style.bodyColor; setTextFont(c,size,style,'body');
  c.save(); if(!textMoved(style,'body')){c.beginPath(); c.rect(left + padding, right ? top : top + header, width - padding * 2, height - header); c.clip();} textTransform(c,style,'body',x,(right?top:top+header)+(height-header)/2);
  rememberElement(c,boxes,{kind:'body',page:pageIndex},paragraph(c, lines, x - bodyWidth / 2, (right ? top + padding : top + header + padding) + motion.body.dy, leading, bodyWidth, style.align)); c.restore(); c.restore();
}

function readingBrand(c: CanvasRenderingContext2D, time: number, first: number, closing: number, bottom = 984) {
  const alpha = smooth(time, first, first + .35) * (1 - smooth(time, closing - .35, closing));
  c.save(); c.fillStyle = WHITE; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  c.globalAlpha = alpha * .82; c.font = `43.128078px "${SEMIBOLD}"`; c.letterSpacing = `${-43.128078 * .02}px`;
  const main = c.measureText('ANNONCES'), baseline = bottom - main.actualBoundingBoxDescent, mainTop = baseline - main.actualBoundingBoxAscent;
  c.fillText('ANNONCES', 96 + main.actualBoundingBoxLeft, baseline);
  c.globalAlpha = alpha * .7; c.font = `18px "${SEMIBOLD}"`; c.letterSpacing = '3.33px';
  const kicker = c.measureText('LE FIL DES'); c.fillText('LE FIL DES', 96 + kicker.actualBoundingBoxLeft, mainTop - 10 - kicker.actualBoundingBoxDescent); c.restore();
}
type Point = [number, number];
/** Native state-motion.jsx paths, sampled only to reproduce AE trim-paths. */
function transitionThread(c: CanvasRenderingContext2D, time: number, start: number, end: number, points: Point[], ins: Point[], outs: Point[], width: number, lag = 0) {
  if (time < start || time >= end) return;
  const from = smooth(time, start + .36 + lag, end - .04), to = smooth(time, start + lag, start + .67 + lag);
  if (to <= from) return;
  const vertices: {x: number; y: number; at: number}[] = [{x: points[0][0], y: points[0][1], at: 0}]; let length = 0;
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1], q = points[i], a: Point = [p[0] + outs[i - 1][0], p[1] + outs[i - 1][1]], b: Point = [q[0] + ins[i][0], q[1] + ins[i][1]];
    for (let j = 1; j <= 40; j++) {const t = j / 40, u = 1 - t, x = u ** 3 * p[0] + 3 * u * u * t * a[0] + 3 * u * t * t * b[0] + t ** 3 * q[0], y = u ** 3 * p[1] + 3 * u * u * t * a[1] + 3 * u * t * t * b[1] + t ** 3 * q[1], previous = vertices[vertices.length - 1]; length += Math.hypot(x - previous.x, y - previous.y); vertices.push({x, y, at: length});}
  }
  c.save(); c.globalAlpha = width > 4 ? .14 : .72; c.strokeStyle = width > 4 ? '#ffffff' : '#f7faed'; c.lineWidth = width; c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath(); let started = false;
  for (let i = 1; i < vertices.length; i++) {
    const a = vertices[i - 1], b = vertices[i], begin = Math.max(a.at, from * length), stop = Math.min(b.at, to * length);
    if (stop <= begin || b.at === a.at) continue;
    const p = (begin - a.at) / (b.at - a.at), q = (stop - a.at) / (b.at - a.at);
    if (!started) {c.moveTo(a.x + (b.x - a.x) * p, a.y + (b.y - a.y) * p); started = true;}
    c.lineTo(a.x + (b.x - a.x) * q, a.y + (b.y - a.y) * q);
  }
  c.stroke(); c.restore();
}
function threads(c: CanvasRenderingContext2D, time: number, dual: number, final: number) {
  const a: Point[] = [[960,455],[825,454],[715,350],[510,350]], ai: Point[] = [[0,0],[80,0],[85,0],[85,0]], ao: Point[] = [[-75,0],[-100,0],[-100,0],[0,0]];
  const b: Point[] = [[1413,698],[1150,698],[1115,375],[960,368]], bi: Point[] = [[0,0],[130,0],[0,130],[70,0]], bo: Point[] = [[-100,0],[-130,0],[0,-75],[0,0]];
  for (const [points, ins, outs, start, end] of [[a, ai, ao, dual - .62, dual + .75], [b, bi, bo, final - .62, final + .72]] as const) {
    transitionThread(c, time, start, end, points, ins, outs, 10);
    transitionThread(c, time, start, end, points, ins, outs, 2.2, .035);
  }
  transitionThread(c, time, dual - .49, dual + .85, [[960,455],[1170,454],[1190,698],[1413,698]], [[0,0],[-100,0],[-50,-60],[-95,0]], [[100,0],[90,0],[70,80],[0,0]], 2.2);
}
function signature(c: CanvasRenderingContext2D, seconds: number, duration: number) {
  const motion = nativeSignatureMotion(seconds, duration); if (!motion.visible) return;
  const {title, kicker} = NATIVE_SIGNATURE_GEOMETRY;
  c.save(); c.fillStyle = WHITE; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  c.save(); c.beginPath(); c.rect(...kicker.mask); c.clip(); c.font = `${kicker.fontSize}px "${SEMIBOLD}"`; c.letterSpacing = `${kicker.tracking + motion.kickerTrackingDeltaPx}px`; c.globalAlpha = motion.kicker.alpha;
  c.fillText('LE FIL DES', kicker.origin[0], kicker.origin[1] + motion.kicker.dy); c.restore();
  c.save(); c.beginPath(); c.rect(...title.mask); c.clip(); c.font = `${title.fontSize}px "${SEMIBOLD}"`; c.letterSpacing = '0px';
  const word = 'ANNONCES';
  [...word].forEach((letter, i) => {const glyph = motion.letters[i]; c.globalAlpha = glyph.alpha; const x = title.origin[0] + c.measureText(word.slice(0,i)).width + i * (title.tracking + motion.titleTrackingDeltaPx); c.fillText(letter,x,title.origin[1]+glyph.dy);}); c.restore();
  c.strokeStyle = WHITE; c.lineWidth = 2.4;
  for (const corner of motion.corners) {
    const [a,b,d] = corner.points, first = Math.hypot(b[0]-a[0],b[1]-a[1]), second = Math.hypot(d[0]-b[0],d[1]-b[1]), total = first+second;
    const from = corner.trimStart*total, to = corner.trimEnd*total; if (to<=from) continue;
    c.globalAlpha = corner.alpha; c.beginPath(); let started = false, at = 0;
    for (const [p,q,length] of [[a,b,first],[b,d,second]] as const) {const start=Math.max(from,at),end=Math.min(to,at+length); if(end>start&&length){const u=(start-at)/length,v=(end-at)/length;if(!started){c.moveTo(p[0]+(q[0]-p[0])*u,p[1]+(q[1]-p[1])*u);started=true;}c.lineTo(p[0]+(q[0]-p[0])*v,p[1]+(q[1]-p[1])*v);}at+=length;} c.stroke();
  }
  c.restore();
}

const logoAssetKey=(setting:CommercialLogo|null)=>JSON.stringify(setting?[setting.url,setting.mode,setting.presentation,setting.crop,setting.removeBackground,setting.plate==='showcase']:null);
function logoReservation(setting:CommercialLogo|null,asset:CommercialLogoAsset|undefined):ReadableRect|undefined {
  if(!setting||!asset)return undefined;
  const box=commercialLogoBounds(setting,asset.width,asset.height),pad=commercialLogoPadding(setting);
  return {x:box.x-box.width/2-pad,y:box.y-box.height/2-pad,width:box.width+pad*2,height:box.height+pad*2};
}

export async function prepareCommercial(data: CommercialData, signal: AbortSignal, options: {preview?: boolean} = {}) {
  signal.throwIfAborted(); await fonts(); await loadCommercialFonts(commercialTextSlots(data).map(slot=>slot.page),signal); signal.throwIfAborted(); data=displayedData(data);
  const canvas = document.createElement('canvas'); canvas.width = COMMERCIAL_WIDTH; canvas.height = COMMERCIAL_HEIGHT;
  const c = canvas.getContext('2d', {alpha: false})!;
  if (!c) throw Error('Le moteur de dessin est indisponible.');
  const errors = layoutErrors(c, data);
  if (errors.length&&!options.preview) {canvas.width = canvas.height = 0; throw Error(errors.join('\n'));}
  let native: Awaited<ReturnType<typeof preparePreviewBackground>> | undefined;
  let decoded: Awaited<ReturnType<typeof prepareExportBackground>> | undefined;
  let logo:CommercialLogoAsset|undefined,disposed=false;
  let frameRequest = 0, updateRequest = 0, pendingFrame = Promise.resolve();
  try {
    if (options.preview) native = await preparePreviewBackground(data, signal);
    else decoded = await prepareExportBackground(data, signal);
    logo=data.logo?await loadCommercialLogoAsset(data.logo,signal):undefined;
    if(data.logo&&logo)data={...data,logo:fitCommercialLogoToAsset(data.logo,logo)};
    const actualErrors=layoutErrors(c,data,logoReservation(data.logo,logo));
    if(actualErrors.length&&!options.preview)throw Error(actualErrors.join('\n'));
    let tl = commercialTimeline(data),spans=commercialSequenceTimeline(data),slots=commercialTextSlots(data),elements:CommercialEditBox[]=[];
    const paint = (seconds: number, background: CanvasImageSource, quantize = true) => {
        if (disposed) throw Error('L’aperçu a été fermé.'); signal.throwIfAborted();
        const time = Math.max(0, Math.min(tl.duration - 1 / COMMERCIAL_FPS, quantize ? Math.floor(seconds * COMMERCIAL_FPS + 1e-7) / COMMERCIAL_FPS : seconds));
        c.resetTransform(); c.globalAlpha = 1; c.drawImage(background, 0, 0, canvas.width, canvas.height);
        elements=[];const editable=options.preview?elements:undefined;
        if(isReadableCommercial(data)) {
          if(time>=tl.firstStart&&time<tl.closingStart){const dim=.16*smooth(time,tl.firstStart,tl.firstStart+.5)*(1-smooth(time,tl.closingStart-.35,tl.closingStart));c.fillStyle=`rgba(3,24,16,${dim})`;c.fillRect(0,0,canvas.width,canvas.height);}
          const active=spans.find(span=>time>=span.start&&time<span.end);
          if(active)for(const index of active.pageIndices){const {page,slot}=slots[index];readableCard(c,page,active.layout,slot,time,active.start,active.end,undefined,index,true);}
          drawReadableSequenceThreads(c,time,spans);
          if(active)for(const index of active.pageIndices){const {page,slot}=slots[index];readableCard(c,page,active.layout,slot,time,active.start,active.end,editable,index);}
        } else if (!data.sequences) {
        central(c, data.pages[0], time, tl.firstStart, tl.dualStart + .6,editable);
        const move = smooth(time, tl.finalStart - .5, tl.finalStart + .85);
        const leftMotion = nativeCardMotion('left',time,tl.dualStart,tl.closingStart+.48,{finalStart:tl.finalStart,fps:tl.fps});
        const before = cardLayout(c, data.pages[1], false,cardAvailableHeight(data,1)), after = cardLayout(c, data.pages[3], false,cardAvailableHeight(data,3));
        card(c, leftMotion.textSwitch ? data.pages[3] : data.pages[1], false, 511 + 449 * move, 522 + 18 * move, leftMotion, before.height + (after.height - before.height) * leftMotion.finalMix,editable,leftMotion.textSwitch?3:1,cardAvailableHeight(data,leftMotion.textSwitch?3:1));
        const rightStart = tl.dualStart + 2 / tl.fps, rightIn = smooth(time, rightStart, rightStart + 1.25), rightOut = smooth(time, tl.finalStart - .5, tl.finalStart + .45);
        card(c, data.pages[2], true, 1413 - 34 * (1 - rightIn) + 65 * rightOut, 522 + 24 * (1 - rightIn) - 18 * rightOut, nativeCardMotion('right',time,rightStart,tl.finalStart+.6),undefined,editable,2,cardAvailableHeight(data,2));
        threads(c, time, tl.dualStart, tl.finalStart);
        } else {
          for(const span of spans) {
            const end=span.end+(span.index===spans.length-1?.48:.6);
            if(time>=span.start&&time<end)for(const index of span.pageIndices) {
              const {page,kind}=slots[index];
              if(kind===0){central(c,page,time,span.start,end,editable,index);continue;}
              const right=kind===2,start=span.start+(right&&span.layout==='columns'?2/tl.fps:0);
              const entry=smooth(time,start,start+1.25),exit=smooth(time,span.end-.5,span.end+.45);
              const x=kind===3?960:right?1413-34*(1-entry)+65*exit:511,y=kind===3?540:right?522+24*(1-entry)-18*exit:522;
              card(c,page,right,x,y,commercialSequenceCardMotion(right?'right':'left',time,start,end),undefined,editable,index,cardAvailableHeight(data,kind));
            }
            if(span.index>0&&(span.layout==='columns'||span.layout==='final'))threads(c,time,span.layout==='columns'?span.start:Infinity,span.layout==='final'?span.start:Infinity);
          }
        }
        readingBrand(c, time, tl.firstStart, tl.closingStart,isReadableCommercial(data)||data.logo?.presentation==='adaptive'?COMMERCIAL_FOOTER_BASELINE:984);
        if (time < tl.firstStart) signature(c, time, tl.firstStart);
        if (time >= tl.closingStart) signature(c, time - tl.closingStart, tl.duration - tl.closingStart);
        if (logo && data.logo) {
          const setting = data.logo, start = tl.firstStart + (setting.delay ?? 0), motion = setting.motion ?? 'fade';
          const entry = motion === 'none' ? Number(time >= start) : smooth(time, start, start + (motion === 'slide' ? .65 : .35));
          const exit = motion === 'none' ? Number(time >= tl.closingStart) : smooth(time, tl.closingStart - .35, tl.closingStart);
          const box=paintCommercialLogo(c,logo,setting,{alpha:entry*(1-exit),offsetX:motion==='slide'?42*(1-entry):0});
          c.save();c.globalAlpha=(setting.presentation==='adaptive'?1:.92)*(setting.opacity??1)*entry*(1-exit);rememberElement(c,editable,{kind:'logo',page:-1},[box.x-box.width/2,box.y-box.height/2,box.width,box.height]);c.restore();
        }
        if (data.demo) {c.save(); c.globalAlpha = .65; c.fillStyle = WHITE; c.font = `18px "${REGULAR}"`; c.textAlign = 'center'; c.fillText('DÉMO · TEXTE FICTIF', 960, 1030); c.restore();}
        const fade = smooth(time, tl.duration - .42, tl.duration); if (fade) {c.fillStyle = '#000'; c.globalAlpha = fade; c.fillRect(0, 0, canvas.width, canvas.height); c.globalAlpha = 1;}
        return canvas;
    };
    return {
      canvas,
      elements(){return elements;},
      logoSize(){return logo&&data.logo?{url:data.logo.url,width:logo.width,height:logo.height,originalWidth:logo.originalWidth,originalHeight:logo.originalHeight,cropped:logo.cropped,hasTransparency:logo.hasTransparency,backgroundStatus:logo.backgroundStatus}:null;},
      layoutIssues(){return layoutErrors(c,data,logoReservation(data.logo,logo));},
      async update(nextData:CommercialData){
        const request=++updateRequest;signal.throwIfAborted();if(nextData.theme!==data.theme)throw Error('Le changement de fond nécessite un nouveau lecteur.');
        await loadCommercialFonts(commercialTextSlots(nextData).map(slot=>slot.page),signal);signal.throwIfAborted();if(disposed||request!==updateRequest)return false;
        let next=displayedData(nextData);
        const errors=layoutErrors(c,next);if(errors.length&&!options.preview)throw Error(errors.join('\n'));
        const changed=logoAssetKey(next.logo)!==logoAssetKey(data.logo);
        const loaded=changed?(next.logo?await loadCommercialLogoAsset(next.logo,signal):undefined):logo;
        if(disposed||request!==updateRequest){if(changed)loaded?.dispose();return false;}
        if(next.logo&&loaded)next={...next,logo:fitCommercialLogoToAsset(next.logo,loaded)};
        const actualErrors=layoutErrors(c,next,logoReservation(next.logo,loaded));
        if(actualErrors.length&&!options.preview){if(changed)loaded?.dispose();throw Error(actualErrors.join('\n'));}
        if(changed){logo?.dispose();logo=loaded;}
        data=next;tl=commercialTimeline(data);spans=commercialSequenceTimeline(data);slots=commercialTextSlots(data);native?.update(data);decoded?.update(data);return true;
      },
      frame(seconds: number) {
        const request = ++frameRequest;
        const render = async () => {
          signal.throwIfAborted(); if (disposed) throw new DOMException('Aperçu fermé.', 'AbortError');
          if (request !== frameRequest) return canvas;
          const time = Math.max(0, Math.min(tl.duration - 1 / COMMERCIAL_FPS, Math.floor(seconds * COMMERCIAL_FPS + 1e-7) / COMMERCIAL_FPS));
          const background = await (native ? native.frame(time) : decoded!.frame(time));
          signal.throwIfAborted(); if (disposed || request !== frameRequest) return canvas;
          return paint(time, background);
        };
        const result = pendingFrame.then(render); pendingFrame = result.then(() => {}, () => {}); return result;
      },
      async startPlayback(seconds: number) {if (!native) throw Error('La lecture continue nécessite le mode aperçu.'); await pendingFrame; await native.play(seconds);},
      stopPlayback() {native?.pause();},
      playbackFrame(seconds: number) {if (!native) throw Error('Le lecteur natif est indisponible.'); return paint(seconds, native.sample(seconds), false);},
      playbackStatistics() {return native?.statistics();},
      async dispose() {if (disposed) return; disposed = true; frameRequest++; updateRequest++; native?.dispose(); await decoded?.dispose(); logo?.dispose(); canvas.width = canvas.height = 0;},
    };
  } catch (error) {native?.dispose(); await decoded?.dispose();logo?.dispose(); canvas.width = canvas.height = 0; throw error;}
}
