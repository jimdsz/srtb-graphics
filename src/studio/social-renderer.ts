import type {BroadcastTemplate,ProjectData} from './domain';
import {dimensions,presentation,locateClip} from './presentation';
import type {Track} from './video/engine';
import type {ClipPosition} from './media-position';
import {previewPicturePosition} from './preview-picture-position';
import type {VideoTimeline} from './video/timeline';
import {compactSocialCard,socialCardPlacement,socialCardScale} from './social-card-settings';
import {currentStyle,shapedText,defaultTextCaseData} from './typography-model';
import {prepareTextFonts,fontFamily} from './typography-fonts';
import type {TextBox} from './typography-engine';
import {localDisplacement,nativeTextStyle} from './typography-position';
import {canonicalSocialText,socialLineRuns,socialTextRuns} from './social-text-runs';
import type {NativeTextRun} from './social-text-runs';
import {drawOverlayLogo,prepareOverlayLogo} from './logo-render';
import {overlayLogoGeometry} from './logo-model';
import {BRAND_POSITION,OVERLAY_LOGO,clippedBox} from './element-selection';
import type {ElementBox} from './element-selection';
import {overlayLogoHitBox} from './logo-render';
import {fitSocialText,fitSocialTextForDisplay} from './social-text-fit';
import type {SocialDisplayTextFit} from './social-text-fit';
import {measurePortraitPanel,portraitLayoutMode} from './social-portrait-layout';
import {cropMotionKey,currentCropMotion,motionCrop} from './crop-motion';
import type {CropMotion} from './crop-motion';
import {matchedSequenceCrops,sequenceCropAt,sequenceCropKey} from './sequence-crop';
import type {SequenceCropStyle} from './sequence-crop';
import type {PortraitContent,PortraitPanel,PortraitTextKey,PortraitTextPart,PortraitTextFit} from './social-portrait-layout';
import {socialSignature,socialEndOpacity,socialSignatureLift,tdsSocialCardMotion,SOCIAL_SETTLE_SECONDS} from './social-motion';
import type {SocialSignature} from './social-motion';
import {SOCIAL_BRAND_ASSET,socialBrandGeometry,socialBrandLabelBox} from './social-brand';
import {ceSoirBackground} from './ce-soir-background';
import {aeSocialTrackTimes} from './ae-media-timing';

