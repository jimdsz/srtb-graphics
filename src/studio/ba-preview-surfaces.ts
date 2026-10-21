import type {BroadcastTemplate} from './domain';
import type {LegacyGraphic} from './video/engine';
import {PreviewBudget} from './preview-budget';
import {previewDisplayEdge} from './preview-resolution';
import {previewSurfaceSize,explicitlyHiddenCanvas} from './preview-media-surfaces';
import {bindSVGMedia,needsSVGMediaPreview,previewMediaElement,SVGMediaPublisher} from './svg-media-preview';
import {BAPreviewFrame} from './ba-preview-frame';
import {BAPreviewHTMLBody,baHTMLBodyPhase,baHTMLBodyStructure} from './ba-preview-html-body';
import {PreviewWebGLGuard} from './preview-webgl-guard';
import {paintBAPreviewCanvas,copyBAPreviewCanvas} from './ba-preview-canvas';
import {previewCanvasContext,checkPreviewCanvas} from './preview-canvas-guard';
import {PreviewPictureProgress} from './preview-picture-progress';
import type {PictureSurfaceSample} from './preview-picture-progress';

type Kind='intro'|'body'|'pack';
const kinds:Kind[]=['intro','body','pack'];
/** Native AE framing, in composition coordinates, independent of raster size. */
export function baPreviewPlacement(width:number,height:number,fit:string,kind:Kind){
  const scale=(fit==='contain'?Math.min:Math.max)(1920/width,1080/height);
  return {x:(1920-width*scale)/2+1,y:(1080-height*scale)/2+(kind==='pack'?-152:kind==='intro'?1:0),width:width*scale,height:height*scale};
}
export function baPreviewStage(width:number,height:number){
  const scale=width>0&&height>0?Math.min(width/1920,height/1080):1;
  return {scale,x:Math.max(0,(width-1920*scale)/2),y:Math.max(0,(height-1080*scale)/2)};
}
function size(canvas:HTMLCanvasElement,width:number,height:number){
  if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
}

/** Instance-local TV preview only. SVG geometry remains at 1920×1080: scaling
 * the HTML stage avoids depending on WebKit's foreignObject/viewBox scaling.
 * Media surfaces, including colour conversion, are bounded before each copy.
 * Native shaders, LUT, clipping and animation clocks are unchanged. */
