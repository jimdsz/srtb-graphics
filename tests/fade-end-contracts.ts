import {getTemplate} from '../src/studio/domain';
import {catalogueCompositions,assertCompositionCoverage} from './catalogue-matrix';
import type {ProjectData} from '../src/studio/domain';
import {prepareGraphic,type LegacyGraphic} from '../src/studio/video/engine';
import {tracksOf} from '../src/studio/media-tracks';
import {FrameRaster} from '../src/studio/video/raster';
import {sampleProof,type SampleProof} from '../src/studio/video/frame-proof';
import {installPreviewTransport} from '../src/studio/preview-transport';
import {seekPreviewTrack} from '../src/studio/preview-timeline';
import {socialTrackTimes} from '../src/studio/social-renderer';
import {installGraphicCompatibility} from '../src/studio/graphic-compatibility';
import {installPreviewBackgrounds} from '../src/studio/preview-backgrounds';
import {installBALoader,previewSources} from '../src/studio/preview-resources';
import {stripSupplementalVoice} from '../src/studio/supplemental-voice';
import {installBAMediaReadiness} from '../src/studio/media-readiness';
import {installSocialScene} from '../src/studio/social-scene';
import {attachSocialPreview} from '../src/studio/social-preview';
import {installTypography} from '../src/studio/typography-engine';
import {patchTextStyle,textFields} from '../src/studio/typography-model';
import {studioEngineModule} from '../src/studio/text-editing';
import {dimensions,engineData} from '../src/studio/presentation';
import {TIMINGS} from '../src/studio/video/timeline';
import {exportBroadcastVideo} from '../src/studio/video/export';
import {ALL_FORMATS,BlobSource,CanvasSink,Input} from 'mediabunny';

type Factory=(id:string,format:string)=>ProjectData;
type Save=(name:string,body:Blob|string)=>Promise<void>;
const RGB_TOLERANCE=4,ALPHA_TOLERANCE=1;
const tick=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const blob=(canvas:HTMLCanvasElement)=>new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('Capture PNG indisponible.'))));
function difference(a:SampleProof,b:SampleProof){
  let alpha=0,premultiplied=0,opaque=0,count=0;
  for(let i=0;i<a.alpha.length;i++){
    alpha+=Math.abs(a.alpha[i]-b.alpha[i]);
    for(let c=0;c<3;c++){
      premultiplied+=Math.abs(a.rgb[i*4+c]*a.alpha[i]/255-b.rgb[i*4+c]*b.alpha[i]/255);
      if(Math.min(a.alpha[i],b.alpha[i])>32){opaque+=Math.abs(a.rgb[i*4+c]-b.rgb[i*4+c]);count++;}
    }
  }
  return {alpha:alpha/a.alpha.length,premultiplied:premultiplied/(a.alpha.length*3),visibleRgb:count?opaque/count:0};
}
function metrics(proof:SampleProof){
  let sum=0,max=0,spread=0;const means=[0,0,0],colors=new Map<string,number>();
  for(let i=0;i<proof.alpha.length;i++){sum+=proof.alpha[i];max=Math.max(max,proof.alpha[i]);for(let c=0;c<3;c++)means[c]+=proof.rgb[i*4+c];const color=[0,1,2].map(c=>Math.floor(proof.rgb[i*4+c]/8)).join(',');colors.set(color,(colors.get(color)||0)+1);}
  for(let c=0;c<3;c++)means[c]/=proof.alpha.length;
  for(let i=0;i<proof.alpha.length;i++)for(let c=0;c<3;c++)spread+=Math.abs(proof.rgb[i*4+c]-means[c]);
  return {alphaMean:sum/proof.alpha.length,alphaMax:max,rgbMean:means,rgbSpread:spread/(proof.alpha.length*3),dominantColorShare:Math.max(...colors.values())/proof.alpha.length};
}
function board(width:number,height:number,rows:number){
  const canvas=document.createElement('canvas'),w=width===1920?384:216,h=Math.round(w*height/width);canvas.width=w*2;canvas.height=(h+28)*rows;const c=canvas.getContext('2d')!;
  c.fillStyle='#fff';c.fillRect(0,0,canvas.width,canvas.height);
  return {canvas,put(row:number,side:number,frame:CanvasImageSource,label:string){const x=side*w,y=row*(h+28);c.fillStyle='#111';c.font='14px sans-serif';c.fillText(label,x+6,y+19);for(let yy=0;yy<h;yy+=12)for(let xx=0;xx<w;xx+=12){c.fillStyle=(Math.floor(xx/12)+Math.floor(yy/12))%2?'#60656d':'#9298a1';c.fillRect(x+xx,y+28+yy,Math.min(12,w-xx),Math.min(12,h-yy));}c.drawImage(frame,x,y+28,w,h);}};
}

