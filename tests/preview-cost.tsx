// Isolated browser bench: same Preview as production, no API/session or upload.
import {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {broadcastTemplates,getTemplate} from '../src/studio/domain';
import type {ProjectData} from '../src/studio/domain';
import {cataloguePreviewData} from '../src/studio/catalogue-preview';
import {tracksOf} from '../src/studio/media-tracks';
import {beginLocalFile} from '../src/studio/local-media';
import {explicitlyHiddenCanvas,paintPreviewMedia} from '../src/studio/preview-media-surfaces';
import {previewDisplayEdge} from '../src/studio/preview-resolution';
import {previewMediaElement} from '../src/studio/svg-media-preview';
import {PreviewImageEncoder} from '../src/studio/preview-image-encoder';
import {FrameRaster} from '../src/studio/video/raster';
import {TYPOGRAPHY_KEY,textFields} from '../src/studio/typography-model';
import Preview from '../src/studio/Preview';
import '../src/studio/studio.css';
import '../src/studio/theme.css';

type Source={url:string;name:string;mimeType:string;bytes?:number;cancel?:()=>void};
function settings(id:string,format:string,source?:Source,nativeSources=false,styledText=false):ProjectData{
  const data={...cataloguePreviewData(getTemplate(id)),_studio_format:format};
  for(const key of Object.keys(data)){
    if((source||!nativeSources)&&key.startsWith('_media_')&&key.endsWith('_url')&&!/logo|sponsor/.test(key))data[key]=source?{url:source.url,name:source.name,mimeType:source.mimeType}:{url:'/library/v1.7.0/BTV_BA_1P/lib/media/programme.mp4',name:'Exemple autorisé',mimeType:'video/mp4'};
    if(/^_audio.*_enabled$/.test(key))data[key]=false;
  }
  if(styledText)data[TYPOGRAPHY_KEY]=JSON.stringify(Object.fromEntries(textFields(getTemplate(id)).map(([field])=>[`${format}:${field}`,{size:105,font:'suisse',colour:'#ffffff'}])));
  return data;
}
function Bench(){
  const [id,setId]=useState('BTV_Semainier'),[format,setFormat]=useState('vertical'),[data,setData]=useState(()=>settings('BTV_Semainier','vertical'));
  const [ready,setReady]=useState(false),[working,setWorking]=useState(false),[report,setReport]=useState(''),[history,setHistory]=useState<unknown[]>([]);
  const [source,setSource]=useState<Source>();
  const [nativeSources,setNativeSources]=useState(false);
  const [svgMedia,setSvgMedia]=useState(false);
  const [htmlBody,setHtmlBody]=useState(true);
  const [slowPresentation,setSlowPresentation]=useState(false);
  const [styledText,setStyledText]=useState(false);
  useEffect(()=>()=>source?.cancel?.(),[source]);
  const host=useRef<HTMLDivElement>(null),loadedAt=useRef(performance.now()),loadMs=useRef(0);
  function change(nextId:string,nextFormat:string,nextSource=source,native=nativeSources,styled=styledText){loadedAt.current=performance.now();loadMs.current=0;setReady(false);setId(nextId);setFormat(nextFormat);setNativeSources(native);setStyledText(styled);setData(settings(nextId,nextFormat,nextSource,native,styled));}
  function select(file?:File){if(!file)return;const selected=beginLocalFile(file,()=>{}),next={...selected.descriptor,bytes:file.size,cancel:selected.cancel};setSource(next);change(id,format,next);}
  async function compareBAComposition(){
    const graphic=host.current?.querySelector('.graphic-host')?.firstElementChild as any;if(!graphic?.__previewTransport)return;
    setWorking(true);setReport('Comparaison des compositions complètes SVG / HTML…');
    const controller=new AbortController(),rows:unknown[]=[],raster=new FrameRaster(graphic.shadowRoot,new URL(getTemplate(id).module,location.href).href,controller.signal);
    try{
      await graphic.__previewTransport.pause();await raster.prepare();
      if(graphic.__previewRenderer!=='ba-tv-hybrid-media-v5')throw Error('Activer le corps HTML BA pour cette comparaison.');
      for(const time of [5.56,5.6,8,64.8,65.4,66.12,66.16]){
        graphic.__previewHTMLBodyDisabled=true;await graphic.__previewTransport.seek(time);
        // Let the paused decoder settle once. Re-seeking between reference and
        // candidate can select adjacent source frames even at the same time.
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        graphic.scene.canvases.draw();await graphic.scene.canvases.flush();
        const before=await raster.draw(null,false,true),a=before.getContext('2d')!.getImageData(0,0,1920,1080).data;
        graphic.__previewHTMLBodyDisabled=false;graphic.scene.canvases.draw();await graphic.scene.canvases.flush();
        const after=await raster.draw(null,false,true),b=after.getContext('2d')!.getImageData(0,0,1920,1080).data;
        let total=0,alpha=0,maximum=0,changed=0;for(let i=0;i<a.length;i++){const difference=Math.abs(a[i]-b[i]);total+=difference;maximum=Math.max(maximum,difference);if(i%4===3)alpha+=difference;if(difference>1)changed++;}
        const row={time,meanDifference:total/a.length,alphaDifference:alpha/(a.length/4),maximumDifference:maximum,channelsOver1:changed,pass:total/a.length<.15&&alpha/(a.length/4)<.15};rows.push(row);
        setReport(JSON.stringify({comparison:'Composition complète via FrameRaster local, pas capture Safari',rows},null,2));
      }
      const result={comparison:'Composition complète via FrameRaster local, pas capture Safari',rows,pass:rows.every((row:any)=>row.pass)};setReport(JSON.stringify(result,null,2));setHistory(items=>[...items,result]);
    }catch(error){setReport(JSON.stringify({error:String(error),rows},null,2));}
    finally{graphic.__previewHTMLBodyDisabled=false;raster.dispose();setWorking(false);}
  }
  async function checkBALifecycle(){
    const graphic=host.current?.querySelector('.graphic-host')?.firstElementChild as any;if(!graphic?.__previewTransport)return;
    setWorking(true);setReport('Contrôle lecture, pause, recherche et modification BA…');const transport=graphic.__previewTransport,original=structuredClone(graphic.data),rows:any[]=[];
    const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
    const body=()=>graphic.__previewPresentationStats().find((item:any)=>item.kind==='body');let changed=false;
    try{
      await transport.pause();await transport.seek(8);const before=body().htmlPresented;
      await transport.resume();await wait(350);await transport.pause();await wait(80);
      const paused=body().htmlPresented,time=transport.snapshot().seconds;await wait(150);
      rows.push({action:'Lecture puis pause',framesDrawn:paused-before,time,pass:paused>before&&body().htmlPresented===paused&&transport.snapshot().seconds===time});
      await transport.seek(5.56);const root=graphic.shadowRoot.querySelector('[data-studio-body-presentation="html"]');
      rows.push({action:'Recherche avant activation',pass:root.style.display==='none'});
      await transport.seek(5.6);rows.push({action:'Recherche première image HTML',pass:root.style.display==='block'});
      await transport.seek(8);await transport.out();await wait(300);await transport.pause();
      rows.push({action:'OUT manuel depuis le corps',phase:graphic.state.phase,frame:graphic.state.currentFrame,pass:graphic.state.currentFrame>=1620&&graphic.state.currentFrame<1654&&root.style.display==='block'});
      changed=true;await graphic.updateAction({...original,_titre_ligne_1:'TEST'});await transport.seek(8);
      rows.push({action:'Modification texte et reconstruction',surfaces:graphic.shadowRoot.querySelectorAll('[data-studio-body-presentation="html"]').length,pass:graphic.__previewRenderer==='ba-tv-hybrid-media-v5'&&graphic.shadowRoot.querySelectorAll('[data-studio-body-presentation="html"]').length===1&&body().htmlPresented>0});
      const still=document.createElement('canvas');still.width=2;still.height=2;const context=still.getContext('2d')!;context.fillStyle='rgba(70,130,190,.5)';context.fillRect(0,0,2,2);
      await graphic.updateAction({...original,_media_body_url:{url:still.toDataURL('image/png'),name:'Test alpha local',mimeType:'image/png'},_media_body_sequence:'[]',_media_body_start_seconds:0,_media_body_end_seconds:60});await transport.seek(8);
      const stillRoot=graphic.shadowRoot.querySelector('[data-studio-body-presentation="html"]');
      rows.push({action:'Image fixe transparente : repli SVG',mode:body().presentationMode,pass:body().presentationMode==='svg'&&body().presented>0&&stillRoot.style.display==='none'});
      await graphic.updateAction(original);changed=false;await transport.seek(8);
      const result={rows,errors:[...(graphic.state?.errors||[])],pass:rows.every(row=>row.pass)};setReport(JSON.stringify(result,null,2));setHistory(items=>[...items,result]);
    }catch(error){setReport(JSON.stringify({error:String(error),rows},null,2));}
    finally{try{await transport.pause();if(changed)await graphic.updateAction(original);}finally{setWorking(false);}}
  }
  async function checkResize(){
    const wrapper=host.current,graphic=wrapper?.querySelector('.graphic-host')?.firstElementChild as any;
    if(!wrapper||!graphic?.__previewTransport)return;
    setWorking(true);setReport('Contrôle de redimensionnement…');
    const original=wrapper.style.width,loads:string[]=[],errors:string[]=[],rows:unknown[]=[],cleaners:(()=>void)[]=[];
    const failed=(event:ErrorEvent)=>errors.push(event.message);window.addEventListener('error',failed);
    try{
      await graphic.__previewTransport.pause();await graphic.__previewTransport.seek(8);
      const seconds=graphic.__previewTransport.snapshot().seconds,boxes=structuredClone(graphic.__socialTypography.boxes());
      const nodes=Object.values(tracksOf(graphic)).flatMap(track=>track.clips.map(clip=>clip.node));
      for(const node of new Set(nodes)){const changed=()=>loads.push('Média rechargé');node.addEventListener('loadstart',changed);node.addEventListener('emptied',changed);cleaners.push(()=>{node.removeEventListener('loadstart',changed);node.removeEventListener('emptied',changed);});}
      const saved=JSON.stringify(data),logicalHeight=format==='portrait'?1350:1920;
      for(const width of [220,320,720,260,1100]){
        wrapper.style.width=`${width}px`;
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const surface=wrapper.querySelector<HTMLCanvasElement>('.graphic-host>canvas')!,r=surface.getBoundingClientRect(),edge=Math.max(surface.width,surface.height);
        const cap=navigator.hardwareConcurrency<=4?960:1280,expected=previewDisplayEdge(r.width,r.height,1080,logicalHeight,devicePixelRatio,cap);
        const current=graphic.__socialTypography.boxes(),time=graphic.__previewTransport.snapshot().seconds;
        const geometryDelta=current.length===boxes.length?Math.max(0,...current.flatMap((box:any,i:number)=>['x','y','width','height'].map(key=>Math.abs(box[key]-boxes[i][key])))):Infinity;
        const sameGeometry=geometryDelta<1e-6&&current.every((box:any,i:number)=>box.field===boxes[i].field);
        rows.push({width,display:[r.width,r.height],raster:[surface.width,surface.height],edge,expected,time,geometryDelta,sameGeometry,
          pass:edge===expected&&Math.abs(r.width/r.height-1080/logicalHeight)<.002&&time===seconds&&sameGeometry&&saved===JSON.stringify(data)&&wrapper.querySelector('.graphic-host')?.firstElementChild===graphic});
      }
      const result={id,format,resize:rows,mediaReloads:loads,errors};setReport(JSON.stringify(result,null,2));setHistory(items=>[...items,result]);
    }catch(error){setReport(String(error));}finally{wrapper.style.width=original;cleaners.forEach(clean=>clean());window.removeEventListener('error',failed);setWorking(false);}
  }
  async function compareLayers(){
    const graphic=host.current?.querySelector('.graphic-host')?.firstElementChild as any;if(!graphic?.__previewTransport)return;
    setWorking(true);let compared=0,hidden=0;const differences:string[]=[];
    try{
      await graphic.__previewTransport.pause();
      for(const time of [0,.64,2.92,3,4.4,5.44,7.84,9.6,12.64,17.44,19.84,24]){
        await graphic.__previewTransport.seek(time);
        const items=graphic.mediaItems?[...graphic.mediaItems.values()]:graphic.mediaCanvas?[{node:graphic.media,canvas:graphic.mediaCanvas,targets:graphic.mediaTargets}]:[];
        for(const item of items){if(!item.node||!item.canvas)continue;
          if(svgMedia){
            for(const target of item.targets as HTMLCanvasElement[]){
              if(explicitlyHiddenCanvas(target)){hidden++;continue;}
              const image=previewMediaElement(target) as SVGImageElement,decoded=new Image();decoded.src=image.getAttribute('href')||'';await decoded.decode();
              const probe=document.createElement('canvas');probe.width=decoded.naturalWidth;probe.height=decoded.naturalHeight;
              const ctx=probe.getContext('2d')!;ctx.drawImage(decoded,0,0);const actual=ctx.getImageData(0,0,probe.width,probe.height).data;
              paintPreviewMedia(item.node,item.canvas,[target],Math.max(probe.width,probe.height),false);
              ctx.clearRect(0,0,probe.width,probe.height);ctx.drawImage(target,0,0,probe.width,probe.height);const expected=ctx.getImageData(0,0,probe.width,probe.height).data;
              compared++;if(expected.some((value,index)=>Math.abs(value-actual[index])>1))differences.push(`${time}s · image SVG ${compared}`);
            }
            continue;
          }
          // Paint every layer as the reference, then clear all targets. An
          // explicitly visible layer must be pixel-identical after fast paint.
          paintPreviewMedia(item.node,item.canvas,item.targets,1280,false);
          const expected=new Map<HTMLCanvasElement,Uint8ClampedArray>();
          for(const target of item.targets as HTMLCanvasElement[]){if(explicitlyHiddenCanvas(target))hidden++;else expected.set(target,target.getContext('2d')!.getImageData(0,0,target.width,target.height).data);target.getContext('2d')!.clearRect(0,0,target.width,target.height);}
          paintPreviewMedia(item.node,item.canvas,item.targets,1280,true);
          for(const [target,bytes]of expected){compared++;const actual=target.getContext('2d')!.getImageData(0,0,target.width,target.height).data;if(bytes.some((value,index)=>value!==actual[index]))differences.push(`${time}s · cible ${compared}`);}
        }
      }
      const result={id,format,renderer:graphic.__previewRenderer,foreignObjects:graphic.shadowRoot.querySelectorAll('foreignObject').length,comparison:'Calques visibles : peinture complète / peinture optimisée',compared,hidden,differences};setReport(JSON.stringify(result,null,2));setHistory(items=>[...items,result]);
    }catch(error){setReport(String(error));}finally{await graphic.__previewTransport.seek(0);setWorking(false);}
  }
  async function compareBA(){
    const graphic=host.current?.querySelector('.graphic-host')?.firstElementChild as any;if(!graphic?.__previewTransport)return;
    setWorking(true);setReport('Comparaison des pixels et du redimensionnement BA…');
    const rows:unknown[]=[],resizes:unknown[]=[],wrapper=host.current!,originalWidth=wrapper.style.width;
    try{
      const nativeModule='/library/v1.7.0/BTV_BA_1P/media.mjs';
      const {installMediaCanvases}=await import(/* @vite-ignore */nativeModule);
      await graphic.__previewTransport.pause();
      for(const time of [0,.64,2.92,4.4,5.44,5.56,5.6,8,18.04,64.8,65.4,66.12,66.16,66.2,70,71.2,72.88]){
        await graphic.__previewTransport.seek(time);
        const fast=graphic.scene.canvases;
        const parents=new Map<Element,Node[]>();
        for(const group of Object.values(fast.targets) as HTMLCanvasElement[][])for(const target of group){const element=previewMediaElement(target),parent=element===target?target.parentElement!.parentElement!:element.parentElement!;parents.set(parent,[...parent.childNodes]);}
        let reference:any;
        try{
          reference=await installMediaCanvases(graphic.scene.animation,graphic.media,{baseUrl:new URL('/library/v1.7.0/BTV_BA_1P/graphic.mjs',location.href).href});
          for(const kind of ['intro','body','pack']){
            const target=fast.targets[kind][0] as HTMLCanvasElement;
            if(target.style.display==='none')continue;
            const presented=previewMediaElement(target);let raster:HTMLCanvasElement|HTMLImageElement=target;
            if(htmlBody&&kind==='body'&&time>=5.6&&time<66.16)raster=graphic.shadowRoot.querySelector('[data-studio-body-layer="26"] canvas');
            else if(presented!==target){const image=new Image();image.src=presented.getAttribute('href')!;await image.decode();raster=image;}
            const copy=document.createElement('canvas');copy.width=raster instanceof HTMLImageElement?raster.naturalWidth:raster.width;copy.height=raster instanceof HTMLImageElement?raster.naturalHeight:raster.height;
            const ctx=copy.getContext('2d')!;ctx.drawImage(reference.targets[kind][0],0,0,copy.width,copy.height);
            const native=ctx.getImageData(0,0,copy.width,copy.height).data;ctx.clearRect(0,0,copy.width,copy.height);ctx.drawImage(raster,0,0);const actual=ctx.getImageData(0,0,copy.width,copy.height).data;
            let difference=0,alphaDifference=0,visible=0;for(let i=0;i<native.length;i++){const delta=Math.abs(native[i]-actual[i]);difference+=delta;if(i%4===3){alphaDifference+=delta;if(actual[i]>0)visible++;}}
            rows.push({time,kind,raster:[copy.width,copy.height],meanDifference:Math.round(difference/native.length*1000)/1000,alphaDifference:Math.round(alphaDifference/(native.length/4)*1000)/1000,visiblePixels:visible});
          }
        }finally{for(const [parent,children]of parents)parent.replaceChildren(...children);reference?.dispose();}
      }
      await graphic.__previewTransport.seek(18.04);
      const saved=JSON.stringify(data),loads:string[]=[],nodes=Object.values(tracksOf(graphic)).flatMap(track=>track.clips.map(clip=>clip.node));
      const loaded=()=>loads.push('reload');for(const node of nodes)node.addEventListener('loadstart',loaded);
      try{for(const width of [220,320,720,1100,260]){
        wrapper.style.width=`${width}px`;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const hostRect=graphic.getBoundingClientRect(),stage=graphic.scene.container.getBoundingClientRect(),svg=graphic.scene.container.querySelector('svg').getBoundingClientRect();
        // Layout rounds CSS dimensions to 1/64 px before applying the scale.
        const bodyRasters=htmlBody?[...graphic.shadowRoot.querySelectorAll('[data-studio-body-layer] canvas')]:graphic.scene.canvases.targets.body;
        resizes.push({width,host:[hostRect.width,hostRect.height],stage:[stage.width,stage.height],svg:[svg.width,svg.height],raster:bodyRasters.map((c:HTMLCanvasElement)=>[c.width,c.height]),time:graphic.__previewTransport.snapshot().seconds,pass:Math.abs(stage.width-hostRect.width)<=1/64&&Math.abs(stage.height-hostRect.height)<=1/64&&Math.abs(svg.width-stage.width)<=1/64&&saved===JSON.stringify(data)});
      }}finally{for(const node of nodes)node.removeEventListener('loadstart',loaded);}
      const result={id,renderer:graphic.__previewRenderer,foreignObjects:graphic.shadowRoot.querySelectorAll('foreignObject').length,comparison:'BA native / surfaces bornées, 17 positions dont les frontières HTML',rows,resizes,reloads:loads};setReport(JSON.stringify(result,null,2));setHistory(items=>[...items,result]);
    }catch(error){setReport(String(error));}finally{wrapper.style.width=originalWidth;setWorking(false);}
  }
  async function measure(){
    const graphic=host.current?.querySelector('.graphic-host')?.firstElementChild as any;if(!graphic?.__previewTransport)return;
    // Keep the actual preview in view: offscreen video throttling is not a
    // representative measurement of the operator's visible monitor.
    host.current?.scrollIntoView({block:'start'});
    setWorking(true);setReport('Mesure pendant 12 secondes…');
    const gaps:number[]=[],start=performance.now();let before=start,raf=0,reads=0,draws=0,pixels=0,hiddenDraws=0,hiddenPixels=0;
    const originalStyle=window.getComputedStyle,originalDraw=CanvasRenderingContext2D.prototype.drawImage,originalEncode=PreviewImageEncoder.prototype.encode;
    const initialRasterEdge=graphic.__previewMediaEdge;
    if(slowPresentation)PreviewImageEncoder.prototype.encode=function(canvas){const encoded=originalEncode.call(this,canvas);return Promise.all([encoded,new Promise(resolve=>setTimeout(resolve,70))]).then(([blob])=>blob);};
    const methodCosts:Record<string,{calls:number;totalMs:number;maximumMs:number}>={},restoreMethods:(()=>void)[]=[];
    const timeMethod=(owner:any,key:string,label:string)=>{
      if(typeof owner?.[key]!=='function')return;
      const original=owner[key],cost={calls:0,totalMs:0,maximumMs:0};methodCosts[label]=cost;
      owner[key]=function(...args:any[]){const began=performance.now();try{return original.apply(this,args);}finally{const elapsed=performance.now()-began;cost.calls++;cost.totalMs+=elapsed;cost.maximumMs=Math.max(cost.maximumMs,elapsed);}};
      restoreMethods.push(()=>{owner[key]=original;});
    };
    timeMethod(graphic.scene?.animation||graphic.animation,'goToAndStop','animation');
    timeMethod(graphic.scene?.canvases,'draw','mediaPaint');
    timeMethod(graphic.media,'sync','mediaSyncSynchronous');
    timeMethod(graphic.audio,'sync','audioSync');
    timeMethod(graphic.layout,'refresh','layout');
    const videos=new Map<HTMLVideoElement,{key:string;quality:VideoPlaybackQuality;seeks:number;waits:number;stalls:number;callbacks:number;frameGaps:number[];previous:number;handle:number;clean:()=>void}>();
    const discover=()=>{for(const [key,track] of Object.entries(tracksOf(graphic)))for(const clip of track.clips){const node=clip.node;if(!(node instanceof HTMLVideoElement)||videos.has(node))continue;
      const record={key,quality:node.getVideoPlaybackQuality(),seeks:0,waits:0,stalls:0,callbacks:0,frameGaps:[] as number[],previous:0,handle:0,clean:()=>{}};
      const seeking=()=>{record.seeks++;record.previous=0;},waiting=()=>{record.waits++;},stalled=()=>{record.stalls++;},pause=()=>{record.previous=0;};
      const frame=(now:number)=>{if(!node.paused&&!node.seeking){record.callbacks++;if(record.previous)record.frameGaps.push(now-record.previous);record.previous=now;}else record.previous=0;record.handle=node.requestVideoFrameCallback(frame);};
      for(const [event,fn] of [['seeking',seeking],['waiting',waiting],['stalled',stalled],['pause',pause]] as const)node.addEventListener(event,fn);
      if(node.requestVideoFrameCallback)record.handle=node.requestVideoFrameCallback(frame);
      record.clean=()=>{if(record.handle)node.cancelVideoFrameCallback(record.handle);for(const [event,fn] of [['seeking',seeking],['waiting',waiting],['stalled',stalled],['pause',pause]] as const)node.removeEventListener(event,fn);};videos.set(node,record);
    }};
    window.getComputedStyle=function(...args){reads++;return originalStyle.apply(this,args);};
    CanvasRenderingContext2D.prototype.drawImage=function(...args:any[]){draws++;pixels+=this.canvas.width*this.canvas.height;for(let parent=this.canvas.parentElement;parent;parent=parent.parentElement){if(parent.style.display==='none'||parent.style.opacity==='0'||parent.getAttribute('display')==='none'||parent.getAttribute('opacity')==='0'){hiddenDraws++;hiddenPixels+=this.canvas.width*this.canvas.height;break;}}return (originalDraw as any).apply(this,args);};
    const tick=()=>{discover();const now=performance.now();gaps.push(now-before);before=now;raf=requestAnimationFrame(tick);};
    try{
      void graphic.__previewTransport.start();raf=requestAnimationFrame(tick);
      await new Promise(resolve=>setTimeout(resolve,12000));
      cancelAnimationFrame(raf);await graphic.__previewTransport.pause();gaps.sort((a,b)=>a-b);
      const errors=[...(graphic.errors||[]),...(graphic.state?.errors||[])];
      const media=[...videos].map(([node,v])=>{const q=node.getVideoPlaybackQuality(),ordered=v.frameGaps.sort((a,b)=>a-b);return {key:v.key,width:node.videoWidth,height:node.videoHeight,duration:node.duration,totalFrames:q.totalVideoFrames-v.quality.totalVideoFrames,droppedFrames:q.droppedVideoFrames-v.quality.droppedVideoFrames,presentedCallbacks:v.callbacks,p95FrameGapMs:Math.round(ordered[Math.floor(ordered.length*.95)]||0),frameGapsOver100ms:ordered.filter(n=>n>100).length,seeks:v.seeks,waits:v.waits,stalls:v.stalls,error:node.error?.message};});
      const entry={id,format,renderer:graphic.__previewRenderer,presentation:graphic.__previewPresentationStats?.(start),foreignObjects:graphic.shadowRoot.querySelectorAll('foreignObject').length,source:source?{name:source.name,bytes:source.bytes}:nativeSources?'Sources natives du modèle':'Exemple autorisé',loadMs:Math.round(loadMs.current),elapsedMs:Math.round(performance.now()-start),rafCount:gaps.length,p95GapMs:Math.round(gaps[Math.floor(gaps.length*.95)]||0),gapsOver80ms:gaps.filter(n=>n>80).length,styleReads:reads,canvasDraws:draws,canvasMegapixels:Math.round(pixels/1e6),hiddenDraws,hiddenMegapixels:Math.round(hiddenPixels/1e6),media,errors};
      const measured={...entry,methodCosts,styledText,slowPresentation,initialRasterEdge,finalRasterEdge:graphic.__previewMediaEdge};setReport(JSON.stringify(measured,null,2));setHistory(items=>[...items,measured]);
    }catch(error){setReport(String(error));}
    finally{cancelAnimationFrame(raf);for(const v of videos.values())v.clean();restoreMethods.forEach(restore=>restore());window.getComputedStyle=originalStyle;CanvasRenderingContext2D.prototype.drawImage=originalDraw;PreviewImageEncoder.prototype.encode=originalEncode;setWorking(false);}
  }
  return <main style={{padding:24,maxWidth:1300,margin:'auto'}}>
    <h1>Mesure locale des aperçus</h1><p>Bibliothèque publique de test. Aucun envoi de fichiers. Les mesures vidéo ne remplacent pas une vérification visuelle.</p>
    <label>Fichier local ou réseau<input type="file" accept="video/*" disabled={working} onChange={e=>select(e.target.files?.[0])}/></label>
    <p>{source?`${source.name} · ${source.bytes} octets · lecture locale uniquement`:'Média exemple'}</p>
    <label>Modèle<select disabled={working} value={id} onChange={e=>change(e.target.value,format)}>{broadcastTemplates.map(t=><option key={t.id} value={t.id}>{t.id}</option>)}</select></label>
    <label>Format<select disabled={working} value={format} onChange={e=>change(id,e.target.value)}><option value="tv">TV</option><option value="portrait">4:5</option><option value="vertical">9:16</option></select></label>
    <label><input type="checkbox" disabled={working||!!source} checked={nativeSources} onChange={e=>change(id,format,source,e.target.checked)}/>Sources natives du modèle (sans substitution du banc)</label>
    <label><input type="checkbox" disabled={working} checked={styledText} onChange={e=>change(id,format,source,nativeSources,e.target.checked)}/>Tous les textes personnalisés (taille, police et couleur)</label>
    <label><input type="checkbox" disabled={working} checked={svgMedia} onChange={e=>{setSvgMedia(e.target.checked);change(id,format);}}/>Présentation média SVG (compatibilité WebKit)</label>
    <label><input type="checkbox" disabled={working||!svgMedia||id!=='BTV_BA_1P'||format!=='tv'} checked={htmlBody} onChange={e=>{setHtmlBody(e.target.checked);change(id,format);}}/>BA : corps HTML sans PNG après 5,60 s (Safari matériel non qualifié)</label>
    <label><input type="checkbox" disabled={working||!svgMedia||format!=='tv'} checked={slowPresentation} onChange={e=>setSlowPresentation(e.target.checked)}/>Retard contrôlé de 70 ms par image (test local)</label>
    <button disabled={!ready||working} onClick={()=>void measure()}>Mesurer 12 secondes</button>
    <button disabled={!ready||working||format==='tv'} onClick={()=>void checkResize()}>Vérifier le redimensionnement</button>
    <button disabled={!ready||working||format!=='tv'||!['BTV_Renvoi','BTV_Evenement','BTV_Semainier'].includes(id)} onClick={()=>void compareLayers()}>Comparer les calques visibles</button>
    <button disabled={!ready||working||format!=='tv'||id!=='BTV_BA_1P'} onClick={()=>void compareBA()}>Vérifier le cadrage BA</button>
    <button disabled={!ready||working||format!=='tv'||id!=='BTV_BA_1P'||!svgMedia||!htmlBody} onClick={()=>void compareBAComposition()}>Comparer la composition complète BA</button>
    <button disabled={!ready||working||format!=='tv'||id!=='BTV_BA_1P'||!svgMedia||!htmlBody} onClick={()=>void checkBALifecycle()}>Vérifier lecture, pause et modification BA</button>
    <pre aria-label="Résultat de mesure" role="status" style={{maxHeight:200,overflow:'auto'}}>{report}</pre>
    <div ref={host}><Preview key={`${id}:${format}:${nativeSources}:${source?.url||''}:${svgMedia}:${styledText}:${htmlBody}`} mediaPresentation={svgMedia?htmlBody?'svg':'svg-all-png':'canvas'} template={getTemplate(id)} data={data} onChange={setData} onSelectElement={()=>{}} onReadinessChange={value=>{setReady(value);if(value&&!loadMs.current)loadMs.current=performance.now()-loadedAt.current;}}/></div>
    <details><summary>Mesures successives</summary><pre>{JSON.stringify(history,null,2)}</pre></details>
  </main>;
}
const root=createRoot(document.getElementById('root')!);root.render(<Bench/>);
if(import.meta.hot)import.meta.hot.dispose(()=>root.unmount());
