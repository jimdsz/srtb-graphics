import {templateDefaults} from '../src/studio/domain';
import {catalogueCompositions,COMPOSITION_COUNT,assertCompositionCoverage} from './catalogue-matrix';
import type {BroadcastTemplate,ProjectData} from '../src/studio/domain';
import {dimensions,simpleBaDefaults} from '../src/studio/presentation';
import {prepareGraphic} from '../src/studio/video/engine';
import type {LegacyGraphic,PreparedGraphic} from '../src/studio/video/engine';
import type {TextBox} from '../src/studio/typography-engine';
import {positionText} from '../src/studio/typography-position';
import {attachSocialPreview} from '../src/studio/social-preview';
import {inspectPreview} from '../src/studio/preview-timeline';

const IMAGE='/library/v1.7.0/BTV_Ce_Soir/lib/media/programme.jpg';
const RECT_EPSILON=.05;
// Two independently loaded native scenes can differ by a rounding unit. This
// bound cannot hide a missing one-pixel text movement (also checked separately).
const PIXEL_MAX=2,PIXEL_MEAN=.01;
type Controller={boxes():TextBox[];nudge(field:string,x:number,y:number):void};

function fixture(template:BroadcastTemplate,format:string):ProjectData{
  let data=templateDefaults(template);
  if(template.id==='BTV_BA_1P')data=simpleBaDefaults(data);
  data={...data,_studio_format:format,_studio_typography:'{}',_out_mode:'manual',_out_duration_seconds:28};
  for(const key of Object.keys(data)){
    if(/_audio.*enabled$/.test(key))data[key]=false;
    if(/^_media_.+_sequence$/.test(key))data[key]='[]';
    if(/^_media_.+_url$/.test(key)&&data[key]){
      const prefix=key.slice(0,-4);
      data[key]=IMAGE;
      if(prefix+'_start_seconds' in data)data[prefix+'_start_seconds']=0;
      if(prefix+'_end_seconds' in data)data[prefix+'_end_seconds']=30;
      if(prefix+'_rate' in data)data[prefix+'_rate']=1;
    }
  }
  if(template.id==='BTV_Passerelle_Replay')data._replay_url='https://srtb.bj'; // QR data only; never fetched.
  if(template.id==='BTV_Relais_Antenne')data._next_time='20H30';
  return data;
}