export async function fadeEndContracts(dataFor:Factory,save:Save,status:(text:string)=>void,signal:AbortSignal){
  const stamp=Date.now(),records:any[]=[];
  for(const {template,format} of catalogueCompositions()){
    const params=new URLSearchParams(location.search);if(params.get('fade-template')&&params.get('fade-template')!==template.id||params.get('fade-format')&&params.get('fade-format')!==format)continue;
    signal.throwIfAborted();status('Fondus / fins : '+template.name+' · '+format);
    const field=textFields(template).find(([key])=>/title|titre_ligne_1/.test(key))?.[0]||textFields(template)[0][0];
    const data:ProjectData={...dataFor(template.id,format),_out_mode:'duration',_out_duration_seconds:28,...patchTextStyle(dataFor(template.id,format),field,{size:96,tracking:.2})};
    const module=await import(/* @vite-ignore */studioEngineModule(template)),tag='fade-'+template.id.toLowerCase().replaceAll('_','-');if(!customElements.get(tag))customElements.define(tag,class extends module.default{});
    const g=document.createElement(tag) as LegacyGraphic,host=document.createElement('div');host.style.cssText='position:fixed;left:-20000px;width:1920px;height:1080px';g.style.cssText='display:block;position:relative;width:1920px;height:1080px';host.append(g);document.body.append(host);
    let rendered:Awaited<ReturnType<typeof prepareGraphic>>|undefined,raster:FrameRaster|undefined,transport:ReturnType<typeof installPreviewTransport>|undefined;
    const started=performance.now(),issues:string[]=[],samples:any[]=[],costs={previewMs:0,exportMs:0,clone:0,svg:0,draw:0,png:0},record:any={id:template.id,format,issues,samples,costs};
    try{
      const source=previewSources(template,data);installBALoader(g,template,()=>{});
      if(format==='tv'){installGraphicCompatibility(g,{...template,module:new URL(template.module,location.href).href});installPreviewBackgrounds(g,template,()=>{});}else installSocialScene(g,template);
      installTypography(g,template,source);await installBAMediaReadiness(template);
      // The production preview wrapper owns supplemental voice playback and
      // removes its studio-only fields before calling strict native engines.
      const loaded=await g.load({renderType:'realtime',previewMuted:true,data:stripSupplementalVoice(template,engineData(source,true))});if(loaded?.statusCode>=400)throw Error(loaded.statusMessage);
      if(format!=='tv')await attachSocialPreview(g,template,source,signal);
      transport=installPreviewTransport(g,template,()=>data,error=>issues.push(error.message));
      rendered=await prepareGraphic(template,data,28,false,signal);const tl=rendered.timeline;
      if(format==='tv'){raster=new FrameRaster(g.shadowRoot!,new URL(template.module,location.href).href,signal);await raster.prepare();}
      const preview=async()=>format==='tv'?raster!.draw(null):host.querySelector('canvas')!;
      const endStart=tl.frames-Math.round(Math.min(1,tl.timing.out)*25),frameSet=new Set([0,...[.25,.5,.75,1].map(p=>Math.round(tl.timing.entry*p*25)),Math.round(tl.outAt*25)]);
      if(template.id==='BTV_BA_1P')for(const seconds of [4.36,4.96,5.6,tl.outAt+.68,tl.outAt+1.36])frameSet.add(Math.round(seconds*25));
      if(template.id==='BTV_BA_TDS_SUIVI_DE')for(const seconds of [13.8,14.56,15.32])frameSet.add(Math.round(seconds*25));
      if(template.id==='BTV_PopUp')for(const seconds of [4,8])frameSet.add(Math.round(seconds*25));
      for(let frame=endStart;frame<tl.frames;frame++)frameSet.add(frame);
      const frames=[...frameSet].sort((a,b)=>a-b),picked=[Math.round(tl.timing.entry*.5*25),Math.round(tl.outAt*25),endStart,tl.frames-1],size=dimensions(data),sheet=board(size.width,size.height,5);
      for(const frame of frames){
        signal.throwIfAborted();status('Fondus / fins : '+template.id+' · '+format+' · '+(frame/25).toFixed(2)+' s');
        const previewStarted=performance.now();
        await transport.seek(frame/25);await tick();
        if(format==='tv'&&tl.timing.kind==='legacy'){
          const svg=g.state.animation.renderer.svgElement,css=getComputedStyle(svg);
          if(css.display==='none'||css.visibility==='hidden')issues.push('SVG natif masqué après inspection à '+frame/25+' s ('+css.display+', '+css.visibility+')');
        }
        const aCanvas=await preview(),a=sampleProof(aCanvas,frame),aMetrics=metrics(a),row=picked.indexOf(frame);if(row>=0)sheet.put(row,0,aCanvas,'Aperçu · '+(frame/25).toFixed(2)+' s');
        costs.previewMs+=performance.now()-previewStarted;const exportStarted=performance.now();
        const bCanvas=await rendered.frame(frame,null),b=sampleProof(bCanvas,frame),delta=difference(a,b),bMetrics=metrics(b);if(row>=0)sheet.put(row,1,bCanvas,'Export · '+(frame/25).toFixed(2)+' s');
        costs.exportMs+=performance.now()-exportStarted;for(const key of ['clone','svg','draw','png'] as const)costs[key]+=rendered.timings[key];
        const sample:any={frame,seconds:frame/25,delta,preview:aMetrics,export:bMetrics};samples.push(sample);
        if(delta.alpha>ALPHA_TOLERANCE||delta.premultiplied>RGB_TOLERANCE||params.get('fade-probe-frame')===String(frame)){
          const prefix='fade-difference-'+template.id.toLowerCase().replaceAll('_','-')+'-'+format+'-'+frame+'-'+stamp;
          await save(prefix+'-preview.png',await blob(aCanvas));await save(prefix+'-export.png',await blob(bCanvas));
          if(template.id==='BTV_BA_1P'){
            sample.mediaBefore=g.media.status();
            for(const [kind,time]of Object.entries(socialTrackTimes(template.id,frame/25,tl.outAt)))await seekPreviewTrack(g.media.tracks[kind],time);
            g.scene.canvases.draw();g.__socialPreview?.refresh();const nudged=await preview();sample.afterEpsilonDelta=difference(sampleProof(nudged,frame),b);sample.mediaAfter=g.media.status();await save(prefix+'-epsilon-preview.png',await blob(nudged));
          }else if(format!=='tv'){
            sample.media=[...g.shadowRoot!.querySelectorAll('video')].map(node=>({time:node.currentTime,seeking:node.seeking,ready:node.readyState}));
            sample.trackCanvases=Object.fromEntries(Object.entries(tracksOf(g)).map(([key,track])=>{const canvas=(track as any).previewCanvas as HTMLCanvasElement|undefined,node=track.clips[0]?.node as HTMLImageElement|HTMLVideoElement|undefined;if(!canvas)return [key,null];const pixel=canvas.getContext('2d')?.getImageData(960,540,1,1).data;return [key,{width:canvas.width,height:canvas.height,pixel:pixel?[...pixel]:null,node:node?{tag:node.tagName,complete:'complete'in node?node.complete:undefined,naturalWidth:'naturalWidth'in node?node.naturalWidth:undefined,naturalHeight:'naturalHeight'in node?node.naturalHeight:undefined,videoWidth:'videoWidth'in node?node.videoWidth:undefined,videoHeight:'videoHeight'in node?node.videoHeight:undefined,src:node.src}:null}];}));
            sample.previousExportDelta=difference(a,sampleProof(await rendered.frame(Math.max(0,frame-1),null),frame-1));
            await g.goToTime({seconds:frame/25+1e-7});await tick();const nudged=await preview();sample.afterEpsilonDelta=difference(sampleProof(nudged,frame),b);await save(prefix+'-epsilon-preview.png',await blob(nudged));
          }
        }
      }
      const mismatches=samples.filter(sample=>sample.delta.alpha>ALPHA_TOLERANCE||sample.delta.premultiplied>RGB_TOLERANCE);
      if(mismatches.length)issues.push(mismatches.length+' images différentes : max alpha '+Math.max(...mismatches.map(sample=>sample.delta.alpha)).toFixed(2)+', RGB prémultiplié '+Math.max(...mismatches.map(sample=>sample.delta.premultiplied)).toFixed(2));
      const opaqueProgrammeTemplates=new Set(['BTV_Renvoi','BTV_Evenement','BTV_Semainier']);
      const tail=samples.filter(sample=>sample.frame>=endStart),last=tail.at(-1),fadesToAlpha=format!=='tv'||tl.timing.kind==='signature'&&!opaqueProgrammeTemplates.has(template.id)||template.id==='BTV_PopUp'&&!data._background_visible;
      record.expectedEnd=template.id==='BTV_BA_1P'&&format==='tv'?'fond uni de charte':fadesToAlpha?'alpha vers zéro':'fin native du fond TV';
      for(const side of ['preview','export']){
        if(fadesToAlpha){
          const rebounds=tail.slice(1).filter((sample,i)=>sample[side].alphaMean>tail[i][side].alphaMean+1);
          if(rebounds.length)issues.push(side+' : '+rebounds.length+' remontées d’alpha pendant le fondu final');
          // The final encoded sample is 40 ms BEFORE full completion. BA's
          // 0.8 s fade can retain several composited alpha quanta at that frame.
          const tolerance=format!=='tv'?8:4;
          if(last[side].alphaMean>tolerance)issues.push(side+' : dernière image encore visible, alpha moyen '+last[side].alphaMean.toFixed(2));
        }
        // Native BA retains its white channel logo over the solid green field.
        if(template.id==='BTV_BA_1P'&&format==='tv'&&(last[side].alphaMean<254||last[side].dominantColorShare<.95))issues.push(side+' : le fond final BA n’est pas opaque et majoritairement uni '+JSON.stringify(last[side]));
      }
      // Resume the actual final OUT frames, then check removal including edited
      // typography overlays. The last encoded frame and completed state differ.
      await transport.seek(tl.duration-.08);await transport.resume();await wait(300);await tick();const completed=await preview(),completedProof=metrics(sampleProof(completed,tl.frames));record.completed={...transport.snapshot(),...completedProof};sheet.put(4,0,completed,'Aperçu · OUT terminé');
      if(transport.snapshot().phase!=='stopped'||completedProof.alphaMax!==0)issues.push('OUT terminé laisse une image ou un texte visible : '+JSON.stringify(record.completed));
      record.timeline=tl;record.proof='fade-'+template.id.toLowerCase().replaceAll('_','-')+'-'+format+'-'+stamp+'.png';await save(record.proof,await blob(sheet.canvas));sheet.canvas.width=sheet.canvas.height=0;
    }catch(error){signal.throwIfAborted();issues.push(error instanceof Error?error.stack||error.message:String(error));}
    finally{transport?.dispose();raster?.dispose();await rendered?.dispose();await g.dispose();host.remove();}
    record.durationMs=performance.now()-started;record.result=issues.length?'FAIL':'PASS';records.push(record);await save('fade-progress-'+Date.now()+'.json',JSON.stringify(records,null,2));
  }
  const params=new URLSearchParams(location.search);if(!params.has('fade-template')&&!params.has('fade-format'))assertCompositionCoverage(records);
  const report='fade-ends-'+stamp+'.json';await save(report,JSON.stringify(records,null,2));const failed=records.filter(record=>record.issues.length);
  if(failed.length)throw Error(failed.length+' compositions à examiner ; rapport '+report+' · '+failed.map(record=>record.id+' '+record.format+': '+record.issues.join('; ')).join(' | '));return records;
}

