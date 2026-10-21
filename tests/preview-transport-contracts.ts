import {catalogueCompositions,assertCompositionCoverage} from './catalogue-matrix';
import type {ProjectData} from '../src/studio/domain';
import type {LegacyGraphic} from '../src/studio/video/engine';
import {tracksOf} from '../src/studio/media-tracks';
import {installPreviewTransport} from '../src/studio/preview-transport';
import {previewTimeline} from '../src/studio/preview-timeline';
import {installGraphicCompatibility} from '../src/studio/graphic-compatibility';
import {installPreviewBackgrounds} from '../src/studio/preview-backgrounds';
import {installBALoader,previewSources} from '../src/studio/preview-resources';
import {installBAMediaReadiness} from '../src/studio/media-readiness';
import {installBAPreviewPlayback} from '../src/studio/ba-preview-playback';
import {installSocialScene} from '../src/studio/social-scene';
import {attachSocialPreview} from '../src/studio/social-preview';
import {installTypography} from '../src/studio/typography-engine';
import {studioEngineModule} from '../src/studio/text-editing';
import {engineData} from '../src/studio/presentation';
import {previewAudio} from '../src/studio/preview-audio';
import {SocialRenderer,socialTrackTimes} from '../src/studio/social-renderer';
import {graphicTime} from '../src/studio/video/timeline';
import {socialSignature} from '../src/studio/social-motion';
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
function assert(value:unknown,message:string){if(!value)throw Error(message);}
function media(g:LegacyGraphic){
  const nodes=new Set<HTMLMediaElement>();
  for(const track of Object.values(tracksOf(g)))for(const clip of track.clips)if(clip.node instanceof HTMLMediaElement)nodes.add(clip.node);
  for(const track of Object.values(g.sound||{}) as any[])if(track.node)nodes.add(track.node);
  if(g.audioBed)nodes.add(g.audioBed);
  return [...nodes].map(node=>({node,time:node.currentTime,paused:node.paused}));
}
function frame(g:LegacyGraphic){return g.state?.currentFrame??Math.floor(g.elapsed*25);}
function socialPixels(host:HTMLElement){const canvas=host.querySelector('canvas');if(!canvas)return '';const sample=document.createElement('canvas');sample.width=32;sample.height=32;const ctx=sample.getContext('2d')!;ctx.drawImage(canvas,0,0,32,32);return sample.toDataURL();}

/** Real native engines, configured media/audio, glyph adapters and all catalogue
 * compositions. Run from the qualification page's operator button. */
