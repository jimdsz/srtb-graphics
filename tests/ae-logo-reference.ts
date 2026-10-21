/// <reference path="./ae-logo-reference-fixture.d.ts" />
import referenceFixture from 'local:ae-logo-reference';
import {getTemplate} from '../src/studio/domain';
import {studioEngineModule} from '../src/studio/text-editing';
import {FrameRaster} from '../src/studio/video/raster';
import {AE_LOGO_REFERENCE,AE_LOGO_REGIONS,measureReferenceRegion,NativePlacementMismatchError,verifyNativePlacement,verifyNativeSourcePose} from './ae-logo-reference-model';
import type {Region} from './ae-logo-reference-model';

const run=document.querySelector<HTMLButtonElement>('#run')!,status=document.querySelector('#status')!,result=document.querySelector('#result')!;
const stage=document.querySelector('#native-scene')!,gallery=document.querySelector('#comparisons')!,downloads=document.querySelector('#downloads')!;
const urls:string[]=[];
let graphic:any;
function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const hash=async(bytes:ArrayBuffer)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
const nextPaint=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
function canvas(width=1920,height=1080){const node=document.createElement('canvas');node.width=width;node.height=height;return node;}
function rgba(node:HTMLCanvasElement){return node.getContext('2d',{willReadFrequently:true})!.getImageData(0,0,node.width,node.height).data;}
function show(node:HTMLCanvasElement,label:string,container:Element){const figure=document.createElement('figure'),caption=document.createElement('figcaption');caption.textContent=label;figure.append(caption,node);container.append(figure);}
function crop(source:HTMLCanvasElement,region:Region){const node=canvas(region.width,region.height);node.getContext('2d')!.drawImage(source,region.x,region.y,region.width,region.height,0,0,region.width,region.height);return node;}
function differenceImage(reference:HTMLCanvasElement,candidate:HTMLCanvasElement,region:Region){
  const a=rgba(crop(reference,region)),b=rgba(crop(candidate,region)),node=canvas(region.width,region.height),ctx=node.getContext('2d')!,pixels=ctx.createImageData(node.width,node.height);
  for(let i=0;i<a.length;i+=4){for(let c=0;c<3;c++)pixels.data[i+c]=Math.min(255,4*Math.abs(a[i+c]-b[i+c]));pixels.data[i+3]=255;}
  ctx.putImageData(pixels,0,0);return node;
}
function download(blob:Blob,name:string,label:string){const link=document.createElement('a'),url=URL.createObjectURL(blob);urls.push(url);link.href=url;link.download=name;link.textContent=label;downloads.append(link);}
function canvasPng(node:HTMLCanvasElement){return new Promise<Blob>((resolve,reject)=>node.toBlob(blob=>blob?resolve(blob):reject(Error('PNG local indisponible.')),'image/png'));}
function liveLayer(container:any,ind:number,name:string){const element=container?.elements?.find((item:any)=>item?.data?.ind===ind&&item.data.nm===name);assert(element,`Calque actif introuvable : ${ind}/${name}.`);return element;}
function layerEvidence(element:any){return {index:element.data.ind,name:element.data.nm,sourceStart:element.data.st,sourceStretch:element.data.sr,renderedFrame:element.renderedFrame,inRange:element.isInRange,
  transform:element.layerElement?.getAttribute('transform'),matrix:element.finalTransform?.mat?.props?Array.from(element.finalTransform.mat.props):null};}

