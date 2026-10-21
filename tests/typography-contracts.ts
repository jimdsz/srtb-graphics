import {broadcastTemplates,templateDefaults} from '../src/studio/domain';
import {catalogueCompositions,assertCompositionCoverage} from './catalogue-matrix';
import {engineData} from '../src/studio/presentation';
import {installTypography} from '../src/studio/typography-engine';
import {patchTextStyle,textFields} from '../src/studio/typography-model';
import {importLocalFont,portableFonts} from '../src/studio/typography-fonts';
import {studioEngineModule} from '../src/studio/text-editing';
import {prepareGraphic,type LegacyGraphic} from '../src/studio/video/engine';
import {FrameRaster} from '../src/studio/video/raster';
import {inspectPreview} from '../src/studio/preview-timeline';
import {installGraphicCompatibility} from '../src/studio/graphic-compatibility';
import {installBALoader} from '../src/studio/preview-resources';
import {installPreviewBackgrounds} from '../src/studio/preview-backgrounds';
import {installSocialScene} from '../src/studio/social-scene';
import {attachSocialPreview} from '../src/studio/social-preview';
import {sampleProof} from '../src/studio/video/frame-proof';
import {exportBroadcastVideo} from '../src/studio/video/export';
import type {ProjectData} from '../src/studio/domain';
export async function typographyContracts(dataFor:(id:string,format:string)=>ProjectData,save:(name:string,body:Blob|string)=>Promise<void>,status:(s:string)=>void,signal:AbortSignal){
 const records=[],stamp=Date.now(),font=await importLocalFont(new File([await fetch('/library/v1.7.0/BTV_BA_1P/lib/fonts/SuisseIntl.otf').then(r=>r.blob())],'Recette-Suisse.otf'));
 for(const {template:t,format} of catalogueCompositions()){
  status('Édition · '+t.id+' · '+format);signal.throwIfAborted();
  const field=textFields(t).find(([key])=>/title|titre_ligne_1/.test(key))?.[0]||textFields(t)[0][0];
  let data=dataFor(t.id,format);data={...data,[field]:t.id==='BTV_PopUp'?'Olympe B.Quenum\nEntretien':'Olympe B.Quenum',...patchTextStyle(data,field,{x:-40,y:-25,size:72,font:font.id,fontName:font.name,case:'typed',align:'original',lineHeight:1.3,tracking:1.5,rotation:3})};
  const mod=await import(/* @vite-ignore */studioEngineModule(t)),tag='typography-recipe-'+t.id.toLowerCase().replaceAll('_','-');if(!customElements.get(tag))customElements.define(tag,class extends mod.default{});
  const g=document.createElement(tag) as LegacyGraphic,host=document.createElement('div');host.style.cssText='position:fixed;left:-20000px;width:1920px;height:1080px';g.style.cssText='display:block;width:1920px;height:1080px';host.append(g);document.body.append(host);
  installBALoader(g,t,()=>{});if(format==='tv'){installGraphicCompatibility(g,{...t,module:new URL(t.module,location.href).href});installPreviewBackgrounds(g,t,()=>{});}else installSocialScene(g,t);
  installTypography(g,t,data);let rendered:Awaited<ReturnType<typeof prepareGraphic>>|undefined,raster:FrameRaster|undefined;
  try{
   await g.load({renderType:'realtime',previewMuted:true,data:engineData(data,true)});
   if(format!=='tv')await attachSocialPreview(g,t,data,signal);else{raster=new FrameRaster(g.shadowRoot!,new URL(t.module,location.href).href,signal);await raster.prepare();}
   rendered=await prepareGraphic(t,data,10,false,signal);
   const samples=[];
   for(const seconds of t.id==='BTV_BA_1P'?[8,14]:t.id.startsWith('BTV_BA_TDS')?[8]:[3]){
    await inspectPreview(g,t,data,seconds);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
    const canvas=format==='tv'?await raster!.draw(null):host.querySelector('canvas')!,a=sampleProof(canvas,Math.round(seconds*25)),frame=await rendered.frame(Math.round(seconds*25),null),b=sampleProof(frame,Math.round(seconds*25));
    const boxes=format==='tv'?g.__typography.boxes():g.__socialTypography.boxes();
    if(!boxes.length)throw Error('Aucun texte édité visible '+t.id+' '+format+' '+seconds);
    let rgb=0,alpha=0;for(let i=0;i<a.alpha.length;i++){alpha+=Math.abs(a.alpha[i]-b.alpha[i]);for(let c=0;c<3;c++)rgb+=Math.abs(a.rgb[i*4+c]-b.rgb[i*4+c]);}
    const diff={rgb:rgb/(a.alpha.length*3),alpha:alpha/a.alpha.length};if(diff.rgb>12||diff.alpha>1)throw Error('Parité typographique '+t.id+' '+format+' '+JSON.stringify(diff));
    samples.push({seconds,boxes,...diff});await save('typo-'+t.id.toLowerCase().replaceAll('_','-')+'-'+format+'-'+seconds+'-'+stamp+'.png',await new Promise<Blob>(resolve=>frame.toBlob(b=>resolve(b!))));
   }
   let coverage:string[]=[];
   if(format==='tv'){
    let all={...data};for(const [key]of textFields(t))all={...all,[key]:String(all[key]||'Texte'),...patchTextStyle(all,key,{size:70,font:'suisse',case:'typed'})};
    const result=await g.updateAction(engineData(all,true));if(result?.statusCode>=400)throw Error(result.statusMessage);
    await inspectPreview(g,t,all,8);coverage=g.__typography.fields();const missing=textFields(t).map(([key])=>key).filter(key=>!coverage.includes(key));if(missing.length)throw Error('Champs non reliés : '+missing.join(', '));
    await g.stopAction({skipAnimation:true});if(g.__typography.boxes().length)throw Error('Textes visibles après Effacer');
   }
   records.push({id:t.id,format,field,samples,coverage});
  }catch(e){throw Error(t.id+' '+format+' · '+(e instanceof Error?e.stack:String(e)));}finally{raster?.dispose();await rendered?.dispose();await g.dispose();host.remove();}
 }
 assertCompositionCoverage(records);await save('typography-'+stamp+'.json',JSON.stringify(records,null,2));return records;
}
export async function typographyExports(dataFor:(id:string,format:string)=>ProjectData,save:(name:string,body:Blob|string)=>Promise<void>,status:(s:string)=>void,signal:AbortSignal){
 const records=[],stamp=Date.now(),font=await importLocalFont(new File([await fetch('/library/v1.7.0/BTV_BA_1P/lib/fonts/SuisseIntl.otf').then(r=>r.blob())],'Recette-Suisse.otf'));
 for(const [id,format,codec]of [['BTV_PopUp','tv','mov'],['BTV_BA_1P','vertical','mp4']] as const){
  const t=broadcastTemplates.find(t=>t.id===id)!,field=id==='BTV_PopUp'?'_title':'_titre_ligne_1';let data=dataFor(id,format);
  data={...data,[field]:'Interview\nOlympe B.Quenum',...patchTextStyle(data,field,{x:-75,y:-15,size:65,font:font.id,fontName:font.name,case:'typed'})};
  let result;try{result=await exportBroadcastVideo(t,data,{format:codec,manualOut:10,removeBackground:codec==='mov',audio:false,background:'#000000'},signal,p=>status(id+' · '+codec+' · '+p.message));await save('typo-export-'+format+'-'+stamp+'.'+codec,result.blob);records.push({id,format,report:result.report});}finally{await result?.dispose();}
 }
 await save('typography-exports-'+stamp+'.json',JSON.stringify(records,null,2));return records;
}
/** The distributed HTML bundle must work without the studio module's font cache. */
export async function portableTypographyContracts(dataFor:(id:string,format:string)=>ProjectData,save:(name:string,body:Blob|string)=>Promise<void>,status:(s:string)=>void,signal:AbortSignal){
 const records=[],font=await importLocalFont(new File([await fetch('/library/v1.7.0/BTV_BA_1P/lib/fonts/SuisseIntl.otf').then(r=>r.blob())],'Recette-Suisse.otf'));
 const url='/__typography-runtime.mjs?recipe='+Date.now();
 try{
  const portable=await import(/* @vite-ignore */url);
  for(const t of broadcastTemplates){
   signal.throwIfAborted();status('Polices embarquées · '+t.name);
   const field=textFields(t).find(([key])=>/title|titre_ligne_1/.test(key))?.[0]||textFields(t)[0][0];
   let data=dataFor(t.id,'tv');data={...data,[field]:'Olympe B.Quenum',...patchTextStyle(data,field,{size:72,font:font.id,fontName:font.name,case:'typed',x:-25})};
   await portable.installPortableFonts(await portableFonts(data));
   const mod=await import(/* @vite-ignore */studioEngineModule(t)),tag='portable-typography-'+t.id.toLowerCase().replaceAll('_','-');if(!customElements.get(tag))customElements.define(tag,class extends mod.default{});
   const g=document.createElement(tag) as LegacyGraphic,host=document.createElement('div');host.style.cssText='position:fixed;left:-20000px;width:1920px;height:1080px';g.style.cssText='display:block;width:1920px;height:1080px';host.append(g);document.body.append(host);
   installBALoader(g,t,()=>{});installGraphicCompatibility(g,{...t,module:new URL(t.module,location.href).href});installPreviewBackgrounds(g,t,()=>{});portable.installTypography(g,t,data);
   let raster:FrameRaster|undefined;
   try{
    await g.load({renderType:'realtime',previewMuted:true,data:engineData(data,true)});await inspectPreview(g,t,data,8);
    const boxes=g.__typography.boxes();if(!boxes.length)throw Error('Texte portable absent '+t.id);
    raster=new FrameRaster(g.shadowRoot!,new URL(t.module,location.href).href,signal);await raster.prepare();const proof=sampleProof(await raster.draw(null),200);
    if(!proof.alpha.some(value=>value>0))throw Error('Rendu portable vide');
    const result=await g.updateAction({_studio_typography:'{}'});if(result?.statusCode>=400)throw Error(result.statusMessage);
    // PopUp's original single-line layout adds a leading CR for its AE baseline.
    const actual=g.data?.[field]??g.state?.data?.[field];if(String(actual).replace(/\r/g,'').trim()!==String(data[field]).replace(/\r/g,'').trim())throw Error('Réinitialiser a perdu le texte '+t.id+' : '+String(actual));
    if(g.__typography.fields().length)throw Error('Surcouche conservée après réinitialisation');
    records.push({id:t.id,embeddedFont:font.id,boxes,partialReset:'PASS'});
   }finally{raster?.dispose();await g.dispose();host.remove();}
  }
  await save('portable-typography-'+Date.now()+'.json',JSON.stringify(records,null,2));return records;
 }finally{/* The isolated module cache belongs to this qualification page. */}
}
