/// <reference path="./ae-logo-mask-ab-fixture.d.ts" />
import fixture from 'local:ae-logo-mask-ab';
import {getTemplate} from '../src/studio/domain';
import {studioEngineModule} from '../src/studio/text-editing';
import {FrameRaster} from '../src/studio/video/raster';
import {AE_LOGO_REFERENCE,AE_LOGO_REGIONS,measureReferenceRegion,NativePlacementMismatchError,verifyNativePlacement,verifyNativeSourcePose} from './ae-logo-reference-model';
import type {Region} from './ae-logo-reference-model';
import {ABTransformMismatch,evaluatedPathData,exactRgbaReplay,invariant as assert,preparePolygonProbe,verifyEvaluatedPolygon,verifyExactGroupTransform} from './ae-logo-mask-ab-model';

const run=document.querySelector<HTMLButtonElement>('#run')!,status=document.querySelector('#status')!,result=document.querySelector('#result')!;
const stage=document.querySelector('#native-scene')!,probeStage=document.querySelector<HTMLElement>('#polygon-probe')!,gallery=document.querySelector('#comparisons')!;
const base='/library/v1.7.0/BTV_BA_1P/',repairPath='/library/v1.7.0/_shared/ae-live-media.mjs';
const hash=async(bytes:ArrayBuffer)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
const nextPaint=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
let graphic:any;
function canvas(width=1920,height=1080){const c=document.createElement('canvas');c.width=width;c.height=height;return c;}
function rgba(c:HTMLCanvasElement){return c.getContext('2d',{willReadFrequently:true})!.getImageData(0,0,c.width,c.height).data;}
function png(c:HTMLCanvasElement){return new Promise<Blob>((resolve,reject)=>c.toBlob(blob=>blob?resolve(blob):reject(Error('PNG unavailable.')),'image/png'));}
function show(source:HTMLCanvasElement,region:Region,label:string,row:Element){const c=canvas(region.width,region.height);c.getContext('2d')!.drawImage(source,region.x,region.y,region.width,region.height,0,0,region.width,region.height);const figure=document.createElement('figure'),caption=document.createElement('figcaption');caption.textContent=label;figure.append(caption,c);row.append(figure);}
function liveLayer(container:any,ind:number,name:string){const layer=container?.elements?.find((e:any)=>e?.data?.ind===ind&&e.data.nm===name);assert(layer,`Active layer missing: ${ind}/${name}.`);return layer;}
function chain(g:any){const animation=g.scene.animation,renderer=animation.renderer,outro=liveLayer(renderer,16,'Outro_vert'),benin=liveLayer(outro,1,'BENINTV_Roll'),tv=liveLayer(benin,1,'Anim TV Roll HAUT 2'),v=liveLayer(tv,4,'V');return {animation,renderer,outro,benin,tv,v};}
function layerEvidence(e:any){return {index:e.data.ind,name:e.data.nm,sourceStart:e.data.st,sourceStretch:e.data.sr,renderedFrame:e.renderedFrame??null,inRange:e.isInRange,
  transform:e.layerElement?.getAttribute('transform'),matrix:e.finalTransform?.mat?.props?Array.from(e.finalTransform.mat.props):null};}