/** Actual full exports using the same production entry point. Shortest useful
 * durations cover the three original representatives and the three converted
 * engines; no synthetic end-frame encoder. */
export async function fadeEndExports(dataFor:Factory,save:Save,status:(text:string)=>void,signal:AbortSignal){
  const records:any[]=[],stamp=Date.now();
  for(const [id,format,duration]of [
    ['BTV_BA_1P','vertical',8],
    ['BTV_PopUp','tv',3.2],
    ['BTV_Relais_Antenne','portrait',2.4],
    ['BTV_Renvoi','tv',2.8],
    ['BTV_Evenement','portrait',4.08],
    ['BTV_Semainier','vertical',2.72],
  ] as const)for(const encoding of ['mp4','mov'] as const){
    const params=new URLSearchParams(location.search);if(params.get('fade-encoding')&&params.get('fade-encoding')!==encoding||params.get('fade-export-template')&&params.get('fade-export-template')!==id)continue;
    signal.throwIfAborted();const started=performance.now(),template=getTemplate(id),data={...dataFor(id,format),_out_mode:'duration',_out_duration_seconds:duration},issues:string[]=[],record:any={id,format,encoding,issues};
    let result:Awaited<ReturnType<typeof exportBroadcastVideo>>|undefined,reference:Awaited<ReturnType<typeof prepareGraphic>>|undefined,input:Input|undefined;
    try{
      result=await exportBroadcastVideo(template,data,{format:encoding,manualOut:duration,removeBackground:false,audio:false,background:'#000000'},signal,p=>status('Fins encodées · '+id+' '+encoding+' · '+p.message));
      record.exportMs=performance.now()-started;
      record.report=result.report;const filename='fade-export-'+id.toLowerCase().replaceAll('_','-')+'-'+format+'-'+stamp+'.'+encoding;record.file=filename;await save(filename,result.blob);
      input=new Input({formats:ALL_FORMATS,source:new BlobSource(result.blob)});const video=await input.getPrimaryVideoTrack();if(!video)throw Error('Piste vidéo absente.');const sink=new CanvasSink(video,{alpha:true,poolSize:1});reference=await prepareGraphic(template,data,duration,false,signal);
      const first=result.report.frames-Math.round(Math.min(.6,TIMINGS[id].out)*25),sheet=board(result.report.width,result.report.height,2);
      record.samples=[];for(let frame=first;frame<result.report.frames;frame++){
        signal.throwIfAborted();const decoded=await sink.getCanvas(frame/25+1e-7);if(!decoded)throw Error('Image finale indécodable '+frame);
        const referenceCanvas=await reference.frame(frame,encoding==='mp4'?'#000000':null),a=sampleProof(decoded.canvas,frame),b=sampleProof(referenceCanvas,frame),delta=difference(a,b);record.samples.push({frame,delta,decoded:metrics(a),reference:metrics(b)});
        if(frame===first||frame===result.report.frames-1){const row=frame===first?0:1;sheet.put(row,0,decoded.canvas,encoding.toUpperCase()+' décodé · '+(frame/25).toFixed(2)+' s');sheet.put(row,1,referenceCanvas,'Rendu · '+(frame/25).toFixed(2)+' s');}
        if(encoding==='mov'&&delta.alpha>6||delta.premultiplied>22)issues.push('Image '+frame+' différente après encodage '+JSON.stringify(delta));
      }
      record.proof='fade-encoded-'+id.toLowerCase().replaceAll('_','-')+'-'+format+'-'+encoding+'-'+stamp+'.png';await save(record.proof,await blob(sheet.canvas));sheet.canvas.width=sheet.canvas.height=0;
    }catch(error){signal.throwIfAborted();issues.push(error instanceof Error?error.stack||error.message:String(error));}
    finally{input?.dispose();await reference?.dispose();await result?.dispose();}
    record.durationMs=performance.now()-started;record.result=issues.length?'FAIL':'PASS';records.push(record);await save('fade-export-progress-'+Date.now()+'.json',JSON.stringify(records,null,2));
  }
  const filename='fade-exports-'+stamp+'.json';await save(filename,JSON.stringify(records,null,2));if(records.some(record=>record.issues.length))throw Error('Certaines fins encodées restent à qualifier : '+filename);return records;
}
