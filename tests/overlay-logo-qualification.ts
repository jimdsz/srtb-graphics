import {templateDefaults} from '../src/studio/domain';
import {catalogueCompositions,COMPOSITION_COUNT,MODEL_COUNT,assertCompositionCoverage} from './catalogue-matrix';
import type {BroadcastTemplate,ProjectData} from '../src/studio/domain';
import {prepareGraphic} from '../src/studio/video/engine';
import type {LegacyGraphic} from '../src/studio/video/engine';
import {overlayLogoGeometry} from '../src/studio/logo-model';
import {engineData} from '../src/studio/presentation';
import {studioEngineModule} from '../src/studio/text-editing';
import {installBALoader} from '../src/studio/preview-resources';
import {installGraphicCompatibility} from '../src/studio/graphic-compatibility';
import {installBAMediaReadiness} from '../src/studio/media-readiness';
import {FrameRaster} from '../src/studio/video/raster';
import typography from '../src/studio/typography-runtime.generated.json';
import {stripSupplementalVoice} from '../src/studio/supplemental-voice';

const status=document.querySelector('#status')!,result=document.querySelector('#result')!,gallery=document.querySelector('#gallery')!;
const run=document.querySelector<HTMLButtonElement>('#run')!,portableButton=document.querySelector<HTMLButtonElement>('#portable')!,cancel=document.querySelector<HTMLButtonElement>('#cancel')!;
run.textContent=`Vérifier les ${COMPOSITION_COUNT} compositions`;portableButton.textContent=`Vérifier les ${MODEL_COUNT} modules HTML`;
const check=(value:unknown,message:string)=>{if(!value)throw Error(message);};
let active:AbortController|undefined;
cancel.onclick=()=>active?.abort();
function bitmap(width:number,height:number,colour:string){const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d')!;ctx.fillStyle=colour;ctx.fillRect(0,0,width,height);return canvas.toDataURL('image/png');}
const logo=bitmap(300,100,'#ff00ff'),programme=bitmap(960,540,'#213b52');
function fixture(template:BroadcastTemplate,format:string):ProjectData{
  const data:ProjectData={...templateDefaults(template),_studio_format:format,_out_mode:'duration',_out_duration_seconds:30,_studio_overlay_logo_enabled:true,_studio_overlay_logo_url:logo,_studio_overlay_logo_motion:'slide',_studio_overlay_logo_plate:'white',_studio_overlay_logo_delay:.4};
  if(template.id==='BTV_Passerelle_Replay')data._replay_url='https://srtb.bj';
  for(const key of Object.keys(data)){
    if(/audio.*enabled$/.test(key))data[key]=false;
    if(/^_media_.*_url$/.test(key)){const stem=key.slice(0,-4);Object.assign(data,{[key]:{url:programme,name:'recette.png',mimeType:'image/png'},[stem+'_start_seconds']:0,[stem+'_end_seconds']:40,[stem+'_sequence']:'[]',[stem+'_loop']:true});}
  }
  return data;
}
function sample(canvas:HTMLCanvasElement,data:ProjectData){const size=overlayLogoGeometry(data,canvas.width,canvas.height,300,100).image;return [...canvas.getContext('2d')!.getImageData(Math.floor(size.x+size.w/2),Math.floor(size.y+size.h/2),1,1).data];}
function magenta(pixel:number[]){return pixel[0]>245&&pixel[1]<10&&pixel[2]>245&&pixel[3]>245;}
function show(canvas:HTMLCanvasElement,label:string){const figure=document.createElement('figure'),copy=document.createElement('canvas'),caption=document.createElement('figcaption');copy.width=canvas.width;copy.height=canvas.height;copy.getContext('2d')!.drawImage(canvas,0,0);caption.textContent=label;figure.append(copy,caption);gallery.append(figure);}
async function execute(portable:boolean){
  if(active)return;active=new AbortController();run.disabled=portableButton.disabled=true;cancel.disabled=false;gallery.replaceChildren();const records:unknown[]=[];result.textContent='';
  const signal=active.signal;let runtimeURL='';
  try{
    let runtime:{installTypography:(g:LegacyGraphic,t:BroadcastTemplate,d:ProjectData)=>unknown}|undefined;
    if(portable){runtimeURL=URL.createObjectURL(new Blob([typography.code],{type:'text/javascript'}));runtime=await import(/* @vite-ignore */runtimeURL);}
    for(const {template,format} of catalogueCompositions(portable?['tv']:undefined)){
      signal.throwIfAborted();status.textContent=`Vérification ${template.name} · ${format}${portable?' · HTML embarqué':''}`;
      const data=fixture(template,format),started=performance.now();
      if(!portable){
        const prepared=await prepareGraphic(template,data,30,false,signal);
        try{
          const initial=sample(await prepared.frame(0,null),data);check(!magenta(initial),'Logo affiché avant son délai.');
          const canvas=await prepared.frame(50,null),pixel=sample(canvas,data);check(magenta(pixel),`Logo absent du vrai rendu : ${pixel.join(',')}`);show(canvas,template.name+' · '+format);
          const tail=sample(await prepared.frame(prepared.timeline.frames-1,null),data);check(!magenta(tail),'Logo restant sur la dernière image.');
          if(format==='tv')check(prepared.graphic.shadowRoot?.querySelector<SVGElement>('[data-studio-overlay-logo]')?.style.visibility==='hidden','Surcouche TV non transparente en fin.');
          records.push({template:template.id,format,renderer:'export-frame',initial,pixel,tail,terminalHold:prepared.timeline.terminalHoldFrames,elapsedMs:Math.round(performance.now()-started),result:'PASS'});
        }finally{await prepared.dispose();}
      }else{
        const mod=await import(/* @vite-ignore */studioEngineModule(template)),tag='qa-logo-portable-'+template.id.toLowerCase().replaceAll('_','-');if(!customElements.get(tag))customElements.define(tag,class extends mod.default{});
        const g=document.createElement(tag) as LegacyGraphic,host=document.createElement('div');host.style.cssText='position:fixed;left:-20000px;width:1920px;height:1080px';g.style.cssText='display:block;width:1920px;height:1080px;position:relative';host.append(g);document.body.append(host);
        installBALoader(g,template,()=>{});installGraphicCompatibility(g,{...template,module:new URL(template.module,location.href).href});runtime!.installTypography(g,template,data);await installBAMediaReadiness(template);
        let raster:FrameRaster|undefined;const abort=()=>void g.dispose();signal.addEventListener('abort',abort,{once:true});
        try{
          const loaded=await g.load({renderType:'realtime',previewMuted:true,data:stripSupplementalVoice(template,engineData(data,true))});check(!loaded?.statusCode||loaded.statusCode<400,loaded?.statusMessage||'Chargement refusé');
          await g.goToTime({seconds:2});g.__studioLogo.refresh({seconds:2,end:31,visible:true});
          raster=new FrameRaster(g.shadowRoot!,new URL(template.module,location.href).href,signal);await raster.prepare();const canvas=await raster.draw(null),pixel=sample(canvas,data);check(magenta(pixel),'Le module HTML ne restitue pas le logo.');show(canvas,template.name+' · HTML embarqué');
          const node=g.shadowRoot?.querySelector('[data-studio-overlay-logo]'),updated=await g.updateAction({_studio_overlay_logo_anchor:'bottom-center'});check(!updated?.statusCode||updated.statusCode<400,updated?.statusMessage||'Mise à jour refusée');g.__studioLogo.refresh({seconds:2,end:31,visible:true});check(node===g.shadowRoot?.querySelector('[data-studio-overlay-logo]'),'La mise à jour a perdu la surcouche.');
          await g.stopAction({skipAnimation:true});check((node as SVGElement).style.visibility==='hidden','Logo HTML visible après Effacer');
          records.push({template:template.id,format,renderer:'portable-html',pixel,update:'PASS',clear:'PASS',elapsedMs:Math.round(performance.now()-started),result:'PASS'});
        }finally{signal.removeEventListener('abort',abort);raster?.dispose();await g.dispose();host.remove();}
      }
      result.textContent=JSON.stringify(records,null,2);
    }
    assertCompositionCoverage((records as {template:string;format:string}[]).map(record=>({id:record.template,format:record.format})),portable?['tv']:undefined);
    status.textContent=`PASS · ${records.length} ${portable?'modules HTML':'compositions TV et sociales'} · logo visible, différé et absent en fin.`;
  }catch(error){status.textContent=`ÉCHEC · ${error instanceof Error?error.message:String(error)}`;result.textContent=JSON.stringify({records,error:String(error)},null,2);}
  finally{if(runtimeURL)URL.revokeObjectURL(runtimeURL);active=undefined;run.disabled=portableButton.disabled=false;cancel.disabled=true;}
}
run.onclick=()=>void execute(false);portableButton.onclick=()=>void execute(true);