export function installBAPreviewSurfaces(g:LegacyGraphic,t:BroadcastTemplate,svgMedia=needsSVGMediaPreview(navigator.userAgent),preferHTMLBody=true){
  if(t.id!=='BTV_BA_1P'||t.version!=='1.0.3'||t.libraryVersion!=='1.7.0')return;
  const budget=new PreviewBudget(navigator.hardwareConcurrency);
  if(svgMedia)budget.edge=Math.min(budget.edge,960);
  g.__previewRenderer=svgMedia?'ba-tv-worker-media-v4':'ba-tv-direct-canvas-v3';
  let width=0,height=0,closed=false;
  const fit=(scene=g.scene)=>{
    if(closed)return;
    const container=scene?.container as HTMLElement|undefined;if(!container)return;
    const layout=baPreviewStage(width,height);
    container.style.cssText=`position:absolute;inset:auto;width:1920px;height:1080px;left:${layout.x}px;top:${layout.y}px;transform-origin:0 0;transform:scale(${layout.scale});overflow:hidden;visibility:${container.style.visibility||'hidden'}`;
    g.__previewMediaEdge=previewDisplayEdge(width,height,1920,1080,devicePixelRatio,budget.edge);
  };
  const observer=new ResizeObserver(entries=>{
    const rect=entries[0]?.contentRect;if(!rect)return;width=rect.width;height=rect.height;fit();
    if(!g._running)g.scene?.canvases?.draw();
  });observer.observe(g);
  if(!g._build)throw Error('Moteur BA incompatible avec les surfaces d’aperçu.');
  const build=g._build.bind(g),dispose=g.dispose.bind(g);
  g._build=async(...args:any[])=>{const scene=await build(...args);fit(scene);return scene;};
  const seek=g.goToTime.bind(g);
  g.goToTime=async(args:{seconds:number})=>{const result=await seek(args);await g.scene?.canvases?.flush?.();return result;};
  g.dispose=()=>{closed=true;observer.disconnect();return dispose();};
  g.__installPreviewMediaCanvases=async(animation:any,engine:any,{baseUrl,signal}:{baseUrl:string;signal:AbortSignal})=>{
    const colourModule='/studio-engines/ba-text-v2/preview-colour.mjs';
    const [{PackGrade},response]=await Promise.all([
      import(/* @vite-ignore */colourModule),
      fetch(new URL('lib/media/native-pack-grade.rgb',baseUrl),{signal}),
    ]);
    if(!response.ok)throw Error('LUT native inaccessible.');
    const lut=new Uint8Array(await response.arrayBuffer());signal.throwIfAborted();
    if(lut.length!==64**3*3)throw Error('LUT native incomplète.');
    let grade:any,colour:any,gradeGuard:PreviewWebGLGuard|undefined,colourGuard:PreviewWebGLGuard|undefined;
    const fused=svgMedia?{} as Record<Kind,BAPreviewFrame>:undefined;
    const disposeGPU=()=>{for(const frame of Object.values(fused||{}))frame.dispose();gradeGuard?.dispose();colourGuard?.dispose();grade?.dispose();colour?.dispose();};
    try{
      if(fused){for(const kind of kinds)fused[kind]=new BAPreviewFrame(lut);}
      else{grade=new PackGrade(lut);gradeGuard=new PreviewWebGLGuard(grade.gl);colour=new PackGrade(lut,1080);colourGuard=new PreviewWebGLGuard(colour.gl);}
    }catch(error){disposeGPU();throw error;}
    const targets:Record<Kind,HTMLCanvasElement[]>={intro:[],body:[],pack:[]};
    const images:Record<Kind,SVGImageElement[]>={intro:[],body:[],pack:[]};
    const bodyLayers:{image:SVGImageElement;index:number}[]=[];
    const scratch=Object.fromEntries(kinds.map(kind=>[kind,document.createElement('canvas')])) as Record<Kind,HTMLCanvasElement>;
    const input=document.createElement('canvas');
    const names=new Map(animation.animationData.assets.map((a:any)=>[a.id,a.nm]));
    const mapping=new Map<string,Kind>([['BA_1P_Rush_Intro','intro'],['BA_1P_Rush_Corps','body'],['BA_1P_Rush_Pack_Demi','pack']]);
    function walk(container:any){for(const element of container.elements||[]){if(!element)continue;const kind=mapping.get(String(names.get(element.data?.refId)));
      if(!kind){walk(element);continue;}
      const target=document.createElementNS('http://www.w3.org/1999/xhtml','canvas') as HTMLCanvasElement;
      target.style.cssText=`display:block;width:1920px;height:${kind==='pack'?540:1080}px`;
      if(svgMedia){
        const image=document.createElementNS('http://www.w3.org/2000/svg','image');
        image.setAttribute('x','0');image.setAttribute('y','0');image.setAttribute('width','1920');image.setAttribute('height',kind==='pack'?'540':'1080');image.setAttribute('preserveAspectRatio','none');image.setAttribute('data-studio-media-kind',kind);
        element.layerElement.replaceChildren(image);bindSVGMedia(target,image);images[kind].push(image);
        if(kind==='body')bodyLayers.push({image,index:element.data.ind});
      }else{
        const foreign=document.createElementNS('http://www.w3.org/2000/svg','foreignObject');
        foreign.setAttribute('x','0');foreign.setAttribute('y','0');foreign.setAttribute('width','1920');foreign.setAttribute('height',kind==='pack'?'540':'1080');
        foreign.append(target);element.layerElement.replaceChildren(foreign);
      }
      targets[kind].push(target);
    }}
    try{walk(animation.renderer);if(kinds.some(kind=>!targets[kind].length))throw Error('Instances média du modèle manquantes.');}
    catch(error){disposeGPU();throw error;}
    const publishers=svgMedia?Object.fromEntries(kinds.map(kind=>[kind,new SVGMediaPublisher(images[kind],error=>g._fail(error),true)])) as Record<Kind,SVGMediaPublisher>:undefined;
    const bodySVG=bodyLayers[0]?.image.ownerSVGElement;
    const htmlBody=svgMedia&&preferHTMLBody&&baHTMLBodyStructure(animation.animationData)&&bodyLayers.length===2&&bodyLayers.some(layer=>layer.index===25)&&bodyLayers.some(layer=>layer.index===26)&&bodySVG?.parentElement&&bodyLayers.every(layer=>layer.image.ownerSVGElement===bodySVG)&&typeof DOMMatrix==='function'&&typeof CSS!=='undefined'&&typeof CSS.supports==='function'&&CSS.supports('clip-path','inset(50% 0 0 0)')?new BAPreviewHTMLBody(bodyLayers):undefined;
    g.__previewRenderer=svgMedia?(htmlBody?'ba-tv-hybrid-media-v5':'ba-tv-worker-media-v4'):'ba-tv-direct-canvas-v3';
    const copies=Object.fromEntries(kinds.map(kind=>[kind,new PreviewPictureProgress()])) as Record<Kind,PreviewPictureProgress>;
    const phaseActive=(kind:Kind,seconds:number)=>kind==='intro'?seconds<5.6:kind==='body'?seconds>=4.36&&seconds<66.16:seconds>=64.8&&seconds<71.24;
    // Read only on demand; no layout read, pixel extraction or animation change.
    // Inactive SVG body counters are kept separate from the active HTML sink.
    g.__previewPictureStats=(sourceId:(node:HTMLVideoElement)=>number):PictureSurfaceSample[]=>{
      const now=performance.now(),seconds=animation.currentFrame/25;
      return kinds.map(kind=>({kind,phaseActive:phaseActive(kind,seconds),destinationVisible:targets[kind].some(target=>!explicitlyHiddenCanvas(target))&&(!(kind==='body'&&htmlBody?.active)||htmlBody.copyExpected),sourceIsVideo:engine.node(kind) instanceof HTMLVideoElement,sourceId:engine.node(kind) instanceof HTMLVideoElement?sourceId(engine.node(kind)):null,
        sink:publishers?(kind==='body'&&htmlBody?.active?'html-canvas':'svg-href'):'canvas',
        copy:copies[kind].snapshot(now),...(publishers?{svg:publishers[kind].pictureProgress(now)}:{})}));
    };
    if(publishers)g.__previewPresentationStats=(since=0)=>kinds.map(kind=>({kind,...publishers[kind].diagnostics(since),...(kind==='body'&&htmlBody?{presentationMode:htmlBody.active?'html':'svg',htmlPresented:htmlBody.presented}:{})}));
    function draw(){
      if(closed)return;const start=performance.now(),seconds=animation.currentFrame/25;
      const useHTMLBody=!!htmlBody&&!g.__previewHTMLBodyDisabled&&baHTMLBodyPhase(seconds)&&engine.node('body') instanceof HTMLVideoElement;htmlBody?.show(useHTMLBody);
      const edge=previewDisplayEdge(width,height,1920,1080,devicePixelRatio,budget.edge);
      g.__previewMediaEdge=edge;
      for(const kind of kinds){
        const active=phaseActive(kind,seconds);
        for(const target of targets[kind]){target.style.display=active?'block':'none';(previewMediaElement(target) as SVGElement|HTMLCanvasElement).style.display=target.style.display;}
        if(!active)continue;
        const node=engine.node(kind);if(!node||node.tagName==='VIDEO'&&(node.readyState<2||node.seeking))continue;
        const visible=g._running?targets[kind].filter(target=>!explicitlyHiddenCanvas(target)):targets[kind];
        if(!visible.length)continue;
        if(g._running&&publishers)budget.observePresentation(publishers[kind].stats);
        // Do not copy/grade a frame which the presentation queue cannot accept.
        // Inspection still requests the exact frame and awaits flush().
        if(g._running&&publishers?.[kind].busy&&!(kind==='body'&&useHTMLBody))continue;
        const w=node.videoWidth||node.naturalWidth,h=node.videoHeight||node.naturalHeight;
        const bounded=previewSurfaceSize(w,h,edge);if(!bounded)continue;
        const track=engine.tracks[kind],rec709=track.colorSpace==='rec709_gamma24'||track.colorSpace==='auto'&&node.tagName==='VIDEO';
        const boundedTarget=previewSurfaceSize(1920,kind==='pack'?540:1080,edge)!;
        if(fused&&publishers){
          const frame=fused[kind].draw(node,boundedTarget.width,boundedTarget.height,kind,baPreviewPlacement(w,h,track.fit,kind),rec709);
          if(kind==='body'&&useHTMLBody){if(htmlBody!.draw(frame))copies[kind].record(performance.now(),node.currentTime);}else publishers[kind].publish(frame);
          continue;
        }
        let sampled=node;
        if(bounded.width!==w||bounded.height!==h){
          size(input,bounded.width,bounded.height);
          const inputContext=previewCanvasContext(input);inputContext.clearRect(0,0,input.width,input.height);inputContext.drawImage(node,0,0,input.width,input.height);checkPreviewCanvas(inputContext);sampled=input;
        }
        const source=rec709?colour.draw(colourGuard!.source(sampled),{rec709,grading:false,sourceSize:true}):sampled;
        if(rec709)colourGuard!.check();
        // Both body occurrences retain their native mask, opacity and paint
        // order. Only the redundant scratch -> first-slot copy is removed.
        const canvas=!publishers&&kind!=='pack'?visible[0]:scratch[kind];
        paintBAPreviewCanvas(source,canvas,boundedTarget.width,boundedTarget.height,kind,baPreviewPlacement(w,h,track.fit,kind));
        // Resize the shader destination without altering the native colour math.
        if(kind==='pack'){size(grade.canvas,canvas.width,canvas.height);grade.gl.viewport(0,0,canvas.width,canvas.height);}
        const frame=kind==='pack'?grade.draw(gradeGuard!.source(canvas)):canvas;
        if(kind==='pack')gradeGuard!.check();
        if(publishers){
          // Native framing can leave a one-pixel alpha border even in cover.
          // Keep PNG: no black rectangle substituted for transparent edges.
          publishers[kind].publish(frame);
        }else{copyBAPreviewCanvas(frame,visible,canvas.width,canvas.height);copies[kind].record(performance.now(),node.currentTime);}
      }
      if(g._running)budget.observe(performance.now()-start);
    }
    const disposeSurfaces=()=>{htmlBody?.dispose();for(const publisher of Object.values(publishers||{}))publisher.dispose();disposeGPU();};
    // A failed first frame never returns a scene to the engine. Release its
    // resources here so repeated operator retries do not exhaust GPU memory.
    try{draw();if(publishers)await Promise.all(kinds.map(kind=>publishers[kind].flush()));}
    catch(error){disposeSurfaces();throw error;}
    return {draw,targets,flush:()=>publishers?Promise.all(kinds.map(kind=>publishers[kind].flush())):Promise.resolve(),dispose:disposeSurfaces};
  };
}