function ensure(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const near=(actual:number,expected:number,label:string)=>ensure(Math.abs(actual-expected)<=RECT_EPSILON,`${label} : ${actual}, attendu ${expected} ± ${RECT_EPSILON} px.`);
const copyBoxes=(controller:Controller)=>controller.boxes().map(box=>({...box}));
function chooseField(boxes:TextBox[],template:BroadcastTemplate){
  const visible=boxes.filter(b=>b.width>0&&b.height>0&&b.x<1&&b.y<1&&b.x+b.width>0&&b.y+b.height>0);
  ensure(visible.length,'Aucun bloc natif visible et sélectionnable.');
  const preferred=template.id==='BTV_Relais_Antenne'?['_next_time','_next_title']:['_titre_ligne_1','_p1_titre_ligne_1','_title','_heading'];
  return preferred.map(field=>visible.find(b=>b.field===field)).find(Boolean)?.field||visible[0].field;
}
function verifyBoxes(before:TextBox[],after:TextBox[],field:string,width:number,height:number){
  ensure(after.length===before.length,'Le déplacement a changé les blocs visibles.');
  const movements=[];
  for(let index=0;index<before.length;index++){
    const a=before[index],b=after[index];ensure(a.field===b.field,'Ordre des blocs natifs modifié.');
    const dx=(b.x-a.x)*width,dy=(b.y-a.y)*height,dw=(b.width-a.width)*width,dh=(b.height-a.height)*height;
    near(dx,a.field===field?1:0,a.field+' déplacement X');near(dy,0,a.field+' déplacement Y');
    near(dw,0,a.field+' largeur');near(dh,0,a.field+' hauteur');
    if(a.field===field)movements.push({dx,dy,dw,dh});
  }
  return movements;
}

function glyphNodes(graphic:LegacyGraphic){
  const nodes:Element[]=[],animation=graphic.state?.animation;
  if(animation){
    const walk=(container:any)=>{for(const element of container?.elements||[]){if(!element)continue;if(element.data?.ty===5&&element.layerElement instanceof Element)nodes.push(element.layerElement);walk(element);}};
    walk(animation.renderer);
  }else nodes.push(...graphic.scene.root.querySelectorAll('.fit'));
  ensure(nodes.length,'Aucun conteneur de glyphes natifs identifié.');return nodes;
}
function nativeMarkup(node:Element){
  const clone=node.cloneNode(true) as Element;
  for(const item of [clone,...clone.querySelectorAll('*')])if(item instanceof HTMLElement||item instanceof SVGElement){
    item.style.removeProperty('translate');
    if(item.dataset.studioInlineText==='true'){item.style.removeProperty('left');item.style.removeProperty('top');}
    if(!item.getAttribute('style'))item.removeAttribute('style');
  }
  return clone.outerHTML;
}
function glyphTrace(graphic:LegacyGraphic){
  return glyphNodes(graphic).map(node=>({node,connected:node.isConnected,parent:node.parentNode,children:[...node.childNodes],markup:nativeMarkup(node)}));
}
function verifyGlyphTrace(graphic:LegacyGraphic,trace:ReturnType<typeof glyphTrace>){
  // Lottie keeps inactive precompositions in its renderer graph without
  // attaching every layer to the document. Their initial state is legitimate;
  // changing graph membership, parent, connection state or children is not.
  const current=glyphNodes(graphic),connectedBefore=trace.filter(item=>item.connected).length,connectedAfter=current.filter(node=>node.isConnected).length;
  const counts=` (${connectedBefore}/${trace.length} connectés avant, ${connectedAfter}/${current.length} après)`;
  ensure(current.length===trace.length,'Nombre de conteneurs natifs modifié'+counts);
  for(const [index,{node,connected,parent,children,markup}] of trace.entries()){
    ensure(current[index]===node,'Identité ou ordre du graphe natif modifié au conteneur '+index+counts);
    ensure(node.isConnected===connected,'État de connexion natif modifié au conteneur '+index+counts);
    ensure(node.parentNode===parent,'Parent natif modifié au conteneur '+index+counts);
    ensure(children.length===node.childNodes.length&&children.every((child,index)=>child===node.childNodes[index]),'Les enfants/glyphes natifs ont été recréés.');
    ensure(markup===nativeMarkup(node),'Le déplacement a modifié les tracés, le texte, la police ou la mise en page native.');
  }
  return {connectedBefore,connectedAfter,graphContainers:current.length};
}
async function sha256(value:string){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');}

function canvasTrace(canvas:HTMLCanvasElement){
  const ctx=canvas.getContext('2d')!,native=ctx.fillText;
  let glyphs:string[]=[];
  ctx.fillText=function(text:string,x:number,y:number,maxWidth?:number){
    for(const character of text)glyphs.push(JSON.stringify([character,this.font,this.textBaseline,this.textAlign,this.letterSpacing]));
    if(maxWidth===undefined)native.call(this,text,x,y);else native.call(this,text,x,y,maxWidth);
  };
  return {reset:()=>{glyphs=[];},value:()=>glyphs.join('\n'),dispose:()=>{ctx.fillText=native;}};
}
function pixels(canvas:HTMLCanvasElement){return canvas.getContext('2d',{willReadFrequently:true})!.getImageData(0,0,canvas.width,canvas.height).data;}
function pixelDifference(a:Uint8ClampedArray,b:Uint8ClampedArray,width:number,boxes?:TextBox[]){
  ensure(a.length===b.length,'Dimensions du rendu différentes.');
  const height=a.length/(width*4),regions=boxes?.map(box=>({left:Math.max(0,Math.floor(box.x*width)-4),right:Math.min(width,Math.ceil((box.x+box.width)*width)+5),top:Math.max(0,Math.floor(box.y*height)-4),bottom:Math.min(height,Math.ceil((box.y+box.height)*height)+4)}));
  let max=0,total=0,changed=0,channels=0;
  for(let index=0;index<a.length;index+=4){
    const pixel=index/4,x=pixel%width,y=Math.floor(pixel/width);
    if(regions&&!regions.some(r=>x>=r.left&&x<r.right&&y>=r.top&&y<r.bottom))continue;
    let changedPixel=false;
    for(let channel=0;channel<4;channel++){const difference=Math.abs(a[index+channel]-b[index+channel]);max=Math.max(max,difference);total+=difference;channels++;changedPixel ||= difference>0;}
    if(changedPixel)changed++;
  }
  return {max,mean:channels?total/channels:0,changedPixels:changed,comparedPixels:channels/4};
}
function verifyParity(diff:ReturnType<typeof pixelDifference>){ensure(diff.max<=PIXEL_MAX&&diff.mean<=PIXEL_MEAN,'Parité aperçu/projet rechargé différente : '+JSON.stringify(diff));}

/** Read-only visual qualification of every catalogue template and composition.
 * It creates isolated local scenes, never saves a project, uploads or encodes.
 * This compares native displacement with a fresh export scene, not an AE source
 * reference. Geometry, native glyph preservation and real pixel movement are
 * separate assertions, so two equally unchanged renderers cannot pass. */
export async function nativePositionContracts(status:(message:string)=>void,signal:AbortSignal){
  const records=[];
  for(const {template,format} of catalogueCompositions()){
    signal.throwIfAborted();status(`Position native · ${template.id} · ${format} · ${records.length+1}/${COMPOSITION_COUNT}`);
    const data=fixture(template,format),original=JSON.stringify(data),seconds=template.id.startsWith('BTV_BA')?8:3,frame=Math.round(seconds*25),size=dimensions(data);
    let live:PreparedGraphic|undefined,reloaded:PreparedGraphic|undefined,traceCanvas:ReturnType<typeof canvasTrace>|undefined;
    try{
      live=await prepareGraphic(template,data,28,false,signal);
      let controller:Controller,base:Uint8ClampedArray,liveCanvas:HTMLCanvasElement|undefined,domTrace:ReturnType<typeof glyphTrace>|undefined,initialGlyphs='';
      if(format==='tv'){
        base=pixels(await live.frame(frame,null));controller=live.graphic.__typography;
        ensure(controller&&controller.boxes,'Contrôleur de texte TV absent.');domTrace=glyphTrace(live.graphic);
        ensure(!live.graphic.shadowRoot!.querySelector('[data-studio-text-original]'),'Un texte natif a été masqué au chargement.');
      }else{
        await attachSocialPreview(live.graphic,template,data,signal);
        await inspectPreview(live.graphic,template,data,seconds);
        liveCanvas=[...live.graphic.parentElement!.children].find(node=>node instanceof HTMLCanvasElement) as HTMLCanvasElement|undefined;
        ensure(liveCanvas,'Canvas social absent.');traceCanvas=canvasTrace(liveCanvas);
        live.graphic.__socialPreview.refresh();initialGlyphs=traceCanvas.value();ensure(initialGlyphs,'Aucun glyphe social dessiné.');
        base=pixels(liveCanvas);controller=live.graphic.__socialTypography;
      }
      const before=copyBoxes(controller),field=chooseField(before,template);
      traceCanvas?.reset();controller.nudge(field,1,0);
      // Nudge must acknowledge the new still frame synchronously. Waiting for
      // RAF (or forcing refresh here) would hide the background-tab regression.
      const after=copyBoxes(controller),movements=verifyBoxes(before,after,field,size.width,size.height);
      let connections:ReturnType<typeof verifyGlyphTrace>|undefined;
      if(domTrace){connections=verifyGlyphTrace(live.graphic,domTrace);ensure(!live.graphic.shadowRoot!.querySelector('[data-studio-text-original]'),'Un déplacement a masqué les glyphes natifs.');}
      else ensure(initialGlyphs===traceCanvas!.value(),'Le déplacement social a modifié les caractères, leur police, leur taille ou leur ordre.');
      const shifted=pixels(format==='tv'?await live.frame(frame,null):liveCanvas!);
      const changed=pixelDifference(base,shifted,size.width,before.filter(box=>box.field===field));
      ensure(changed.changedPixels>0,'Le rectangle bouge mais aucun pixel du texte ne bouge dans le rendu.');
      signal.throwIfAborted();
      reloaded=await prepareGraphic(template,positionText(data,field,1,0),28,false,signal);
      const exported=pixels(await reloaded.frame(frame,null));
      const parity=pixelDifference(shifted,exported,size.width),textParity=pixelDifference(shifted,exported,size.width,after.filter(box=>box.field===field));
      verifyParity(parity);verifyParity(textParity);
      ensure(JSON.stringify(data)===original,'Le projet de départ a été modifié.');
      records.push({id:template.id,format,seconds,field,visibleFields:[...new Set(before.map(box=>box.field))],movements,nativeGlyphs:{kind:domTrace?'DOM paths/text':'canvas text runs',containers:domTrace?.length,...connections,sha256:await sha256(domTrace?domTrace.map(item=>item.markup).join('\n'):initialGlyphs),unchanged:true},changed,parity,textParity,tolerances:{rectanglePixels:RECT_EPSILON,maxChannelDelta:PIXEL_MAX,meanChannelDelta:PIXEL_MEAN},result:'PASS'});
    }catch(error){signal.throwIfAborted();throw Error(`${template.id} · ${format} · ${error instanceof Error?error.message:String(error)}`);}
    finally{traceCanvas?.dispose();await reloaded?.dispose();await live?.dispose();}
  }
  assertCompositionCoverage(records);return records;
}