async function readReference(){
  const bytes=await (await fetch(referenceFixture.image)).arrayBuffer(),actual=await hash(bytes);
  assert(actual===AE_LOGO_REFERENCE.sha256&&actual===referenceFixture.sha256,'La référence AE ne correspond pas à son empreinte indépendante.');
  const image=new Image();image.src=referenceFixture.image;await image.decode();
  assert(image.naturalWidth===1920&&image.naturalHeight===1080,'La référence AE doit conserver sa taille native.');
  const output=canvas();output.getContext('2d')!.drawImage(image,0,0);return output;
}
async function verifyServedModules(){
  return Object.fromEntries(await Promise.all(Object.entries(referenceFixture.moduleHashes).map(async([path,expected])=>{
    const response=await fetch('/'+path.replace(/^public\//,''),{cache:'no-store'});assert(response.ok,`Module local absent : ${path}.`);
    const actual=await hash(await response.arrayBuffer());assert(actual===expected,`Module modifié depuis la construction du banc : ${path}. Reconstruire le bundle local.`);return [path,actual];
  })));
}
function mediaFixture(defaults:Record<string,unknown>){
  // Same opaque still approach as overlay-logo-qualification. At this native
  // pose the checked opaque outro field covers the media underneath the logo.
  const picture=canvas(960,540);picture.getContext('2d')!.fillStyle='#213b52';picture.getContext('2d')!.fillRect(0,0,960,540);
  const source={url:picture.toDataURL('image/png'),name:'recette-logo-opaque.png',mimeType:'image/png'},data={...defaults};
  for(const key of Object.keys(data))if(/audio.*enabled$/.test(key))data[key]=false;
  for(const kind of ['intro','body','pack'])Object.assign(data,{[`_media_${kind}_url`]:source,[`_media_${kind}_start_seconds`]:0,[`_media_${kind}_end_seconds`]:80,[`_media_${kind}_sequence`]:'[]',[`_media_${kind}_loop`]:false});
  return data;
}
function inspectPose(g:any,seek:any,statusValue:any){
  const animation=g.scene.animation,renderer=animation.renderer,outro=liveLayer(renderer,16,'Outro_vert'),benin=liveLayer(outro,1,'BENINTV_Roll'),tv=liveLayer(benin,1,'Anim TV Roll HAUT 2');
  const pose=verifyNativeSourcePose({seekFrame:seek.frame,statusFrame:statusValue.frame,animationFrame:animation.currentFrame,rendererFrame:renderer.renderedFrame,
    frameRate:animation.frameRate,outroFrame:outro.renderedFrame,beninFrame:benin.renderedFrame,tvFrame:tv.renderedFrame});
  assert([outro,benin,tv].every(element=>element.isInRange),'Une composition du logo natif est hors plage.');
  const {placements,rendererNormalizations}=verifyNativePlacement(g.original,g.state.renderedTemplate);
  const nativeLetters=['B','é','N','I','N'];
  assert(nativeLetters.every((name,index)=>benin.elements.some((element:any)=>element?.data.ind===index+2&&element.data.nm===name&&element.isInRange)),'Le logo complet doit inclure les cinq lettres BÉNIN.');
  assert(tv.layerElement.querySelector('[data-btv-logo-output="Anim_TV_Roll"]'),'Les opérations natives T/V doivent être installées.');
  const backdrop=outro.elements.find((element:any)=>element?.data?.nm==='__BTV_OUTRO_UNIFORM'),data=backdrop?.data;
  assert(backdrop?.isInRange&&data.ty===1&&data.sw===1920&&data.sh===1080&&data.sc==='#007300'&&data.ip===35&&data.ks.o.k===100&&!data.masksProperties&&!data.ef,'Le fond de sortie opaque doit recouvrir les médias à la pose 1780.');
  assert(outro.layers.indexOf(data)>outro.layers.indexOf(benin.data),'Le fond opaque doit rester sous le logo.');
  return {pose,placements,rendererNormalizations,liveParents:[outro,benin,tv].map(layerEvidence),backdrop:{name:data.nm,frame:outro.renderedFrame,startsAt:data.ip,colour:data.sc,size:[data.sw,data.sh]},nativeLogo:statusValue.logo};
}

run.onclick=async()=>{
  if(!['127.0.0.1','localhost','[::1]'].includes(location.hostname)||location.protocol!=='http:'){status.textContent='Banc réservé au serveur local.';return;}
  run.disabled=true;gallery.replaceChildren();downloads.replaceChildren();result.textContent='';for(const url of urls.splice(0))URL.revokeObjectURL(url);
  const controller=new AbortController();let raster:FrameRaster|undefined;
  try{
    await graphic?.dispose();graphic=undefined;stage.replaceChildren();status.textContent='Vérification de la référence et des modules locaux…';
    const [reference,moduleHashes]=await Promise.all([readReference(),verifyServedModules()]);
    const modulePath=studioEngineModule(getTemplate('BTV_BA_1P'));
    assert(modulePath==='/studio-engines/ba-text-v2/graphic.mjs','La recette doit contrôler le moteur BA courant ba-text-v2.');
    const module=await import(/* @vite-ignore */modulePath),tag='qa-ba-ae-logo-reference';
    if(!customElements.get(tag))customElements.define(tag,class extends module.default{});
    const g=graphic=document.createElement(tag) as any;stage.append(g);
    status.textContent='Chargement du moteur actuel et inspection native à 71,20 s…';
    const loaded=await g.load({renderType:'realtime',previewMuted:true,data:mediaFixture(module.DEFAULTS)});
    assert(loaded?.statusCode===200,loaded?.statusMessage||'Chargement refusé.');
    // Use the engine's native source-time inspection, not the programme's
    // configurable OUT transport or a rewritten Lottie timeline.
    const seek=await g.goToTime({seconds:AE_LOGO_REFERENCE.frame/AE_LOGO_REFERENCE.fps}),statusValue=await g.getStatus();
    assert(seek?.statusCode===200,'Inspection native refusée.');const evidence=inspectPose(g,seek,statusValue);
    await document.fonts.ready;await nextPaint();
    raster=new FrameRaster(g.shadowRoot,new URL('/library/v1.7.0/BTV_BA_1P/graphic.mjs',location.href).href,controller.signal);
    await raster.prepare();const rendered=await raster.draw(null,false,true),candidate=canvas();candidate.getContext('2d')!.drawImage(rendered,0,0);
    const sourcePixels=rgba(reference),candidatePixels=rgba(candidate);
    const measurements=AE_LOGO_REGIONS.map(region=>({id:region.id,region:{x:region.x,y:region.y,width:region.width,height:region.height},...measureReferenceRegion(sourcePixels,candidatePixels,1920,1080,region)}));
    const report={schema:1,status:'measured',acceptanceCriterion:null,reference:{...AE_LOGO_REFERENCE,actualSha256:referenceFixture.sha256},modulePath,moduleHashes,
      observedAt:new Date().toISOString(),environment:{userAgent:navigator.userAgent,devicePixelRatio},raster:{width:1920,height:1080,method:'Current FrameRaster, complete native scene, exact bitmaps, no background override'},
      fixture:{media:'Opaque #213b52 image, covered by checked native outro field',audio:false},...evidence,measurements,
      limitations:['Descriptive differences only; no independent native acceptance threshold is established.','The rendered frame uses the current application rasterizer; this is not a Safari or physical display certification.','The full frame contains runtime changes to text/outro; only the two stated logo regions are measured.','This one source pose does not certify every transition or every template.']};
    for(const region of AE_LOGO_REGIONS){const title=document.createElement('h2');title.textContent=region.label;gallery.append(title);const row=document.createElement('div');row.className='comparisons';gallery.append(row);
      show(crop(reference,region),'After Effects — référence',row);show(crop(candidate,region),'Moteur BA actuel',row);show(differenceImage(reference,candidate,region),'Écart RGB amplifié ×4',row);}
    result.textContent=JSON.stringify(report,null,2);
    const png=await canvasPng(candidate);let finalReport:unknown=report,saveError:string|undefined;
    // This exact origin already exposes the bounded local evidence endpoint.
    // Other loopback servers retain the manual download-only workflow.
    if(location.origin==='http://127.0.0.1:5192'){
      status.textContent='Mesures terminées ; enregistrement local du JSON et du rendu PNG…';
      const stem=`ae-logo-reference-${Date.now()}`,localEvidence={json:stem+'.json',png:stem+'.png',pngSha256:await hash(await png.arrayBuffer())};
      let pngSaved=false;
      try{
        const imageResponse=await fetch('/__video-evidence/'+localEvidence.png,{method:'POST',headers:{'Content-Type':'image/png'},body:png});
        assert(imageResponse.ok,`Rendu PNG local non enregistré (${imageResponse.status}).`);pngSaved=true;
        const persisted={...report,localEvidence},reportResponse=await fetch('/__video-evidence/'+localEvidence.json,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(persisted,null,2)});
        assert(reportResponse.ok,`Mesures JSON locales non enregistrées (${reportResponse.status}).`);finalReport=persisted;
      }catch(error){saveError=error instanceof Error?error.message:String(error);finalReport={...report,localEvidence:{...localEvidence,complete:false,pngSaved,error:saveError}};}
    }
    result.textContent=JSON.stringify(finalReport,null,2);download(new Blob([JSON.stringify(finalReport,null,2)],{type:'application/json'}),'ae-logo-reference-1780.json','Télécharger les mesures');
    download(png,'ae-logo-reference-current-1780.png','Télécharger le rendu complet');
    status.textContent=saveError?`Comparaison mesurée ; enregistrement local incomplet : ${saveError}`:
      'Comparaison mesurée — source 1780 / sortie 38 / logo 10. '+(location.origin==='http://127.0.0.1:5192'?'JSON et PNG enregistrés localement. ':'')+'Aucun verdict de fidélité déduit des écarts.';
  }catch(error){status.textContent=`Comparaison interrompue : ${error instanceof Error?error.message:String(error)}`;result.textContent=JSON.stringify({status:'blocked',error:String(error),...(error instanceof NativePlacementMismatchError?{placementDifferences:error.differences,rendererNormalizations:error.rendererNormalizations}:{})},null,2);}
  finally{raster?.dispose();run.disabled=false;}
};
