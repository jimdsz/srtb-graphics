import type {BroadcastTemplate,ProjectData} from '../domain';
import {graphicTime,makeTimeline,TIMINGS} from './timeline';
import type {VideoTimeline} from './timeline';
import {FrameRaster} from './raster';
import {VideoFrames} from './decode';
import {installGraphicCompatibility} from '../graphic-compatibility';
import {engineData,presentation,locateClip} from '../presentation';
import {SocialRenderer,prepareSocialAssets,socialTrackTimes} from '../social-renderer';
import {tracksOf} from '../media-tracks';
import {installBAMediaReadiness} from '../media-readiness';
import {installSocialScene} from '../social-scene';
import {studioEngineModule} from '../text-editing';
import {installTypography} from '../typography-engine';
import {loadSupplementalVoice,loadSupplementalSignature,stripSupplementalVoice} from '../supplemental-voice';
import type {ExportProfile} from './export-profile';
import {installAEMediaTrim} from '../ae-media-trim';
import {seekSignatureMedia} from './signature-media';
import {ceSoirBackground} from '../ce-soir-background';
export {tracksOf} from '../media-tracks';

// A deliberately isolated bridge to the frozen JavaScript engines. Private fields
// are version-pinned to library 1.7.0; do not silently apply to future engines.
export interface LegacyGraphic extends HTMLElement {
  [key:string]:any;
  _build?:(...args:any[])=>Promise<any>;
  load(args:unknown):Promise<any>;goToTime(args:{seconds:number}):Promise<any>;dispose():Promise<any>;
}
export interface Clip {source?:string;url?:string;start:number;end:number;length:number;type:string;node?:HTMLMediaElement|HTMLImageElement|null}
export interface Track {clips:Clip[];loop:boolean;rate?:number;length?:number;activeStart?:number;activeEnd?:number;audio?:boolean|{enabled:boolean;volume:number};volume?:number;seek?:(time:number)=>Promise<void>}
export async function prepareGraphic(template:BroadcastTemplate,data:ProjectData,manualOut:number,removeBackground:boolean,signal:AbortSignal,profile?:ExportProfile){
  if(template.id==='BTV_Passerelle_Replay'&&!String(data._replay_url||'').trim())throw Error('Renseignez l’adresse du replay dans les réglages avant d’exporter son QR code.');
  if(template.libraryVersion!=='1.7.0'||!TIMINGS[template.id])throw Error('Cette version du moteur doit recevoir son adaptateur de rendu.');
  const module=await import(/* @vite-ignore */studioEngineModule(template)),tag=`render-${template.id.toLowerCase().replaceAll('_','-')}-${template.version.replaceAll('.','-')}`;
  await installBAMediaReadiness(template);
  if(!customElements.get(tag))customElements.define(tag,class extends module.default{});
  const graphic=document.createElement(tag) as LegacyGraphic,container=document.createElement('div');
  installAEMediaTrim(graphic,template);
  if(presentation(data)==='tv')installGraphicCompatibility(graphic,{...template,module:new URL(template.module,document.baseURI).href});
  else installSocialScene(graphic,template);
  installTypography(graphic,template,data);
  container.setAttribute('aria-hidden','true');container.style.cssText='position:fixed;left:-20000px;top:0;width:1920px;height:1080px;pointer-events:none;overflow:hidden';
  graphic.style.cssText='position:relative;display:block;width:1920px;height:1080px';container.append(graphic);document.body.append(container);
  let raster:FrameRaster|undefined,social:SocialRenderer|undefined;const decoder=new VideoFrames(signal,profile),videoTimes=new Map<HTMLVideoElement,number>(),videoIds=new Map<HTMLVideoElement,string>();
  const abort=()=>{void graphic.dispose();};signal.addEventListener('abort',abort,{once:true});
  async function dispose(){signal.removeEventListener('abort',abort);raster?.dispose();social?.dispose();await decoder.dispose();await graphic.dispose();container.remove();}
  try{
    // Never mutate the saved project or the live preview.
    const settings=structuredClone(data);
    const supplementalVoice=await loadSupplementalVoice(template,settings,signal);
    const supplementalSignature=await loadSupplementalSignature(template,settings,signal);
    const loaded=await graphic.load({renderType:'realtime',previewMuted:true,data:stripSupplementalVoice(template,engineData(settings,true))});
    if(loaded?.statusCode>=400)throw Error(loaded.statusMessage);
    signal.throwIfAborted();
    const tracks=tracksOf(graphic),lengths=Object.fromEntries(Object.entries(tracks).map(([kind,t])=>[kind,t.length??t.clips.reduce((n,c)=>n+c.length,0)/(t.rate||1)]));
    const timeline=makeTimeline(template.id,settings,lengths,manualOut);
    if(presentation(settings)!=='tv'){
      social=new SocialRenderer(template,settings,await prepareSocialAssets(template,settings,signal));
      const frame=async(index:number,background:string|null)=>{
        signal.throwIfAborted();const seconds=index/25,pictures:Record<string,CanvasImageSource>={};
        for(const [kind,time]of Object.entries(socialTrackTimes(template.id,seconds,timeline.outAt))){
          if(removeBackground&&(template.id==='BTV_BA_1P'||kind==='background'||template.id==='BTV_BA_TDS_SUIVI_DE'))continue;
          const track=tracks[kind];if(!track)continue;const at=locateClip(track.clips,time,track.loop,track.rate);if(!at)continue;
          const clip=track.clips[at.index];
          if(clip.type==='video')pictures[kind]=await decoder.frame(kind+':'+at.index,clip.source||clip.url||clip.node!.src,at.time);
          else{const node=clip.node||await graphic.media?.ensure(track,at.index);if(node instanceof HTMLImageElement){await node.decode();pictures[kind]=node;}}
        }
        return social!.frame(seconds,timeline,pictures,background,removeBackground,tracks);
      };
      // Preflight every layout/state before encoding or creating an output file.
      for(const time of [0,3,10,14,Math.max(0,timeline.outAt-.04),timeline.outAt+2,timeline.duration-.04])social.frame(Math.min(time,timeline.duration-.04),timeline,{},null,removeBackground);
      return {graphic,tracks,timeline,data:settings,supplementalVoice,supplementalSignature,frame,dispose,timings:{clone:0,svg:0,draw:0,png:0}};
    }
    if(template.id!=='BTV_BA_1P'&&template.id!=='BTV_Renvoi')for(const [kind,track] of Object.entries(tracks)){
      if(kind==='audio')continue;
      track.clips.forEach((clip,index)=>{if(clip.node instanceof HTMLVideoElement)videoIds.set(clip.node,kind+':'+index);});
      const t=track as Track&Partial<{pause():void;show(index:number):void;finished:boolean;imageElapsed:number}>;
      // Legacy media tracks expose pause/show and need the deterministic adapter below.
      // New AE/Lottie tracks already provide their own seek implementation; replacing it
      // would make Event and Semainier call methods they deliberately do not implement.
      if(typeof t.pause!=='function'||typeof t.show!=='function')continue;
      const pause=t.pause.bind(t),show=t.show.bind(t);
      track.seek=async(seconds:number)=>{
        pause();if(!t.clips.length)return;
        const total=t.clips.reduce((sum,c)=>sum+c.length,0);let position=Math.max(0,seconds);t.finished=!t.loop&&position>=total;
        if(Number.isFinite(total))position=t.loop?position%total:Math.min(position,Math.max(0,total-.04));
        let index=0;while(index<t.clips.length-1&&position>=t.clips[index].length)position-=t.clips[index++].length;
        const clip=t.clips[index];if(clip.node instanceof HTMLVideoElement)videoTimes.set(clip.node,clip.start+position);
        t.imageElapsed=position;show(index);
      };
    }
    // Audio is mixed offline. Seeking DOM audio on every frame only adds latency.
    if(graphic.sound?.seek)graphic.sound.seek=async()=>{};
    if(graphic._seekAudio)graphic._seekAudio=async()=>{};
    const baNodes=new Map<string,HTMLCanvasElement|HTMLImageElement>(),baColors=new Map(Object.entries(tracks).map(([k,t])=>[k,(t as any).colorSpace]));
    if(template.id==='BTV_BA_1P')graphic.media.node=(kind:string)=>baNodes.get(kind);
    if(!graphic.shadowRoot)throw Error('Scène graphique inaccessible au rendu.');const root:ShadowRoot=graphic.shadowRoot;
    const canvasCopies=new Map<HTMLCanvasElement,HTMLCanvasElement>();
    if(template.id==='BTV_BA_1P')for(const group of Object.values(graphic.scene.canvases.targets) as HTMLCanvasElement[][])for(const c of group)canvasCopies.set(c,group[0]);
    raster=new FrameRaster(root,new URL(template.module,location.href).href,signal,node=>decoder.frame(videoIds.get(node)||node.src,node.src,videoTimes.get(node)??0),node=>canvasCopies.get(node)||node,profile);await raster.prepare();
    if(!removeBackground)raster.setUnderlay(template.id==='BTV_PopUp'?graphic.media.backgroundSlot:template.id==='BTV_BA_TDS'?graphic.mediaSlot:template.id==='BTV_BA_TDS_SUIVI_DE'?graphic.media.root:undefined);
    let lastGraphic=-1;
    let fastBody:boolean|undefined;const composite=document.createElement('canvas');composite.width=1920;composite.height=1080;
    const compositeContext=composite.getContext('2d',{willReadFrequently:true})!;
    async function frame(index:number,background:string|null){
      signal.throwIfAborted();const seconds=index/25,sourceTime=graphicTime(timeline,seconds),id=template.id;
      profile?.frame(index,sourceTime,seconds>=timeline.outAt?'out':sourceTime<10?'intro':'body');const started=profile?.now();try{
      if(timeline.timing.kind==='signature'){
        // Signature tracks expose a local media clock. Native TV keeps the AE
        // activation offsets, while social compositions use socialTrackTimes.
        await seekSignatureMedia(graphic,tracks,seconds,timeline.outAt);
        graphic.stage.style.visibility='visible';graphic._draw(seconds,false);
      }else if(id==='BTV_BA_1P'){
        // The hold frame and the programme video use different clocks.
        const positions:{kind:string;time:number;active:boolean}[]=[{kind:'intro',time:seconds,active:sourceTime<5.6},{kind:'body',time:Math.max(0,seconds-4.36),active:sourceTime>=4.36&&sourceTime<66.16},{kind:'pack',time:Math.max(0,seconds-timeline.outAt),active:sourceTime>=64.8&&sourceTime<71.24}];
        if(!removeBackground)for(const {kind,time,active} of positions){
          if(!active)continue;const track=graphic.media.tracks[kind],located=graphic.media.locate(track,time),clip=track.clips[located.index];
          if(clip.type==='video'){
            const decoded=await decoder.frame(kind+':'+located.index,clip.url,located.time);
            const copied=profile?.now();
            let canvas=baNodes.get(kind);if(!(canvas instanceof HTMLCanvasElement)){canvas=document.createElement('canvas');baNodes.set(kind,canvas);}
            if(canvas.width!==decoded.width||canvas.height!==decoded.height){canvas.width=decoded.width;canvas.height=decoded.height;}
            Object.assign(canvas,{videoWidth:canvas.width,videoHeight:canvas.height});canvas.getContext('2d')!.drawImage(decoded,0,0);
            track.colorSpace=baColors.get(kind)==='auto'?'rec709_gamma24':baColors.get(kind);
            if(copied!==undefined)profile?.record('engine.mediaCopy',copied);
          }else{baNodes.set(kind,await graphic.media.ensure(track,located.index));track.colorSpace=baColors.get(kind);}
        }
        const sceneStarted=profile?.now();graphic.state.currentFrame=Math.round(sourceTime*25);graphic.scene.animation.goToAndStop(graphic.state.currentFrame,true);graphic.scene.canvases.draw();graphic.scene.container.style.visibility='visible';
        if(sceneStarted!==undefined)profile?.record('engine.scene',sceneStarted);
      }else{
        if(sourceTime!==lastGraphic){await graphic.goToTime({seconds:sourceTime});lastGraphic=sourceTime;}
        if(id==='BTV_PopUp'){
          await tracks.background.seek?.(seconds);await tracks.popup.seek?.(Math.max(0,seconds-.64));
        }else if(id==='BTV_BA_TDS')await tracks.background.seek?.(seconds);
        else if(id==='BTV_BA_TDS_SUIVI_DE'){await tracks.programme_1.seek?.(Math.min(seconds,15.32));await tracks.programme_2.seek?.(Math.max(0,seconds-13.8));}
      }
      if(removeBackground){
        if(id==='BTV_PopUp')graphic.tracks.background.slot.style.display='none';
        if(id==='BTV_BA_TDS')graphic.mediaSlot.style.display='none';
        if(id==='BTV_BA_TDS_SUIVI_DE')graphic.media.root.style.display='none';
        if(id==='BTV_Renvoi'&&graphic.mediaLayer?.layerElement)graphic.mediaLayer.layerElement.style.display='none';
        if(id==='BTV_BA_1P')for(const group of Object.values(graphic.scene.canvases.targets) as HTMLCanvasElement[][])for(const c of group)c.style.visibility='hidden';
        if(id==='BTV_Ce_Soir'){graphic.scene.root.style.background=ceSoirBackground(settings)||'transparent';root.querySelector<HTMLElement>('.background')!.style.display='none';}
      }
      const errors=[...(graphic.errors||[]),...(graphic.state?.errors||[]),...(graphic.media?.errors||[])];
      if(errors.length)throw Error(String(errors.at(-1)));
      const decorated=profile?.now();graphic.__typography?.refresh();
      graphic.__studioLogo?.refresh({seconds,end:(timeline.frames-timeline.terminalHoldFrames)/25,visible:seconds<timeline.duration});
      if(decorated!==undefined)profile?.record('engine.decorate',decorated);
      // In the stable programme section the bitmap is a full-frame underlay.
      // Avoid PNG round-trips of a 1080p video for every SVG frame. Compare the
      // composite with the complete original renderer before enabling this path,
      // and recheck every second; unexpected layouts fail back to the original.
      if(id==='BTV_BA_1P'&&!removeBackground&&sourceTime>=10&&sourceTime<64.8&&(fastBody!==false||index%25===0)){
        const overlay=await raster!.draw(null,true);compositeContext.clearRect(0,0,1920,1080);
        if(background){compositeContext.fillStyle=background;compositeContext.fillRect(0,0,1920,1080);}
        const rect=graphic.getBoundingClientRect();
        for(const canvas of graphic.scene.canvases.targets.body as HTMLCanvasElement[]){
          let visible=true;for(let node:Element|null=canvas;node&&node!==graphic;node=node.parentElement){if((node as HTMLElement).style?.display==='none'||(node as HTMLElement).style?.visibility==='hidden'||node.getAttribute('opacity')==='0'){visible=false;break;}}
          if(!visible)continue;const matrix=(canvas.parentElement as unknown as SVGGraphicsElement).getScreenCTM();if(!matrix)continue;
          compositeContext.save();compositeContext.setTransform(matrix.a,matrix.b,matrix.c,matrix.d,matrix.e-rect.left,matrix.f-rect.top);compositeContext.drawImage(canvas,0,0);compositeContext.restore();
        }
        compositeContext.drawImage(overlay,0,0);
        if(fastBody!==true||index%25===0){
          const reference=await raster!.draw(background,false,true),comparison=profile?.now(),a=reference.getContext('2d')!.getImageData(0,0,1920,1080).data,b=compositeContext.getImageData(0,0,1920,1080).data;
          let error=0;for(let n=0;n<a.length;n++)error+=Math.abs(a[n]-b[n]);fastBody=error/a.length<.12;
          if(comparison!==undefined){profile?.record('engine.compare',comparison);profile?.count(fastBody?'body.accept':'body.reject');}
          if(!fastBody)return reference;
        }
        const output=raster!.canvas,ctx=output.getContext('2d')!;ctx.clearRect(0,0,1920,1080);ctx.drawImage(composite,0,0);return output;
      }
      return await raster!.draw(background);
      }finally{if(started!==undefined)profile?.record('frame.total',started);}
    }
    return {graphic,tracks,timeline,data:settings,supplementalVoice,supplementalSignature,frame,dispose,timings:raster.timings};
  }catch(error){await dispose();throw error;}
}
export type PreparedGraphic=Awaited<ReturnType<typeof prepareGraphic>>;
export type {VideoTimeline};