async function inspectPose(g:any,seek:any){
  const {animation,renderer,outro,benin,tv,v}=chain(g),statusValue=await g.getStatus();
  assert(animation.isPaused===true,'Native animation must remain paused.');
  const pose=verifyNativeSourcePose({seekFrame:seek.frame,statusFrame:statusValue.frame,animationFrame:animation.currentFrame,rendererFrame:renderer.renderedFrame,frameRate:animation.frameRate,outroFrame:outro.renderedFrame,beninFrame:benin.renderedFrame,tvFrame:tv.renderedFrame});
  assert([outro,benin,tv,v].every(e=>e.isInRange),'A native logo layer is out of range.');
  const {placements,rendererNormalizations}=verifyNativePlacement(g.original,g.state.renderedTemplate);
  assert(['B','é','N','I','N'].every((name,index)=>benin.elements.some((e:any)=>e?.data.ind===index+2&&e.data.nm===name&&e.isInRange)),'All five native BÉNIN letters must remain present.');
  assert(tv.layerElement.querySelector('[data-btv-logo-output="Anim_TV_Roll"]'),'Current BA T/V compositor missing.');
  const background=outro.elements.find((e:any)=>e?.data?.nm==='__BTV_OUTRO_UNIFORM'),data=background?.data;
  assert(background?.isInRange&&data.ty===1&&data.sw===1920&&data.sh===1080&&data.sc==='#007300'&&data.ip===35&&data.ks.o.k===100&&!data.masksProperties&&!data.ef,'Checked opaque native outro field missing.');
  assert(outro.layers.indexOf(data)>outro.layers.indexOf(benin.data),'Native background must remain behind the logo.');
  return {pose,placements,rendererNormalizations,liveParents:[outro,benin,tv,v].map(layerEvidence),vGroupTransform:v.itemsData[0].gr.getAttribute('transform'),background:{name:data.nm,colour:data.sc,frame:outro.renderedFrame}};
}
function mediaFixture(defaults:Record<string,unknown>){
  const picture=canvas(960,540),ctx=picture.getContext('2d')!;ctx.fillStyle='#213b52';ctx.fillRect(0,0,960,540);
  const media={url:picture.toDataURL('image/png'),name:'qa-logo-mask-ab.png',mimeType:'image/png'},data={...defaults};
  for(const key of Object.keys(data))if(/audio.*enabled$/.test(key))data[key]=false;
  for(const kind of ['intro','body','pack'])Object.assign(data,{[`_media_${kind}_url`]:media,[`_media_${kind}_start_seconds`]:0,[`_media_${kind}_end_seconds`]:80,[`_media_${kind}_sequence`]:'[]',[`_media_${kind}_loop`]:false});
  return data;
}
async function readReference(){
  assert(await hash(await (await fetch(fixture.image)).arrayBuffer())===AE_LOGO_REFERENCE.sha256&&fixture.sha256===AE_LOGO_REFERENCE.sha256,'Independent reference hash differs.');
  const image=new Image();image.src=fixture.image;await image.decode();assert(image.naturalWidth===1920&&image.naturalHeight===1080,'Independent reference dimensions differ.');
  const c=canvas();c.getContext('2d')!.drawImage(image,0,0);return c;
}
async function verifyModules(){return Object.fromEntries(await Promise.all(Object.entries(fixture.moduleHashes).map(async([path,expected])=>{
  const response=await fetch('/'+path.replace(/^public\//,''),{cache:'no-store'});assert(response.ok,`Local module missing: ${path}.`);
  const actual=await hash(await response.arrayBuffer());assert(actual===expected,`Module changed since this test build: ${path}. Rebuild this test.`);return [path,actual];
})));}
// The whole original shadow tree is compared, including defs, masks, matrices,
// text and paint. Only these TWO attributes of this ONE object are exempt.
function canonicalScene(root:Node,target:Element):string{
  function visit(node:Node):unknown{
    if(node instanceof Element)return [node.namespaceURI,node.localName,Array.from(node.attributes).filter(a=>node!==target||!['d','mask'].includes(a.name)).map(a=>[a.namespaceURI,a.name,a.value]).sort((a,b)=>String(a[1]).localeCompare(String(b[1]))),Array.from(node.childNodes,visit)];
    return [node.nodeType,node.nodeValue,Array.from(node.childNodes,visit)];
  }
  return JSON.stringify(visit(root));
}
function setAttribute(node:Element,key:string,value:string|null){if(value===null)node.removeAttribute(key);else node.setAttribute(key,value);}
async function saveEvidence(report:Record<string,unknown>,images:Record<string,HTMLCanvasElement>){
  if(location.origin!=='http://127.0.0.1:5192')return {...report,localEvidence:{complete:false,reason:'Automatic evidence requires exact origin http://127.0.0.1:5192.'}};
  const stem=`ae-logo-mask-ab-${Date.now()}`,files:Record<string,{name:string;sha256:string;saved:boolean}>={};
  let saveError:string|undefined;
  try{
    for(const [variant,c] of Object.entries(images)){
      const blob=await png(c),name=`${stem}-${variant}.png`;files[variant]={name,sha256:await hash(await blob.arrayBuffer()),saved:false};
      const response=await fetch('/__video-evidence/'+name,{method:'POST',headers:{'Content-Type':'image/png'},body:blob});assert(response.ok,`PNG ${variant} not saved (${response.status}).`);files[variant].saved=true;
    }
  }catch(error){saveError=String(error);}
  const comparisonCaptured=['mask','polygon','mask-replay'].every(variant=>files[variant]?.saved);
  const persisted={...report,localEvidence:{json:stem+'.json',images:files,complete:comparisonCaptured&&!saveError,comparisonCaptured,diagnosticOnly:!comparisonCaptured,...(saveError?{error:saveError}:{})}};
  try{const response=await fetch('/__video-evidence/'+stem+'.json',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(persisted,null,2)});assert(response.ok,`JSON not saved (${response.status}).`);}
  catch(error){persisted.localEvidence.complete=false;persisted.localEvidence.error=String(error);}
  return persisted;
}

run.onclick=async()=>{
  if(location.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(location.hostname)){status.textContent='Banc réservé au serveur local.';return;}
  run.disabled=true;result.textContent='';gallery.replaceChildren();
  const controller=new AbortController();let raster:FrameRaster|undefined,probe:any,restore:(()=>void)|undefined;
  try{
    await graphic?.dispose();graphic=undefined;stage.replaceChildren();probeStage.replaceChildren();status.textContent='Vérification des sources et de la référence AE…';
    const [reference,moduleHashes]=await Promise.all([readReference(),verifyModules()]);
    const modulePath=studioEngineModule(getTemplate('BTV_BA_1P'));assert(modulePath==='/studio-engines/ba-text-v2/graphic.mjs','Unexpected current BA engine.');
    const engine=await import(/* @vite-ignore */modulePath),tag='qa-ba-logo-mask-ab';if(!customElements.get(tag))customElements.define(tag,class extends engine.default{});
    const g=graphic=document.createElement(tag) as any;stage.append(g);
    const loaded=await g.load({renderType:'realtime',previewMuted:true,data:mediaFixture(engine.DEFAULTS)});assert(loaded?.statusCode===200,loaded?.statusMessage||'Native load failed.');
    const seek=await g.goToTime({seconds:AE_LOGO_REFERENCE.frame/AE_LOGO_REFERENCE.fps});assert(seek?.statusCode===200,'Native source-time seek failed.');
    // Separate fresh RAW JSON: renderer-completed tangents must not be repaired.
    const sourceResponse=await fetch(base+'lib/lottie-template.json',{cache:'no-store'});assert(sourceResponse.ok,'Raw source unavailable.');const sourceBytes=await sourceResponse.arrayBuffer();
    assert(await hash(sourceBytes)===moduleHashes['public/library/v1.7.0/BTV_BA_1P/lib/lottie-template.json'],'Raw source changed during comparison.');
    const source=JSON.parse(new TextDecoder().decode(sourceBytes)),repairModule=await import(/* @vite-ignore */repairPath);
    const prepared=preparePolygonProbe(source,repairModule.repairAEMergePaths),lottiePath=base+'lib/lottie-web.esm.mjs',lottie=(await import(/* @vite-ignore */lottiePath)).default;
    probe=lottie.loadAnimation({container:probeStage,renderer:'svg',autoplay:false,loop:false,animationData:prepared.data});
    await new Promise<void>((resolve,reject)=>{if(probe.isLoaded){resolve();return;}const timeout=setTimeout(()=>reject(Error('Polygon probe load timed out.')),10000);probe.addEventListener('DOMLoaded',()=>{clearTimeout(timeout);resolve();});probe.addEventListener('data_failed',()=>{clearTimeout(timeout);reject(Error('Polygon probe failed.'));});});
    probe.setSubframe(false);probe.goToAndStop(10,true);
    const probeComp=liveLayer(probe.renderer,1,'local polygon probe'),probeV=liveLayer(probeComp,4,'V');
    assert(probe.currentFrame===10&&probe.renderer.renderedFrame===10&&probeComp.renderedFrame===10&&probe.isPaused,'Polygon probe is not at source-local frame 10.');
    const polygonShape=probeV.itemsData[0].it[0].sh.v,polygonEvaluation=verifyEvaluatedPolygon(polygonShape,prepared.expectedShape),polygonD=evaluatedPathData(polygonShape);
    const {v}=chain(g),group=v.itemsData[0].gr as Element,targets=Array.from(group.children).filter(e=>e.getAttribute('data-btv-native-path')==='V-minus-Rectangle');
    assert(targets.length===1,'Exactly one own native V subtract path is required.');const target=targets[0],maskD=target.getAttribute('d'),mask=target.getAttribute('mask');
    assert(maskD&&mask&&mask.startsWith('url('),'Current masked V path missing.');
    assert(evaluatedPathData(v.itemsData[0].it[0].sh.v)===maskD,'Raw V serializer does not reproduce the current BA path exactly.');
    verifyEvaluatedPolygon(v.itemsData[0].it[0].sh.v,prepared.originalShape);
    const groupRendererNormalizations={native:verifyExactGroupTransform(v.data.shapes[0].it.find((item:any)=>item.ty==='tr'),prepared.groupTransform,'Live V group transform differs from raw source'),
      probe:verifyExactGroupTransform(probeV.data.shapes[0].it.find((item:any)=>item.ty==='tr'),prepared.groupTransform,'Probe group transform differs from raw source')};
    assert(probeV.itemsData[0].gr.getAttribute('transform')===group.getAttribute('transform'),'Probe and native group coordinate systems differ.');
    assert(polygonD!==maskD,'A/B must change the actual polygon.');
    restore=()=>{setAttribute(target,'d',maskD);setAttribute(target,'mask',mask);};
    await document.fonts.ready;await nextPaint();raster=new FrameRaster(g.shadowRoot,new URL(base+'graphic.mjs',location.href).href,controller.signal);await raster.prepare();
    const evidence=await inspectPose(g,seek),sceneBaseline=canonicalScene(g.shadowRoot,target),checks:unknown[]=[];
    async function guard(label:string,d:string,expectedMask:string|null){
      assert(target.getAttribute('d')===d&&target.getAttribute('mask')===expectedMask,`${label}: native refresh overwrote the A/B path or mask.`);
      assert(canonicalScene(g.shadowRoot,target)===sceneBaseline,`${label}: another main-scene node/attribute changed. Comparison stopped.`);
      const observed=await inspectPose(g,seek);assert(same(observed,evidence),`${label}: native pose/parents/placement changed. Comparison stopped.`);
      // getStatus is awaited above; verify the actual tree again afterwards.
      assert(target.getAttribute('d')===d&&target.getAttribute('mask')===expectedMask&&canonicalScene(g.shadowRoot,target)===sceneBaseline,`${label}: scene changed during native status inspection.`);
      checks.push({label,pose:observed.pose,paused:true,sceneUnchangedExceptTargetDAndMask:true});
    }
    async function capture(label:string,d:string,expectedMask:string|null){await guard(label+' before',d,expectedMask);const drawn=await raster!.draw(null,false,true),copy=canvas();copy.getContext('2d')!.drawImage(drawn,0,0);await guard(label+' after',d,expectedMask);return copy;}
    status.textContent='Capture A : masque actuel, scène native inchangée…';const a=await capture('A mask',maskD,mask);
    target.setAttribute('d',polygonD);target.removeAttribute('mask');
    status.textContent='Capture B : polygone exact, mêmes parents et matrices…';const b=await capture('B polygon',polygonD,null);
    restore();status.textContent='Contrôle A2 : retour exact au masque actuel…';const replay=await capture('A2 mask replay',maskD,mask);
    const sourcePixels=rgba(reference),aPixels=rgba(a),bPixels=rgba(b),replayPixels=rgba(replay),replayControl=exactRgbaReplay(aPixels,replayPixels);
    const measurements=AE_LOGO_REGIONS.map(region=>{const aeVsMask=measureReferenceRegion(sourcePixels,aPixels,1920,1080,region),aeVsPolygon=measureReferenceRegion(sourcePixels,bPixels,1920,1080,region);return {id:region.id,region,aeVsMask,aeVsPolygon,maskVsPolygon:measureReferenceRegion(aPixels,bPixels,1920,1080,region),meanAbsoluteRgbChangePolygonMinusMask:aeVsPolygon.meanAbsoluteRgb-aeVsMask.meanAbsoluteRgb};});
    const report={schema:1,status:replayControl.exact?'measured':'inconclusive-control',acceptanceCriterion:null,isolatedPreviousVerdict:'FAIL remains FAIL: alpha 68/64, no threshold changed',observedAt:new Date().toISOString(),
      reference:{...AE_LOGO_REFERENCE,actualSha256:fixture.sha256},modulePath,moduleHashes,environment:{userAgent:navigator.userAgent,devicePixelRatio},
      experiment:{variantA:'Current BA custom V path with subtract mask',variantB:'Frozen repairAEMergePaths polygon evaluated by same BA Lottie at local 10; only custom V d and mask changed',control:'A2 restores exact original d and mask; full-frame RGBA must equal A',raster:'Current FrameRaster, complete scene, lossless bitmaps, no added background',media:'Same opaque #213b52 image covered by checked native outro field; audio disabled'},
      ...evidence,geometry:{...prepared.evidence,polygonEvaluation,groupRendererNormalizations,maskD,mask,polygonD},integrity:{checks,replayControl,canonicalSceneSha256:await hash(new TextEncoder().encode(sceneBaseline).buffer)},measurements,
      limitations:['Descriptive A/B at one native BA pose, not an independent acceptance threshold or all-template certification.','A lower error can favor one rasterization method at this pose, but does not by itself authorize a production geometry change.','Only V subtraction changes; remaining BÉNIN/T/V contours, colour management and the current rasterizer can also differ from After Effects.','The historical TV region includes the far-right edge of the last N; the complete logo is measured as well.','No Safari/Mac or physical display certification.','The earlier isolated FAIL 68/64 is neither rerun nor converted to PASS.']};
    for(const region of AE_LOGO_REGIONS){const title=document.createElement('h2');title.textContent=region.label;gallery.append(title);const row=document.createElement('div');row.className='comparisons';gallery.append(row);show(reference,region,'After Effects — indépendant',row);show(a,region,'A — masque actuel',row);show(b,region,'B — polygone exact',row);}
    status.textContent='Conservation locale des trois PNG et des mesures JSON…';const saved=await saveEvidence(report,{mask:a,polygon:b,'mask-replay':replay});result.textContent=JSON.stringify(saved,null,2);
    status.textContent=(replayControl.exact?'A/B mesuré ; contrôle A2 exactement identique à A. ':'A/B non concluant : A2 diffère de A. ')+(saved.localEvidence.complete?'JSON et trois PNG conservés localement. ':'Conservation incomplète : voir le rapport. ')+'Aucun verdict global de fidélité.';
  }catch(error){const report={schema:1,status:'blocked',acceptanceCriterion:null,error:String(error),...(error instanceof NativePlacementMismatchError?{placementDifferences:error.differences,rendererNormalizations:error.rendererNormalizations}:{}),...(error instanceof ABTransformMismatch?{transformDifference:{label:error.label,differences:error.differences,expected:error.expected,actual:error.actual,rendererNormalizations:error.rendererNormalizations}}:{})};result.textContent=JSON.stringify(await saveEvidence(report,{}),null,2);status.textContent=`A/B interrompu : ${error instanceof Error?error.message:String(error)}`;}
  finally{restore?.();raster?.dispose();probe?.destroy();run.disabled=false;}
};