type Picture=CanvasImageSource;
type Box={x:number;y:number;w:number;h:number};
const palette:Record<string,string>={or:'#f0b900',jaune:'#f0b900',vert:'#007300',rouge:'#eb1905',original:'#f0b900'};
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
const ease=(n:number)=>{const t=clamp(n);return t*t*(3-2*t);};
export function socialTrackTimes(id:string,seconds:number,outAt:number):Record<string,number>{
  if(id==='BTV_BA_1P'){
    return seconds<outAt?{body:Math.max(0,seconds)}:{};
  }
  if(id==='BTV_BA_TDS_SUIVI_DE')return seconds<13.8?{programme_1:seconds}:seconds<15.32?{programme_1:seconds,programme_2:seconds-13.8}:{programme_2:seconds-13.8};
  if(id==='BTV_PopUp')return {background:seconds,popup:Math.max(0,seconds-.64)};
  if(id==='BTV_BA_TDS')return {background:seconds};
  if(id==='BTV_Ce_Soir')return {background:seconds,'1':seconds,'2':seconds,'3':seconds};
  return aeSocialTrackTimes(id,seconds)??{};
}
export type PictureCache=Map<string,{node:HTMLVideoElement;time:number;canvas:HTMLCanvasElement;position:ClipPosition}>;
export function liveSocialPictures(tracks:Record<string,Track>,times:Record<string,number>,cache?:PictureCache,maxEdge=1280,presentedPositions?:Record<string,ClipPosition>):Record<string,Picture>{
  const result:Record<string,Picture>={};
  const retained=(key:string,value:NonNullable<ReturnType<PictureCache['get']>>)=>{result[key]=value.canvas;if(presentedPositions)presentedPositions[key]=value.position;};
  for(const [key,seconds]of Object.entries(times)){
    const track=tracks[key];if(!track)continue;
    const at=locateClip(track.clips,seconds,track.loop,track.rate),node=at?track.clips[at.index]?.node:undefined;
    // Converted AE engines already draw the exact requested browser frame into
    // a bounded canvas. Prefer it to the mutable video node so a pending seek
    // cannot flash an older frame into the social preview.
    const prepared=(track as Track&{previewCanvas?:HTMLCanvasElement}).previewCanvas;
    if(prepared?.width&&prepared.height){
      result[key]=prepared;const position=previewPicturePosition(prepared);
      if(position&&presentedPositions)presentedPositions[key]=position;
      continue;
    }
    if(node instanceof HTMLImageElement&&node.complete&&node.naturalWidth)result[key]=node;
    if(!node&&at&&cache?.has(key))retained(key,cache.get(key)!);
    if(node instanceof HTMLVideoElement){
      if(!cache){if(node.readyState>=2)result[key]=node;continue;}
      let previous=cache.get(key);
      if(node.readyState>=2&&!node.seeking&&!node.error&&node.videoWidth&&node.videoHeight){
        // A short decoder seek/buffer must not erase the last complete picture.
        // GPU-backed, bounded preview surfaces; exports still decode every HD frame.
        if(!previous||previous.node!==node||previous.time!==node.currentTime||previous.position.index!==at!.index){
          const canvas=previous?.canvas||document.createElement('canvas'),scale=Math.min(1,maxEdge/Math.max(node.videoWidth,node.videoHeight));
          const width=Math.round(node.videoWidth*scale),height=Math.round(node.videoHeight*scale);
          if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
          canvas.getContext('2d')!.drawImage(node,0,0,width,height);
          // Keep picture and source clock together. At a passage boundary the
          // next decoder may still be seeking; its crop must not reach the
          // previous complete picture. Keep the explicit clip identity: an
          // inverse rate conversion can round back into the preceding clip.
          const index=at!.index;
          const clip=track.clips[index],local=Math.max(0,Math.min(node.currentTime-clip.start,Math.max(0,clip.length-.04)));
          previous={node,time:node.currentTime,canvas,position:{index,time:clip.start+local}};cache.set(key,previous);
        }
      }
      if(previous)retained(key,previous);
    }
  }
  return result;
}
function imageSize(source:Picture):[number,number]{
  if(source instanceof HTMLVideoElement)return [source.videoWidth,source.videoHeight];
  if(source instanceof HTMLImageElement)return [source.naturalWidth,source.naturalHeight];
  return [(source as HTMLCanvasElement).width,(source as HTMLCanvasElement).height];
}
export function cropGeometry(sw:number,sh:number,box:Box,x=50,y=50,contain=false){
  const scale=(contain?Math.min:Math.max)(box.w/sw,box.h/sh),w=sw*scale,h=sh*scale;
  return {x:box.x+(box.w-w)*clamp(x/100),y:box.y+(box.h-h)*clamp(y/100),w,h};
}
export interface SocialAssets {logo?:HTMLImageElement;overlayLogo?:HTMLImageElement;qr?:HTMLImageElement;sponsors?:Record<string,HTMLImageElement>;mentions?:HTMLImageElement}
async function image(url:string,signal:AbortSignal){
  const node=new Image();node.crossOrigin='anonymous';node.src=url;
  const abort=()=>node.removeAttribute('src');signal.addEventListener('abort',abort,{once:true});
  try{await node.decode();signal.throwIfAborted();return node;}finally{signal.removeEventListener('abort',abort);}
}
export async function prepareSocialAssets(template:BroadcastTemplate,data:ProjectData,signal:AbortSignal):Promise<SocialAssets>{
  await prepareTextFonts(data,template.module);signal.throwIfAborted();
  const base=new URL(template.module,location.href);
  await Promise.all([['SRTB Social Benin','BeninSemiBold-Regular.otf'],['SRTB Social Suisse','SuisseIntl.otf']].map(async([family,file])=>{
    if(document.fonts.check(`20px "${family}"`)&&[...document.fonts].some(f=>f.family===family))return;
    const face=new FontFace(family,`url("${new URL('lib/fonts/'+file,base)}")`);await face.load();document.fonts.add(face);
  }));signal.throwIfAborted();
  const assets:SocialAssets={logo:await image(SOCIAL_BRAND_ASSET,signal),overlayLogo:await prepareOverlayLogo(template,data,signal)};
  const sponsor=async(key:string,value:unknown)=>{
    const raw=typeof value==='object'&&value!==null&&'url'in value?String(value.url):String(value||'');
    if(!raw)throw Error('Choisissez le logo du sponsor ou désactivez son affichage.');
    const url=new URL(/^img_\d+\./.test(raw)?'lib/images/'+raw:raw,base).href;
    (assets.sponsors??={})[key]=await image(url,signal);
  };
  if(template.id==='BTV_BA_1P'&&data._sponsor_visible){
    if(data._sponsor_original)assets.sponsors={main:await image('/social/v1/ba-sponsors.svg',signal)};
    else await sponsor('main',data._sponsor_url);
  }
  if(template.id==='BTV_BA_TDS'&&data._sponsor_visible)await sponsor('main',data._sponsor_logo);
  for(const n of [1,2])if(template.id==='BTV_BA_TDS_SUIVI_DE'&&data[`_p${n}_sponsor_visible`])await sponsor('p'+n,data[`_p${n}_sponsor_logo`]);
  if(data._mentions_visible||data._p1_mentions_visible||data._p2_mentions_visible)assets.mentions=await image('/social/v1/'+(template.id==='BTV_BA_1P'?'ba':'suivi')+'-mentions.svg',signal);
  if(template.id==='BTV_Passerelle_Replay'&&data._replay_url){
    const {makeQR}=await import(/* @vite-ignore */new URL('layout.mjs',base).href);
    const svg=makeQR(data._replay_url);assets.qr=await image('data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(svg)),signal);
  }
  return assets;
}

/** Separate, versioned social art direction. No stretched TV frame or synthetic typography. */
export class SocialRenderer {
  readonly canvas=document.createElement('canvas');
  readonly ctx:CanvasRenderingContext2D;
  readonly diagnostics:{text:string;size:number;lines:number;box:Box}[]=[];
  readonly textBoxes:TextBox[]=[];
  readonly elementBoxes:ElementBox[]=[];
  readonly cropBoxes:Record<string,Box>={};
  private cropTimes:Record<string,number>={};
  private cropPositions:Record<string,ClipPosition>={};
  private cropTracks:Record<string,Track>={};
  private signature?:SocialSignature;
  private outputOpacity=1;
  private frameBackground:string|null=null;
  private cropCache=new Map<string,{key:string;motion:CropMotion|undefined;sequence:Array<SequenceCropStyle|undefined>}>();
  readonly warnings:string[]=[];
  private textCache=new Map<string,SocialDisplayTextFit>();
  private portraitCache?:{key:string;panel?:PortraitPanel;warning?:string};
  readonly width:number;
  readonly height:number;
  private displayed:ProjectData={};
  get data(){return this.displayed;}
  set data(data:ProjectData){this.displayed=defaultTextCaseData(this.template,data);}
  constructor(readonly template:BroadcastTemplate,data:ProjectData,readonly assets:SocialAssets,maxEdge=Infinity){
    this.data=data;
    const size=dimensions(data);this.width=size.width;this.height=size.height;this.setPreviewEdge(maxEdge);
    this.ctx=this.canvas.getContext('2d',{alpha:true})!;
  }
  setPreviewEdge(edge:number){const ratio=Math.min(1,Math.max(320,edge)/Math.max(this.width,this.height));this.canvas.width=Math.round(this.width*ratio);this.canvas.height=Math.round(this.height*ratio);}
  private displacement(matrix:DOMMatrix,x:number,y:number){return localDisplacement(matrix,x*this.canvas.width/this.width,y*this.canvas.height/this.height);}
  private fit(text:string,width:number,height:number,size:number,min:number,regular:boolean,maxLines:number,flexible=false){
    text=text.normalize('NFC');
    const family=regular?'SRTB Social Suisse':'SRTB Social Benin',key=JSON.stringify([text,width,height,size,min,family,maxLines,flexible]);
    let fit=this.textCache.get(key);
    if(!fit){fit=(flexible?fitSocialTextForDisplay:fitSocialText)(text,width,height,size,min,maxLines,(line,s)=>{this.ctx.font=`${s}px "${family}"`;this.ctx.letterSpacing='0px';return this.ctx.measureText(line);});this.textCache.set(key,fit);}
    return fit;
  }
  private portraitFit(prefix:string,isBa:boolean,label:string,key:PortraitTextKey|undefined,text:string,width:number,size:number,min:number,regular:boolean,maxLines:number):PortraitTextFit{
    const fields=key==='title'?[1,2,3].map(n=>[`${prefix}_titre_ligne_${n}`]).filter(row=>this.data[row[0]]):key==='day'?isBa?[1,2,3].filter(n=>this.data[`_jour_${n}`]&&(this.data._studio_ba_mode!=='simple'||n===1)).map(n=>[`_jour_${n}`,`_heure_${n}`]):[[label]]:[[key==='theme'?isBa?'_thematique':`${prefix}_theme`:key==='sub'?isBa?'_sous_titre_pack':`${prefix}_sous_titre`:key==='credit'?'_credit_pack':'_sponsor_label']];
    if(fields.flat().every(field=>nativeTextStyle(currentStyle(this.data,field))))return this.fit(text,width,Infinity,size,min,regular,Math.max(maxLines,text.split('\n').length));
    // A compact styled title flows by measured glyph height, not by the native
    // fixed line pitch. Explicit x/y offsets remain free displacements (dragging
    // must not resize the panel and cancel the requested screen movement).
    const c=this.ctx;c.save();
    try{for(let base=size;base>=min;base--){
      const parts:PortraitTextPart[]=[];let y=0,valid=true;
      for(const row of fields){let rowHeight=0;
        for(const [column,field]of row.entries()){
          const value=String(this.data[field]||'');if(!value)continue;
          const style=currentStyle(this.data,field),x=column?width*.58:0,w=row.length>1?width*(column?.42:.55):width;
          if(nativeTextStyle(style)){
            try{const fit=this.fit(value,w,Infinity,base,base,regular,Math.max(maxLines,value.split('\n').length)),h=fit.lines.length*base*1.14;parts.push({field,x,y,w,h,size:base,regular,maxLines});rowHeight=Math.max(rowHeight,h);}catch{valid=false;break;}
          }else{
            const s=base*(style!.size??100)/100,lines=shapedText(value,style!).split('\n'),lineHeight=s*(style!.lineHeight??1.15),family=fontFamily(style!.font||'original',regular),align=style!.align||'left';
            c.font=`${style!.italic?'italic ':''}${style!.bold?'700 ':'400 '}${s}px "${family}"`;c.letterSpacing=(style!.tracking||0)+'px';
            const measured=Math.max(...lines.map(line=>{const m=c.measureText(line);return Math.max(m.width,m.actualBoundingBoxLeft+m.actualBoundingBoxRight);})),left=align==='right'?w-measured:align==='center'?(w-measured)/2:0;
            const angle=(style!.rotation||0)*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle),height=Math.max(lines.length*lineHeight,(lines.length-1)*lineHeight+s*1.14);
            const points=[[left,0],[left+measured,0],[left,height],[left+measured,height]].map(([x,y])=>({x:x*cos-y*sin,y:x*sin+y*cos})),xs=points.map(p=>p.x),ys=points.map(p=>p.y),dx=-Math.min(0,...xs),dy=-Math.min(0,...ys),h=Math.max(...ys)+dy;
            if(Math.max(...xs)+dx>w){valid=false;break;}
            parts.push({field,x:x+dx,y:y+dy,w,h,size:base,regular,maxLines});rowHeight=Math.max(rowHeight,h);
          }
        }
        if(!valid)break;y+=rowHeight+4;
      }
      if(valid)return {lines:[text],size:base,height:Math.max(0,y-4),parts};
    }}finally{c.restore();}
    throw Error(`Format 4:5 : la mise en forme de « ${text.slice(0,75)} » dépasse le panneau compact. Réduisez sa taille ou choisissez la mise en page historique.`);
  }
  private portraitPanel(content:PortraitContent,prefix:string,isBa:boolean,label:string){
    const key=JSON.stringify([content,prefix,this.data._studio_typography]);
    if(this.portraitCache?.key!==key){
      try{this.portraitCache={key,panel:measurePortraitPanel(content,this.width,this.height,(text,w,_h,size,min,regular,maxLines,part)=>this.portraitFit(prefix,isBa,label,part,text,w,size,min,regular,maxLines))};}
      catch{this.portraitCache={key,warning:'Le contenu ne tient pas lisiblement dans le panneau compact. Aperçu et export utilisent provisoirement la géométrie historique, sans modifier vos textes ni vos réglages. Vérifiez les placements libres ; ajustez le texte ou choisissez Historique dans Graphisme → Placement.'};}
    }
    if(this.portraitCache.warning)this.warnings.push(this.portraitCache.warning);
    return this.portraitCache.panel;
  }
  private text(value:unknown,box:Box,size:number,min:number,colour='#fff',regular=false,maxLines=3,field='',runs?:NativeTextRun[]){
    const text=String(value||'').normalize('NFC');if(!text)return;
    const custom=field?currentStyle(this.data,field):undefined;
    if(custom&&!nativeTextStyle(custom)){
      const c=this.ctx,s=size*(custom.size??100)/100,lines=shapedText(value,custom).split('\n'),family=fontFamily(custom.font||'original',regular),lineHeight=s*(custom.lineHeight??1.15),align=custom.align||'left';
      c.save();const [dx,dy]=this.displacement(c.getTransform(),custom.x||0,custom.y||0);c.translate(dx,dy);c.translate(box.x,box.y);c.rotate((custom.rotation||0)*Math.PI/180);
      c.font=`${custom.italic?'italic ':''}${custom.bold?'700 ':'400 '}${s}px "${family}"`;c.textBaseline='top';c.textAlign=align==='right'?'right':align==='center'?'center':'left';c.fillStyle=custom.colour&&custom.colour!=='original'?custom.colour:colour;c.letterSpacing=(custom.tracking||0)+'px';
      const x=align==='right'?box.w:align==='center'?box.w/2:0,width=Math.max(...lines.map(line=>c.measureText(line).width));lines.forEach((line,n)=>c.fillText(line,x,n*lineHeight));
      const tm=c.getTransform(),left=x-(align==='right'?width:align==='center'?width/2:0),points=[[left,0],[left+width,0],[left+width,lines.length*lineHeight],[left,lines.length*lineHeight]].map(([x,y])=>tm.transformPoint({x,y})),xs=points.map(p=>p.x),ys=points.map(p=>p.y);
      this.textBoxes.push({field,x:Math.min(...xs)/this.canvas.width,y:Math.min(...ys)/this.canvas.height,width:(Math.max(...xs)-Math.min(...xs))/this.canvas.width,height:(Math.max(...ys)-Math.min(...ys))/this.canvas.height});c.restore();return;
    }
    const c=this.ctx,family=regular?'SRTB Social Suisse':'SRTB Social Benin',fit=this.fit(text,box.w,box.h,size,min,regular,maxLines,true),original=c.getTransform();
    if(fit.adjustment==='lines')this.warnings.push(`« ${text.slice(0,45)} » utilise ${fit.lines.length} lignes dans ce format. Le texte saisi est conservé ; vérifiez sa lisibilité.`);
    if(fit.adjustment==='size')this.warnings.push(`« ${text.slice(0,45)} » est affiché en petit pour tenir dans ce format, sans perte de texte. Vous pouvez ajuster sa taille ou sa répartition dans Textes.`);
    c.save();const scale=fit.scale??1;
    if(scale!==1){c.translate(box.x,box.y);c.scale(scale,scale);c.translate(-box.x,-box.y);}
    c.font=`${fit.size}px "${family}"`;c.textBaseline='top';c.fillStyle=colour;
    const canonical=canonicalSocialText(text),mapping=runs||(field?[{field,start:0,end:canonical.length}]:[]);let cursor=0;
    const boxFor=(key:string,x:number,y:number,width:number,height:number)=>{if(!key||!Object.hasOwn(this.template.fields,key)||!width||c.globalAlpha<=.05)return;const tm=c.getTransform(),points=[[x,y],[x+width,y],[x+width,y+height],[x,y+height]].map(([x,y])=>tm.transformPoint({x,y})),xs=points.map(p=>p.x),ys=points.map(p=>p.y);this.textBoxes.push({field:key,x:Math.min(...xs)/this.canvas.width,y:Math.min(...ys)/this.canvas.height,width:(Math.max(...xs)-Math.min(...xs))/this.canvas.width,height:(Math.max(...ys)-Math.min(...ys))/this.canvas.height});};
    fit.lines.forEach((line,index)=>{
      const start=canonical.indexOf(line,cursor);cursor=Math.max(cursor,start)+line.length;
      const chunks=socialLineRuns(line,Math.max(0,start),mapping),y=box.y+index*fit!.size*1.14,moved=chunks.some(part=>{const st=part.field?currentStyle(this.data,part.field):undefined;return !!(st?.x||st?.y);});
      if(!moved)c.fillText(line,box.x,y);
      for(const part of chunks){const st=part.field?currentStyle(this.data,part.field):undefined,[dx,dy]=this.displacement(c.getTransform(),st?.x??0,st?.y??0),x=box.x+c.measureText(part.prefix).width+dx;
        if(moved)c.fillText(part.text,x,y+dy);boxFor(part.field,x,y+dy,c.measureText(part.text).width,fit!.size*1.14);
      }
    });
    const matrix=c.getTransform(),point=original.transformPoint({x:box.x,y:box.y});
    this.diagnostics.push({text,size:fit.size*matrix.a,lines:fit.lines.length,box:{x:point.x,y:point.y,w:box.w*original.a,h:box.h*original.d}});c.restore();
  }
  private fieldText(field:string,box:Box,size:number,min:number,colour='#fff',regular=false,maxLines=3){const value=this.data[field];this.text(nativeTextStyle(currentStyle(this.data,field))&&/theme|thematique/.test(field)?String(value||'').toLocaleUpperCase('fr'):value,box,size,min,colour,regular,maxLines,field);}
  private titleText(prefix:string,box:Box,size:number,min:number,colour:string){
    const fields=[1,2,3].map(n=>`${prefix}_titre_ligne_${n}`),present=fields.filter(key=>this.data[key]);
    if(fields.every(key=>nativeTextStyle(currentStyle(this.data,key)))){const native=socialTextRuns(present.map(field=>({field,text:this.data[field]})));this.text(native.text,box,size,min,colour,false,3,'',native.runs);return;}
    present.forEach((key,i)=>this.fieldText(key,{...box,y:box.y+i*size*1.15,h:size*1.15},size,min,colour,false,1));
  }
  private dayText(value:unknown,box:Box,size:number,min:number,colour:string,isBa:boolean,label:string){
    if(isBa&&['hidden','logo'].includes(String(this.data._studio_ba_appointment_display)))return;
    const fields=isBa?[1,2,3].filter(n=>this.data[`_jour_${n}`]&&(this.data._studio_ba_mode!=='simple'||n===1)).flatMap(n=>[`_jour_${n}`,`_heure_${n}`]):[label];
    if(fields.every(key=>nativeTextStyle(currentStyle(this.data,key)))){
      const native=isBa?socialTextRuns(fields.map((field,index)=>({field,text:this.data[field],separator:index%2?' · ':'\n'}))):socialTextRuns([{field:label,text:value}]);this.text(native.text,box,size,min,colour,false,3,'',native.runs);return;
    }
    if(!isBa){this.fieldText(label,box,size,min,colour);return;}
    fields.forEach((key,i)=>{const row=Math.floor(i/2),hour=i%2===1;this.fieldText(key,{...box,x:box.x+(hour?box.w*.58:0),y:box.y+row*size*1.3,w:box.w*.55},size,min,colour);});
  }
  private rect(box:Box,colour:string){this.ctx.fillStyle=colour;this.ctx.fillRect(box.x,box.y,box.w,box.h);}
  private picture(source:Picture|undefined,box:Box,kind:string,contain=false,selectedField?:string){
    // Never reveal talking rushes underneath a signature whose source sound is
    // disabled by the native template. Logos, sponsors and legal marks remain.
    if(this.signature&&!['logo','sponsor','mentions','qr','event_logo'].includes(kind))return;
    this.cropBoxes[kind]=box;
    if(!source)return;const [w,h]=imageSize(source);if(!w||!h)return;
    const cacheKey=String(this.data._studio_format)+String(this.data[cropMotionKey(kind)]||'{}')+String(this.data[sequenceCropKey(kind)]||'[]')+String(this.data[`_media_${kind}_sequence`]||'[]');
    let cached=this.cropCache.get(kind);
    if(!cached||cached.key!==cacheKey){cached={key:cacheKey,motion:currentCropMotion(this.data,kind),sequence:matchedSequenceCrops(this.data,kind)};this.cropCache.set(kind,cached);}
    const seconds=this.cropTimes[kind]??0,track=this.cropTracks[kind],presented=this.cropPositions[kind],passage=track&&sequenceCropAt(cached.sequence,seconds,track,presented);
    const position=passage||motionCrop(this.data,kind,seconds,cached.motion??null,track,presented);
    const dest=cropGeometry(w,h,box,position.x,position.y,contain||(passage?.fit??this.data[`_studio_${kind}_fit`])==='contain');
    const c=this.ctx;c.save();c.beginPath();c.rect(box.x,box.y,box.w,box.h);c.clip();c.drawImage(source,dest.x,dest.y,dest.w,dest.h);c.restore();
    const field=selectedField||(kind==='logo'?BRAND_POSITION:kind==='qr'?'_replay_url':`_media_${kind}_url`);
    if(c.globalAlpha>.05&&(field===BRAND_POSITION||this.template.fields[field])){
      const left=Math.max(box.x,dest.x),top=Math.max(box.y,dest.y),right=Math.min(box.x+box.w,dest.x+dest.w),bottom=Math.min(box.y+box.h,dest.y+dest.h);
      const matrix=c.getTransform(),points=[[left,top],[right,top],[left,bottom],[right,bottom]].map(([x,y])=>matrix.transformPoint({x,y})),xs=points.map(point=>point.x),ys=points.map(point=>point.y);
      const hit=clippedBox(field,{x:Math.min(...xs)/this.canvas.width,y:Math.min(...ys)/this.canvas.height,width:(Math.max(...xs)-Math.min(...xs))/this.canvas.width,height:(Math.max(...ys)-Math.min(...ys))/this.canvas.height});
      if(hit)this.elementBoxes.push(hit);
    }
  }
  private motion(time:number,delay:number,draw:()=>void,duration=SOCIAL_SETTLE_SECONDS){
    // Editorial information is readable from frame zero. Motion is a small
    // settle, never an opacity gate which can hide a whole opening or OUT.
    const p=ease((time-delay)/duration);this.ctx.save();this.ctx.translate(0,12*(1-p));draw();this.ctx.restore();
  }
  private brand(){
    const logo=this.assets.logo;if(!logo)return;
    // One supplied mark, one size and one anchor through IN, media and OUT.
    // A jingle must not make the station identifier shrink, slide or restart.
    this.picture(logo,socialBrandGeometry(this.data,this.width,this.height),'logo',true);
  }
  private signatureBackdrop(){
    // Benin TV green and the existing editorial colour are the whole identity.
    // The opaque field prevents silent talking footage during native jingles.
    this.rect({x:0,y:0,w:this.width,h:this.height},palette.vert);
  }
  private finishFrame(seconds:number,duration:number,accent:string){
    // Paint after the editable cards so every social template and every anchor
    // exposes the same real artwork and the matching selectable image bounds.
    this.brand();
    const c=this.ctx,w=this.width,h=this.height;c.globalAlpha=1;
    const direct=this.template.id==='BTV_BA_1P';
    const logoData=direct?{...this.data,_studio_overlay_logo_motion:'none',_studio_overlay_logo_delay:0}:this.data,logoEnd=direct?Infinity:duration;
    drawOverlayLogo(c,logoData,this.assets.overlayLogo,seconds,logoEnd,{width:w,height:h});
    const logo=overlayLogoHitBox(logoData,this.assets.overlayLogo,w,h,seconds,logoEnd);
    if(logo){const hit=clippedBox(OVERLAY_LOGO,{x:logo.x/w,y:logo.y/h,width:logo.w/w,height:logo.h/h});if(hit)this.elementBoxes.push(hit);}
    // Fade a complete frame once: fading each overlapping primitive separately
    // makes cards bleed through their own background and changes their colour.
    if(this.outputOpacity<1){c.save();c.globalCompositeOperation='destination-in';c.globalAlpha=this.outputOpacity;this.rect({x:0,y:0,w,h},'#000');c.restore();}
    if(this.frameBackground){c.save();c.globalCompositeOperation='destination-over';this.rect({x:0,y:0,w,h},this.frameBackground);c.restore();}
    if(this.outputOpacity<=.05){this.textBoxes.length=0;this.elementBoxes.length=0;}
    return this.canvas;
  }
  private block(box:Box,draw:()=>void){
    const {x,y,scale}=socialCardPlacement(box,this.width,this.height,this.data);
    const automatic=(!this.data._studio_block_anchor||this.data._studio_block_anchor==='original')&&!this.data._studio_block_x&&!this.data._studio_block_y;
    const centre=(this.height-box.h*scale)/2,lift=automatic?Math.min(0,centre-y)*socialSignatureLift(this.signature,this.template.id):0;
    this.ctx.save();this.ctx.translate(x,y+lift);this.ctx.scale(scale,scale);this.ctx.translate(-box.x,-box.y);draw();this.ctx.restore();
  }
  private cardTextHeight(field:string,width:number,size:number,min:number,maxLines:number,maximum:number,regular=false){
    const value=String(this.data[field]||'');if(!value.trim())return 0;
    // Custom typography keeps its editing space. Native text reclaims empty rows,
    // using the same glyph metrics as painting (cached, no per-frame DOM reads).
    if(!nativeTextStyle(currentStyle(this.data,field)))return maximum;
    const fit=this.fit(value,width,Infinity,size,min,regular,maxLines,true);
    return Math.min(maximum,Math.ceil(fit.lines.length*fit.size*1.14));
  }
  frame(seconds:number,timeline:VideoTimeline,pictures:Record<string,Picture>,background:string|null,removeBackground=false,tracks:Record<string,Track>={},presentedPositions:Record<string,ClipPosition>={}){
    this.cropTimes=socialTrackTimes(this.template.id,seconds,timeline.outAt);
    this.cropPositions=presentedPositions;
    this.cropTracks=tracks;
    const c=this.ctx,d=this.data,w=this.width,h=this.height,id=this.template.id,vertical=presentation(d)==='vertical',margin=80,right=vertical?150:80,wide=w-margin-right;
    const accent=palette[String(d._couleur_thematique||d._color||d._color_artwork||d._color_panel||d._color_palette)]||palette.or;
    const ink=accent===palette.or?'#000':'#fff';
    c.setTransform(this.canvas.width/w,0,0,this.canvas.height/h,0,0);c.globalAlpha=1;c.clearRect(0,0,w,h);this.diagnostics.length=0;this.textBoxes.length=0;this.elementBoxes.length=0;this.warnings.length=0;
    for(const key of Object.keys(this.cropBoxes))delete this.cropBoxes[key];
    const eveningFill=id==='BTV_Ce_Soir'?ceSoirBackground(d):undefined;
    this.frameBackground=eveningFill||background;
    if(seconds>=timeline.duration){if(this.frameBackground)this.rect({x:0,y:0,w,h},this.frameBackground);return this.canvas;}
    this.signature=socialSignature(id,seconds,timeline);
    const isBa=id==='BTV_BA_1P';
    this.outputOpacity=isBa?1:socialEndOpacity(seconds,timeline.outAt,timeline.duration);
    if(this.signature){if(!eveningFill)this.signatureBackdrop();removeBackground=true;}
    const full={x:0,y:0,w,h},top=vertical?220:100,bottom=vertical?h-350:h-130;
    if(id==='BTV_Ce_Soir'){
      if(eveningFill)this.rect(full,eveningFill);
      else if(!this.signature){this.rect(full,palette.vert);if(!removeBackground){this.picture(pictures.background,full,'background');this.rect(full,'rgba(0,40,0,.42)');}}
      this.block({x:margin,y:top+35,w:wide,h:bottom-top-35},()=>{
      this.motion(Math.min(seconds,timeline.outAt),0,()=>{this.fieldText('_heading',{x:margin,y:top+35,w:wide,h:105},82,50,eveningFill===palette.or?'#000':'#fff');this.fieldText('_station',{x:margin,y:top+136,w:wide,h:50},30,24,eveningFill===palette.or?'#000':'#fff',true);});
      const start=top+220,gap=26,cardH=Math.floor((bottom-start-2*gap)/3);
      for(let n=1;n<=3;n++)this.motion(Math.min(seconds,timeline.outAt),.06*n,()=>{
        const y=start+(n-1)*(cardH+gap),captionH=vertical?130:144;
        this.rect({x:margin,y,w:wide,h:cardH},'#005900');
        this.picture(pictures[String(n)],{x:margin,y,w:wide,h:cardH},String(n));
        // An opaque native-green caption has the same geometry with or
        // without pictures. IN and OUT retain all three actual appointments.
        this.rect({x:margin,y:y+cardH-captionH,w:wide,h:captionH},'#005900');
        this.fieldText(`_time_${n}`,{x:margin+24,y:y+cardH-captionH+24,w:180,h:70},vertical?36:43,28,palette.or);
        this.fieldText(`_title_${n}`,{x:margin+228,y:y+cardH-captionH+20,w:wide-254,h:captionH-32},vertical?36:44,26,'#fff',false,3);
      });
      });
    }else if(id==='BTV_Relais_Antenne'){
      const y=bottom-410;this.block({x:margin,y,w:wide,h:420},()=>this.motion(Math.min(seconds,timeline.outAt),0,()=>{
        this.rect({x:margin,y,w:wide,h:420},accent);
        this.fieldText('_current_label',{x:margin+36,y:y+30,w:wide-72,h:45},31,24,ink,true);
        this.fieldText('_current_title',{x:margin+36,y:y+84,w:wide-72,h:105},49,32,ink);
        this.rect({x:margin+36,y:y+206,w:wide-72,h:3},ink);
        if(!nativeTextStyle(currentStyle(d,'_next_label'))||!nativeTextStyle(currentStyle(d,'_next_time'))){
          this.fieldText('_next_label',{x:margin+36,y:y+239,w:wide-272,h:44},31,24,ink,true);
          this.fieldText('_next_time',{x:margin+wide-210,y:y+239,w:180,h:44},31,24,ink,true);
        }else{const native=socialTextRuns([{field:'_next_label',text:d._next_label},{field:'_next_time',text:d._next_time,separator:' · '}]);this.text(native.text,{x:margin+36,y:y+239,w:wide-72,h:44},31,24,ink,true,3,'',native.runs);}
        this.fieldText('_next_title',{x:margin+36,y:y+292,w:wide-72,h:105},49,32,ink);
      }));
    }else if(id==='BTV_Passerelle_Replay'){
      const y=bottom-440;this.block({x:margin,y,w:wide,h:440},()=>this.motion(Math.min(seconds,timeline.outAt),0,()=>{
        this.rect({x:margin,y,w:wide,h:440},accent);this.fieldText('_label',{x:margin+34,y:y+28,w:wide-68,h:40},28,23,ink,true);
        if(this.assets.qr){c.imageSmoothingEnabled=false;this.picture(this.assets.qr,{x:margin+34,y:y+109,w:256,h:256},'qr',true);c.imageSmoothingEnabled=true;}
        else this.text('Adresse replay\nà renseigner',{x:margin+34,y:y+136,w:250,h:150},30,24,ink);
        this.fieldText('_heading',{x:margin+326,y:y+112,w:wide-360,h:90},62,36,ink);
        this.fieldText('_title',{x:margin+326,y:y+220,w:wide-360,h:170},40,26,ink,true,4);
      }));
    }else if(id==='BTV_PopUp'){
      if(!removeBackground&&d._background_visible!==false)this.picture(pictures.background,full,'background');
      const cardW=vertical?670:660,cardX=w-right-cardW,y=bottom-630;
      this.block({x:cardX,y,w:cardW,h:630},()=>this.motion(Math.min(seconds,timeline.outAt),.2,()=>{
        this.picture(pictures.popup,{x:cardX,y,w:cardW,h:310},'popup');
        this.rect({x:cardX,y:y+310,w:cardW,h:320},accent);
        this.fieldText('_label',{x:cardX+34,y:y+336,w:cardW-68,h:45},32,25,ink);
        this.fieldText('_title',{x:cardX+34,y:y+403,w:cardW-68,h:132},56,34,ink);
        this.fieldText('_subtitle',{x:cardX+34,y:y+555,w:cardW-68,h:54},29,24,ink,true,2);
      }));
    }else if(id==='BTV_Renvoi'){
      const local=Math.min(seconds,timeline.outAt),cardW=vertical?wide:Math.min(980,wide),compact=compactSocialCard(d),inside=cardW-68;
      const announcementH=this.cardTextHeight('announcement',inside,34,25,1,50,true),titleH=this.cardTextHeight('title',inside,vertical?66:72,38,2,d.variant==='2L'?105:154),title2H=d.variant==='2L'?this.cardTextHeight('title2',inside,vertical?66:72,38,2,105):0,subH=this.cardTextHeight('subtitle',inside,31,23,2,71,true);
      const cardH=compact?Math.max(210,56+announcementH+titleH+title2H+subH+[announcementH,titleH,title2H,subH].filter(Boolean).length*16):(vertical?540:410);
      if(!removeBackground){this.rect(full,'#0d120d');this.picture(pictures.renvoi,full,'renvoi');this.rect(full,'rgba(0,0,0,.16)');}
      this.block({x:margin,y:bottom-cardH,w:cardW,h:cardH},()=>this.motion(local,.35,()=>{
        const y=bottom-cardH;this.rect({x:margin,y,w:cardW,h:cardH},accent);
        let cursor=y+28;
        this.fieldText('announcement',{x:margin+34,y:cursor,w:inside,h:compact?Math.max(1,announcementH):50},34,25,ink,true,1);cursor+=announcementH+(announcementH?16:0);
        this.fieldText('title',{x:margin+34,y:compact?cursor:y+102,w:inside,h:compact?Math.max(1,titleH):d.variant==='2L'?105:154},vertical?66:72,38,ink,false,2);cursor+=titleH+(titleH?16:0);
        if(d.variant==='2L'){this.fieldText('title2',{x:margin+34,y:compact?cursor:y+205,w:inside,h:compact?Math.max(1,title2H):105},vertical?66:72,38,ink,false,2);cursor+=title2H+(title2H?16:0);}
        this.fieldText('subtitle',{x:margin+34,y:compact?cursor:y+cardH-74,w:inside,h:compact?Math.max(1,subH):44},31,23,ink,true,2);
      }));
    }else if(id==='BTV_Evenement'){
      const picture=seconds<4.08?(pictures.intro||pictures.event):pictures.event;
      if(!removeBackground){this.rect(full,'#0d120d');this.picture(picture,full,seconds<4.08?'intro':'event');this.rect(full,'rgba(0,0,0,.24)');}
      const cardW=vertical?wide:Math.min(980,wide),compact=compactSocialCard(d),inside=cardW-68;
      const themeH=this.cardTextHeight('theme',inside-(pictures.event_logo?170:0),31,23,1,45,true),titleH=this.cardTextHeight('title_1',inside,64,36,2,92),title2H=this.cardTextHeight('title_2',inside,64,36,2,92);
      const cardH=compact?Math.max(240,60+Math.max(themeH,pictures.event_logo?100:0)+titleH+title2H+48+48):(vertical?610:420),y=bottom-cardH;
      this.block({x:margin,y,w:cardW,h:cardH},()=>this.motion(Math.min(seconds,timeline.outAt),.25,()=>{
        this.rect({x:margin,y,w:cardW,h:cardH},accent);
        this.fieldText('theme',{x:margin+34,y:y+30,w:compact&&pictures.event_logo?inside-170:inside,h:45},31,23,ink,true,1);
        const titleY=compact?y+30+Math.max(themeH,pictures.event_logo?100:0)+16:y+92;
        this.fieldText('title_1',{x:margin+34,y:titleY,w:inside,h:compact?Math.max(1,titleH):92},64,36,ink,false,2);
        this.fieldText('title_2',{x:margin+34,y:compact?titleY+titleH+(titleH?16:0):y+178,w:inside,h:compact?Math.max(1,title2H):92},64,36,ink,false,2);
        const rendezVous=socialTextRuns([{field:'day',text:d.day},{field:'time',text:d.time,separator:' · '}]);
        this.text(rendezVous.text,{x:margin+34,y:y+cardH-80,w:cardW-68,h:48},34,24,ink,true,2,'',rendezVous.runs);
        if(pictures.event_logo)this.picture(pictures.event_logo,{x:margin+cardW-180,y:y+24,w:140,h:100},'event_logo',true);
      }));
    }else if(id==='BTV_Semainier'){
      const held=Math.min(seconds,timeline.outAt),starts=[2.96,5.4,7.8,10.2,12.6,15,17.4];let active=0;for(let n=1;n<starts.length&&held>=starts[n];n++)active=n;
      const slot=held<2.96?0:held>=19.8?8:active+1;
      const key=slot===0?'intro':slot===8?'final':`programme_${slot}`,picture=pictures[key];
      if(!removeBackground){this.rect(full,'#0d120d');this.picture(picture,full,key);this.rect(full,'rgba(0,0,0,.18)');}
      const cardW=vertical?wide:Math.min(980,wide),compact=compactSocialCard(d),inside=cardW-68,programme=slot>=1&&slot<=7;
      const firstField=programme?`programme_${slot}_category`:slot===0?'intro_top':'final_top',secondField=programme?`programme_${slot}_title`:slot===0?'intro_bottom':'final_bottom';
      const firstH=this.cardTextHeight(firstField,inside,programme?31:66,programme?23:38,programme?1:2,programme?46:104,programme),secondH=this.cardTextHeight(secondField,inside,programme?64:66,programme?34:38,programme?3:2,programme?170:104);
      const cardH=compact?Math.max(220,68+firstH+secondH+20+(programme?56:0)):(vertical?560:390),y=bottom-cardH;
      this.block({x:margin,y,w:cardW,h:cardH},()=>this.motion(Math.min(seconds,timeline.outAt),.18,()=>{
        this.rect({x:margin,y,w:cardW,h:cardH},accent);
        if(slot>=1&&slot<=7){
          this.fieldText(`programme_${slot}_category`,{x:margin+34,y:y+34,w:cardW-68,h:46},31,23,ink,true,1);
          this.fieldText(`programme_${slot}_title`,{x:margin+34,y:compact?y+34+firstH+20:y+104,w:cardW-68,h:compact?Math.max(1,secondH):170},64,34,ink,false,3);
          this.text(`${slot} / 7`,{x:margin+34,y:y+cardH-66,w:cardW-68,h:36},26,20,ink,true,1);
        }else{
          const topField=slot===0?'intro_top':'final_top',bottomField=slot===0?'intro_bottom':'final_bottom';
          this.fieldText(topField,{x:margin+34,y:compact?y+34:y+84,w:cardW-68,h:compact?Math.max(1,firstH):104},66,38,ink,false,2);
          this.fieldText(bottomField,{x:margin+34,y:compact?y+34+firstH+20:y+185,w:cardW-68,h:compact?Math.max(1,secondH):104},66,38,ink,false,2);
        }
      }));
    }else{
      const tdsMotion=tdsSocialCardMotion(id,seconds,timeline.outAt),second=tdsMotion?.second??false,prefix=second?'_p2':id==='BTV_BA_TDS_SUIVI_DE'?'_p1':'';
      const kind=isBa?'body':id==='BTV_BA_TDS_SUIVI_DE'?second?'programme_2':'programme_1':'background';
      const title=[1,2,3].map(n=>d[`${prefix}_titre_ligne_${n}`]).filter(Boolean).join('\n');
      const theme=d[`${prefix}_theme`]||d._thematique||d._theme;
      const day=isBa?['hidden','logo'].includes(String(d._studio_ba_appointment_display))?'':(d._studio_ba_mode==='simple'?[1]:[1,2,3]).filter(n=>d[`_jour_${n}`]).map(n=>[d[`_jour_${n}`],d[`_heure_${n}`]].filter(Boolean).join(' · ')).join('\n'):id==='BTV_BA_TDS_SUIVI_DE'?d[second?'_followup_label':'_intro_label']:'TOUT DE SUITE';
      const themeColour=accent,themeInk=themeColour===palette.or?'#000':'#fff';
      const panelY=bottom-690,panelH=h-panelY;
      const sub=isBa?(d._sous_titre_visible?d._sous_titre_pack:''):d[`${prefix}_sous_titre`];
      const sponsor=this.assets.sponsors?.[prefix?prefix.slice(1):'main'];
      const mentions=!!(d[`${prefix}_mentions_visible`]&&this.assets.mentions);
      const overlay=this.assets.overlayLogo&&d._studio_overlay_logo_enabled&&String(d._studio_overlay_logo_anchor).startsWith('bottom')?overlayLogoGeometry(d,w,h,this.assets.overlayLogo.naturalWidth,this.assets.overlayLogo.naturalHeight):undefined;
      const bottomLogos=[...(overlay?[overlay.plate.y]:[]),...(!vertical&&this.assets.logo&&String(d._studio_logo_anchor).startsWith('bottom')?[socialBrandGeometry(d,w,h).y]:[])];
      const compact=!vertical&&portraitLayoutMode(d)==='compact'?this.portraitPanel({theme:String(theme||'').toLocaleUpperCase('fr'),title,day:String(day||''),sub:String(sub||''),credit:isBa&&d._credit_visible?String(d._credit_pack||''):'',label:isBa&&d._sponsor_label_visible?String(d._sponsor_label||''):'',sponsor:!!sponsor,mentions,bottomLogoTop:bottomLogos.length?Math.min(...bottomLogos):undefined},prefix,isBa,second?'_followup_label':'_intro_label'):undefined;
      if(!removeBackground){
        this.rect(full,vertical?'#10140f':themeColour);
        const mediaBox=vertical||socialCardScale(d)<100?full:{x:0,y:0,w,h:compact?.box.y??panelY-30};
        const previous=second&&seconds<15.32?'programme_1':undefined;
        if(previous){
          this.picture(pictures[previous],mediaBox,previous);
          c.save();c.globalAlpha*=ease((seconds-13.8)/1.52);this.picture(pictures[kind],mediaBox,kind);c.restore();
        }else this.picture(pictures[kind],mediaBox,kind);
      }
      const drawLabel=()=>{if(d._inedit_visible)this.fieldText('_inedit_label',socialBrandLabelBox(d,w,h),34,26,'#fff');};
      if(!compact)drawLabel();
      const localTime=tdsMotion?.elapsed??Math.min(seconds,timeline.outAt);
      const cardMotion=(draw:()=>void)=>isBa?draw():this.motion(localTime,0,draw,tdsMotion?.duration);
      if(vertical){
        const sub=isBa?(d._sous_titre_visible?d._sous_titre_pack:''):d[`${prefix}_sous_titre`];
        const sponsor=this.assets.sponsors?.[prefix?prefix.slice(1):'main'];
        const mentions=d[`${prefix}_mentions_visible`]&&this.assets.mentions;
        const tight=compactSocialCard(d),inside=wide-60,titleFit=tight?this.fit(title||' ',inside,Infinity,56,32,false,3,true):undefined;
        const styled=[1,2,3].some(n=>!nativeTextStyle(currentStyle(d,`${prefix}_titre_ligne_${n}`)));
        const titleH=tight&&!styled?Math.min(168,Math.ceil(titleFit!.lines.length*titleFit!.size*1.14)):(title.split('\n').length>2?168:128),dayH=day?String(day).split('\n').length*44:0;
        const themeH=theme?(tight?38:46):0,subH=sub?(tight?this.cardTextHeight(isBa?'_sous_titre_pack':`${prefix}_sous_titre`,inside,26,18,3,64,true)+16:80):0,creditH=isBa&&d._credit_visible?54:0,labelH=isBa&&d._sponsor_label_visible?34:0,logosH=sponsor||mentions?74:0;
        const height=60+themeH+titleH+18+dayH+subH+creditH+labelH+logosH;
        const cardY=bottom-height;
        this.block({x:margin,y:cardY,w:wide,h:height},()=>cardMotion(()=>{
          this.rect({x:margin,y:cardY,w:wide,h:height},themeColour);let y=cardY+30;
          if(theme){this.fieldText(isBa?'_thematique':`${prefix}_theme`,{x:margin+30,y,w:inside,h:30},24,20,themeInk,true,1);y+=themeH;}
          this.titleText(prefix,{x:margin+30,y,w:inside,h:titleH},56,32,themeInk);y+=titleH+18;
          this.dayText(day,{x:margin+30,y,w:inside,h:dayH},36,26,themeInk,isBa,second?'_followup_label':'_intro_label');y+=dayH;
          if(sub){this.fieldText(isBa?'_sous_titre_pack':`${prefix}_sous_titre`,{x:margin+30,y:y+16,w:inside,h:subH-16},26,18,themeInk,true,3);y+=subH;}
          if(creditH){this.fieldText('_credit_pack',{x:margin+30,y:y+12,w:inside,h:42},23,18,themeInk,true,2);y+=creditH;}
          if(labelH){this.fieldText('_sponsor_label',{x:margin+30,y:y+8,w:inside,h:26},20,17,themeInk,true,1);y+=labelH;}
          if(sponsor)this.picture(sponsor,{x:margin+30,y:y+12,w:inside-(mentions?206:0),h:50},'sponsor',true,isBa?'_sponsor_url':prefix?`${prefix}_sponsor_logo`:'_sponsor_logo');
          if(mentions)this.picture(mentions,{x:w-right-210,y:y+12,w:180,h:50},'mentions',true);
        }));
        return this.finishFrame(seconds,timeline.outAt+timeline.timing.out,accent);
      }
      if(compact)this.block(compact.box,()=>cardMotion(()=>{
        this.rect(compact.box,themeColour);
        for(const [key,slot]of Object.entries(compact.slots)){
          if(slot.parts)for(const part of slot.parts)this.fieldText(part.field,{x:slot.box.x+part.x,y:slot.box.y+part.y,w:part.w,h:part.h},part.size,part.size,themeInk,part.regular,part.maxLines);
          else if(key==='title')this.titleText(prefix,slot.box,slot.size,slot.min,themeInk);
          else if(key==='day')this.dayText(day,slot.box,slot.size,slot.min,themeInk,isBa,second?'_followup_label':'_intro_label');
          else {const field=key==='theme'?isBa?'_thematique':`${prefix}_theme`:key==='sub'?isBa?'_sous_titre_pack':`${prefix}_sous_titre`:key==='credit'?'_credit_pack':'_sponsor_label';this.fieldText(field,slot.box,slot.size,slot.min,themeInk,slot.regular,slot.maxLines);}
        }
        if(compact.logos){const b=compact.logos;
          if(sponsor)this.picture(sponsor,{...b,w:b.w-(mentions?245:0),h:48},'sponsor',true,isBa?'_sponsor_url':prefix?`${prefix}_sponsor_logo`:'_sponsor_logo');
          if(mentions)this.picture(this.assets.mentions,{x:w-right-210,y:b.y,w:210,h:65},'mentions',true);
        }
      }));
      else this.block({x:0,y:panelY-30,w,h:panelH+30},()=>cardMotion(()=>{
        this.rect({x:0,y:panelY-30,w,h:panelH+30},themeColour);
        this.fieldText(isBa?'_thematique':`${prefix}_theme`,{x:margin,y:panelY,w:wide,h:43},30,24,themeInk,true,1);
        this.titleText(prefix,{x:margin,y:panelY+68,w:wide,h:190},70,38,themeInk);
        this.dayText(day,{x:margin,y:panelY+280,w:wide,h:158},isBa?43:47,29,themeInk,isBa,second?'_followup_label':'_intro_label');
        const sub=isBa?(d._sous_titre_visible?d._sous_titre_pack:''):d[`${prefix}_sous_titre`];
        if(sub)this.fieldText(isBa?'_sous_titre_pack':`${prefix}_sous_titre`,{x:margin,y:panelY+448,w:wide,h:92},30,24,themeInk,true,3);
        const sponsor=this.assets.sponsors?.[prefix?prefix.slice(1):'main'];
        if(isBa&&d._credit_visible)this.fieldText('_credit_pack',{x:margin,y:panelY+548,w:wide,h:52},25,21,themeInk,true,2);
        if(isBa&&d._sponsor_label_visible)this.fieldText('_sponsor_label',{x:margin,y:panelY+605,w:wide-245,h:32},23,19,themeInk,true,1);
        if(sponsor)this.picture(sponsor,{x:margin,y:panelY+638,w:wide-245,h:48},'sponsor',true,isBa?'_sponsor_url':prefix?`${prefix}_sponsor_logo`:'_sponsor_logo');
        if(d[`${prefix}_mentions_visible`]&&this.assets.mentions)this.picture(this.assets.mentions,{x:w-right-210,y:panelY+619,w:210,h:65},'mentions',true);
      }));
      if(compact)drawLabel();
    }
    return this.finishFrame(seconds,timeline.outAt+timeline.timing.out,accent);
  }
  logoLayout(){const image=this.assets.overlayLogo;return image?overlayLogoGeometry(this.data,this.width,this.height,image.naturalWidth,image.naturalHeight):undefined;}
  dispose(){this.assets.overlayLogo?.removeAttribute('src');this.canvas.width=this.canvas.height=0;this.textCache.clear();}
}