export async function previewTransportContracts(dataFor:(id:string,format:string)=>ProjectData,save:(name:string,body:Blob|string)=>Promise<void>,status:(message:string)=>void,signal:AbortSignal){
  const records:{id:string;format:string;result:string;checks:Record<string,unknown>}[]=[];
  for(const {template,format} of catalogueCompositions()){
    const params=new URLSearchParams(location.search);if(params.get('transport-template')&&params.get('transport-template')!==template.id||params.get('transport-format')&&params.get('transport-format')!==format)continue;
    status('Pause / reprise : '+template.name+' · '+format);signal.throwIfAborted();
    const data:ProjectData={...dataFor(template.id,format),_out_mode:format==='portrait'?'manual':'duration',_out_duration_seconds:28};
    if('_audio_bed_enabled' in template.fields)data._audio_bed_enabled=true;
    if('_audio_enabled' in template.fields)Object.assign(data,{_audio_enabled:true,_audio_url:'/library/v1.7.0/BTV_BA_1P/sourceassets/BTV_BA1P%20-23LUFS.wav',_audio_loop:true});
    const module=await import(/* @vite-ignore */studioEngineModule(template)),tag='transport-'+template.id.toLowerCase().replaceAll('_','-');
    if(!customElements.get(tag))customElements.define(tag,class extends module.default{});
    const g=document.createElement(tag) as LegacyGraphic,host=document.createElement('div'),errors:string[]=[];
    host.style.cssText='position:fixed;left:-20000px;width:960px;height:540px';g.style.cssText='display:block;position:relative;width:960px;height:540px';host.append(g);document.body.append(host);
    let audio:Awaited<ReturnType<typeof previewAudio>>|undefined,transport:ReturnType<typeof installPreviewTransport>|undefined,audioTimer:ReturnType<typeof setInterval>|undefined;
    const controller=new AbortController(),abort=()=>controller.abort(signal.reason);signal.addEventListener('abort',abort,{once:true});
    const error=(event:Event)=>errors.push((event as CustomEvent).detail?.message||'Erreur moteur');g.addEventListener('broadcast-error',error);g.addEventListener('broadcast-media-error',error);
    try{
      audio=await previewAudio(g,template);audio.volume(0);await audio.unlock();
      installBALoader(g,template,()=>{});
      installBAPreviewPlayback(g,template);
      if(format==='tv'){installGraphicCompatibility(g,{...template,module:new URL(template.module,location.href).href});installPreviewBackgrounds(g,template,()=>{});}else installSocialScene(g,template);
      const source=previewSources(template,data);installTypography(g,template,source);await installBAMediaReadiness(template);
      const loaded=await g.load({renderType:'realtime',previewMuted:false,data:engineData(source,true)});assert(!(loaded?.statusCode>=400),loaded?.statusMessage);
      audio.sample();audioTimer=setInterval(()=>audio?.sample(),100);
      if(format!=='tv')await attachSocialPreview(g,template,source,controller.signal);
      transport=installPreviewTransport(g,template,()=>data,e=>errors.push(e.message));const tl=previewTimeline(g,template,data);
      const checks:Record<string,unknown>={};
      if(template.id==='BTV_BA_1P'&&format!=='tv'){
        const renderer=new SocialRenderer(template,data,{}),pictures=Object.fromEntries(['intro','body','pack'].map(kind=>[kind,document.createElement('canvas')])),selected:string[]=[];
        const picture=(renderer as any).picture.bind(renderer);(renderer as any).picture=(source:CanvasImageSource,...args:any[])=>{const key=Object.entries(pictures).find(([,node])=>node===source)?.[0];if(key)selected.push(key);return picture(source,...args);};
        renderer.frame(.6,{...tl,outAt:.4,duration:.4+tl.timing.out},pictures,null);renderer.dispose();const times=socialTrackTimes(template.id,.6,.4);
        const correct=selected.length===0&&socialSignature(template.id,.6,{outAt:.4,duration:.4+tl.timing.out})?.phase==='outro'&&Math.abs(times.body-.2)<.001&&Math.abs(times.pack-.2)<.001;
        checks.earlySocialOut={selected,times};if(!correct)await save('early-out-failure-'+Date.now()+'.json',JSON.stringify(checks.earlySocialOut,null,2));
        assert(correct,'OUT pendant IN doit montrer la signature sociale sans rush, avec les horloges audio conservées : '+JSON.stringify(checks.earlySocialOut));
      }
      async function frozen(label:string){
        const active=media(g).filter(item=>!item.paused);
        const canvas=host.querySelector('canvas'),ctx=canvas?.getContext('2d'),draw=ctx?.drawImage,paints:unknown[]=[];
        if(ctx&&draw)(ctx as any).drawImage=(...args:any[])=>{paints.push({time:performance.now(),position:transport!.snapshot()});return (draw as any).apply(ctx,args);};
        await transport!.pause();await wait(60);const a=transport!.snapshot(),f=frame(g),nodes=media(g),pixels=socialPixels(host);await wait(220);signal.throwIfAborted();const b=transport!.snapshot();
        if(ctx&&draw)ctx.drawImage=draw;
        assert(b.phase==='paused'&&!b.playing,label+' : la phase doit rester en pause');
        assert(Math.abs(a.seconds-b.seconds)<.001,label+' : le compteur avance en pause');
        assert(frame(g)===f,label+' : l’animation avance en pause');
        if(socialPixels(host)!==pixels)await save('transport-pause-difference-'+Date.now()+'.json',JSON.stringify({id:template.id,format,label,a,b,f,paints,media:nodes.map(item=>({before:item.time,after:item.node.currentTime,paused:item.node.paused})),before:pixels,after:socialPixels(host)},null,2));
        assert(socialPixels(host)===pixels,template.id+' '+format+' '+label+' : la composition sociale change en pause');
        assert(nodes.every(item=>item.node.paused&&Math.abs(item.node.currentTime-item.time)<.075),label+' : média ou audio continue en pause');
        await transport!.resume();await wait(200);const c=transport!.snapshot();
        assert(c.playing&&c.seconds>a.seconds+.08&&c.seconds<a.seconds+.65,label+' : reprise sans conserver le temps courant');
        const continued=active.filter(item=>!item.node.paused).map(item=>({before:item.time,after:item.node.currentTime}));
        if(active.length)assert(continued.length||media(g).some(item=>!item.paused),label+' : les médias ne reprennent pas');
        if(g.audio?.playing){const expected=g._times().main;assert(Math.abs(g.audio.mainSeconds-expected)<.12,label+' : le son BA repart au mauvais instant');}
        if(tl.timing.kind==='ba'){
          const time=g._times(),positions={intro:time.elapsed,body:time.body,pack:Math.max(0,time.main-tl.timing.stop)};
          for(const [kind,position]of Object.entries(positions)){const track=g.media.tracks[kind],node=g.media.node(kind);if(track.playing&&node instanceof HTMLVideoElement){const expected=g.media.locate(track,position).time;assert(Math.abs(node.currentTime-expected)<.2,label+' : la piste '+kind+' est décalée de son horloge ('+node.currentTime+' / '+expected+')');}}
        }
        checks[label]={pausedAt:a.seconds,resumedAt:c.seconds,mediaCount:nodes.length,continued,frame:f,audioTime:g.audio?.mainSeconds,baTimes:g._times?.(),baMedia:g.media?.status?.()};
      }
      await transport.start();await wait(300);await frozen('IN');
      await transport.out();await wait(80);assert(transport.snapshot().phase==='out','OUT dès IN ne commence pas');await frozen('OUT précoce');await transport.clear();
      await transport.seek(tl.timing.entry+1);const seekAt=transport.snapshot().seconds;
      if(g.audioBed)assert(Math.abs(g.audioBed.currentTime-g._audioPosition(seekAt))<.041,'Le lit sonore après inspection utilise le frame graphique tenu au lieu du temps du programme');
      assert(Math.abs(frame(g)-graphicTime(tl,seekAt)*25)<1,'Inspection après OUT encore bornée au segment de sortie : '+template.id+' '+format+' '+frame(g));await transport.resume();await wait(230);
      if(format==='tv'&&tl.timing.kind==='legacy'){const svg=g.state.animation.renderer.svgElement;assert(getComputedStyle(svg).display!=='none'&&getComputedStyle(svg).visibility!=='hidden','Le dessin SVG reste masqué après Effacer → inspection → reprise');}
      assert(transport.snapshot().seconds>seekAt+.1,'La reprise après déplacement recommence IN');await frozen('programme');
      await transport.out();await wait(100);assert(transport.snapshot().phase==='out','OUT ne commence pas immédiatement');await frozen('OUT');
      await transport.pause();const saved=transport.snapshot(),savedFrame=frame(g);await transport.clear();
      const updated=await g.updateAction(engineData(source,true));assert(!(updated?.statusCode>=400),updated?.statusMessage);
      await transport.seek(saved.seconds,saved.outAt);const restored=transport.snapshot();
      assert(restored.outAt===saved.outAt&&Math.abs(restored.seconds-saved.seconds)<.041,'Appliquer pendant OUT perd son début réel');
      if(g.audioBed)assert(Math.abs(g.audioBed.currentTime-g._audioPosition(tl.timing.stop+saved.seconds-saved.outAt!))<.041,'Le lit sonore OUT restauré repart au mauvais instant');
      const restoredFrame=frame(g),expectedFrame=graphicTime({...tl,outAt:saved.outAt!},saved.seconds)*25;
      // A paused Lottie paint can lag the wall clock by a RAF. An apply is an
      // exact clock inspection, so compare its source marker to the saved time,
      // not to the previous asynchronously painted subframe.
      assert(Math.abs(restoredFrame-expectedFrame)<=1,'Appliquer pendant OUT remplace son image par le programme : '+template.id+' '+format+' '+JSON.stringify({savedFrame,restoredFrame,expectedFrame,saved,restored}));
      await transport.resume();await wait(70);assert(transport.snapshot().phase==='out','Activer le son/appliquer pendant OUT revient au programme');checks.restoreOut={saved,restored,savedFrame,restoredFrame,expectedFrame};
      await transport.clear();await wait(180);assert(!transport.snapshot().playing&&transport.snapshot().phase==='stopped'&&transport.snapshot().seconds===0,'Effacer ne réinitialise pas le transport');
      assert(media(g).every(item=>item.node.paused),'Effacer laisse un média en lecture');
      await transport.seek(tl.timing.entry+1);await transport.resume();await transport.out();await transport.pause();await wait(180);
      assert(transport.snapshot().phase==='paused'&&media(g).every(item=>item.node.paused),template.id+' '+format+' : une préparation OUT tardive reprend la lecture après Pause '+JSON.stringify(transport.snapshot()));await transport.clear();
      await transport.seek(tl.outAt-.32);await transport.resume();await wait(120);await transport.pause();await wait(350);
      assert(transport.snapshot().phase==='paused'&&transport.snapshot().seconds<tl.outAt,'La pause ne suspend pas le déclenchement automatique OUT');
      await transport.resume();await wait(380);
      assert(transport.snapshot().phase===(data._out_mode==='manual'?'onair':'out'),'La reprise ne conserve pas le mode ou le délai OUT');await transport.clear();
      await transport.seek(tl.duration-.28);await transport.resume();await wait(500);
      assert(transport.snapshot().phase==='stopped'&&!transport.snapshot().playing,'La reprise après inspection OUT ne termine pas la sortie');
      await transport.start();await wait(200);assert(transport.snapshot().seconds<1&&transport.snapshot().playing,'IN ne recommence pas à zéro après OUT');await transport.clear();
      assert(!errors.length,errors.join(' | '));records.push({id:template.id,format,result:'PASS',checks});
      await save('transport-progress-'+Date.now()+'.json',JSON.stringify(records,null,2));
    }finally{clearInterval(audioTimer);transport?.dispose();controller.abort();signal.removeEventListener('abort',abort);audio?.dispose();await g.dispose();host.remove();}
  }
  const params=new URLSearchParams(location.search);if(!params.has('transport-template')&&!params.has('transport-format'))assertCompositionCoverage(records);
  await save('transport-'+Date.now()+'.json',JSON.stringify(records,null,2));return records;
}
