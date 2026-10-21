import { useEffect, useRef, useState,useSyncExternalStore } from 'react';
import type {CSSProperties} from 'react';
import type { BroadcastTemplate, ProjectData } from './domain';
import { validateProjectData } from './domain';
import {connectedLocal,localMediaSnapshot,localReferences,localURL,resolveLocalData,subscribeLocalMedia,prioritizeLocalMedia} from './local-media';
import {selectedMediaData} from './media-selection';
import {previewData} from './preview-data';
import {installGraphicCompatibility} from './graphic-compatibility';
import {installBAMediaReadiness} from './media-readiness';
import {dimensions,engineData,presentation} from './presentation';
import {attachSocialPreview} from './social-preview';
import {installSocialScene} from './social-scene';
import Activity from './Activity';
import {installBALoader,previewSources} from './preview-resources';
import {previewAudio} from './preview-audio';
import {installPreviewBackgrounds} from './preview-backgrounds';
import TimeRuler from './TimeRuler';
import {previewTimeline} from './preview-timeline';
import {installPreviewTransport} from './preview-transport';
import type {PreviewTransport} from './preview-transport';
import type {LegacyGraphic} from './video/engine';
import {previewEngineModule} from './preview-engine-module';
import {installTypography} from './typography-engine';
import TypographyHandles from './TypographyHandles';
import ElementHandles from './ElementHandles';
import {sessionState} from './session-state';
import {installSupplementalVoice,installNativeVoiceFit} from './supplemental-voice';
import {updatePreviewAtPosition} from './preview-update';
import type {overlayLogoGeometry} from './logo-model';
import {previewUpdateNeeded} from './live-preview';
import {TIMINGS} from './video/timeline';
import {preservePortraitLayout} from './social-portrait-layout';
import {Check,ChevronRight,Clock3,Monitor,RefreshCw,SlidersHorizontal} from 'lucide-react';
import PreviewControls from './PreviewControls';
import './production-controls.css';
import {installPreviewMediaSurfaces} from './preview-media-surfaces';
import {installAEMediaTrim} from './ae-media-trim';
import PreviewHealth from './PreviewHealth';
import {installBAPreviewSurfaces} from './ba-preview-surfaces';
import {previewOperation} from './preview-operation';
import {draftTextIssue} from './draft-recovery';
import {holdPreviewFrame,withHeldPreviewFrame} from './preview-hold';
import {installBAPreviewPlayback} from './ba-preview-playback';
import {baSocialDirect} from './ba-social-direct';
import {renderSlot} from './render-slot';

type OverlayLogoLayout=ReturnType<typeof overlayLogoGeometry>;

interface Result { statusCode?: number; statusMessage?: string; phase?: string; playStatus?: string; elapsed?: number; frame?: number }
interface Graphic extends HTMLElement {
  load(args: {renderType:string;previewMuted:boolean;data:ProjectData}): Promise<Result>;
  updateAction(args: ProjectData): Promise<Result>;
  playAction(): Promise<Result>;
  stopAction(args?: {skipAnimation?:boolean}): Promise<Result>;
  goToTime(args: {seconds:number}): Promise<Result>;
  setMuted?: (value:boolean)=>Promise<Result>;
  getStatus(): Promise<Result>;
  dispose(): Promise<unknown>;
  _build?: (...args:any[])=>Promise<any>;
}
function check(result: Result) {
  if (result.statusCode && result.statusCode >= 400) throw new Error(result.statusMessage || 'Le moteur a refusé cette action.');
}
function previewSignature(template:BroadcastTemplate,data:ProjectData){
  // Hash promotion changes identity, not the actual media URL. Missing files
  // and invalid draft sequences are reported by loading, never by React render.
  try{return JSON.stringify(resolveLocalData(template,data));}catch{return JSON.stringify(data);}
}
export default function Preview({template,data,onReadinessChange,onChange,onLogoLayout,onSelectElement,disabled=false,mediaPresentation}: {template:BroadcastTemplate;data:ProjectData;onReadinessChange?:(ready:boolean)=>void;onChange?:(data:ProjectData)=>void;onLogoLayout?:(layout:OverlayLogoLayout|undefined)=>void;onSelectElement?:(field:string)=>void;disabled?:boolean;mediaPresentation?:'svg'|'canvas'|'svg-all-png'}) {
  const session=useSyncExternalStore(sessionState.subscribe,sessionState.snapshot),sessionSuspended=session.suspended||session.ended;
  useSyncExternalStore(subscribeLocalMedia,localMediaSnapshot);
  const localKey=JSON.stringify(localReferences(template,data).map(ref=>connectedLocal(ref.url)?localURL(ref.url):ref.url));
  const host=useRef<HTMLDivElement>(null),graphic=useRef<Graphic|null>(null);
  const transport=useRef<PreviewTransport|null>(null);
  const loadedGraphic=useRef(false);
  const latest=useRef(data); latest.current=data;
  const logoCallback=useRef(onLogoLayout),logoLayoutKey=useRef('');logoCallback.current=onLogoLayout;
  const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const renderingExport=useSyncExternalStore(renderSlot.subscribe,renderSlot.snapshot);
  const rebuildFailure=useRef(''),[needsRebuild,setNeedsRebuild]=useState(false);
  const [layoutWarning,setLayoutWarning]=useState('');
  const rendering=renderingExport||sessionSuspended;
  const [loading,setLoading]=useState(true),[retry,setRetry]=useState(0);
  const [stage,setStage]=useState('Ouverture du moteur'),[soundLoading,setSoundLoading]=useState(false);
  const [muted,setMuted]=useState(true),[position,setPosition]=useState(0),[inspection,setInspection]=useState('0'),[phase,setPhase]=useState('Chargement…');
  const applied=useRef(''),[appliedSignature,setAppliedSignature]=useState('');
  const lastGood=useRef<ProjectData|null>(null),failedLoad=useRef(''),heldPicture=useRef<(()=>void)|undefined>(undefined);
  function releaseHeldPicture(){heldPicture.current?.();heldPicture.current=undefined;}
  const audioPrepared=useRef(false);
  const audioControl=useRef<Awaited<ReturnType<typeof previewAudio>>|null>(null);
  const [peak,setPeak]=useState(0),[audioState,setAudioState]=useState('suspended'),[volume,setVolume]=useState(1);
  const [duration,setDuration]=useState(0),[playing,setPlaying]=useState(false);
  const [loadMs,setLoadMs]=useState(0);
  const [textWarnings,setTextWarnings]=useState<string[]>([]);
  const [audioWarning,setAudioWarning]=useState('');
  const textPause=useRef<Promise<boolean>|null>(null);
  const operation=useRef(false),attempted=useRef('');
  const lifetime=useRef<AbortController|null>(null),interrupt=useRef<()=>void>(()=>{});
  const [recovery,setRecovery]=useState('');
  const format=presentation(data),size=dimensions(data);
  useEffect(()=>{
    logoLayoutKey.current='';logoCallback.current?.(undefined);
    if(!sessionSuspended)return;
    releaseHeldPicture();
    audioControl.current?.volume(0);setMuted(true);setPlaying(false);
    if(loadedGraphic.current)void transport.current?.pause().catch(()=>{});
    if(graphic.current?.setMuted)void graphic.current.setMuted(true).catch(()=>{});
  },[sessionSuspended]);
  useEffect(()=>{if(renderingExport){releaseHeldPicture();if(loadedGraphic.current)void transport.current?.pause().catch(()=>{});}},[renderingExport]);
  useEffect(()=>{
    rebuildFailure.current='';setNeedsRebuild(false);
    loadedGraphic.current=false;operation.current=false;attempted.current='';setReady(false);setLoading(true);setBusy(false);setError('');setTextWarnings([]);setAudioWarning('');setLayoutWarning('');setMuted(true);setPosition(0);setPhase('Chargement…');
    logoLayoutKey.current='';logoCallback.current?.(undefined);
    audioPrepared.current=false;setSoundLoading(false);setPeak(0);setAudioState('suspended');setDuration(0);setPlaying(false);
    const snapshot=structuredClone(latest.current);
    const loadStarted=performance.now();setLoadMs(0);
    let disposed=false,element:Graphic|null=null,audio:Awaited<ReturnType<typeof previewAudio>>|undefined,controls:PreviewTransport|undefined;const abort=new AbortController(),releaseMedia=prioritizeLocalMedia();
    lifetime.current=abort;
    const stop=()=>{disposed=true;abort.abort();releaseMedia();clearTimeout(timeout);heldPicture.current?.();heldPicture.current=undefined;loadedGraphic.current=false;controls?.dispose();if(graphic.current===element){graphic.current=null;transport.current=null;audioControl.current=null;}audio?.dispose();void element?.dispose().catch(()=>{});element?.remove();};
    interrupt.current=stop;
    const report=(event:Event)=>{
      if(disposed)return;
      const message=(event as CustomEvent<{message:string}>).detail?.message||'Erreur du moteur.';
      if(event.type==='broadcast-media-error'){
        rebuildFailure.current=message;setNeedsRebuild(true);setPlaying(false);setPhase('À relancer');
      }
      setError(message);
    };
    const warn=(event:Event)=>{if(!disposed)setAudioWarning((event as CustomEvent<{message:string}>).detail?.message||'Voix interrompue volontairement.');};
    const layoutWarn=(event:Event)=>{if(!disposed)setLayoutWarning((event as CustomEvent<{message:string}>).detail?.message||'');};
    const timeout=setTimeout(()=>{if(!disposed){failedLoad.current=previewSignature(template,snapshot);abort.abort(new Error('Le chargement prend trop de temps. Vérifiez la connexion ou relancez cet aperçu.'));setError(String(abort.signal.reason.message));setPhase('À relancer');setLoading(false);audio?.dispose();void element?.dispose().catch(()=>{});}},60000);
    void (async()=>{
      const resolved=previewSources(template,resolveLocalData(template,validateProjectData(template,selectedMediaData(template,snapshot),true)));
      setStage('Ouverture du moteur');
      const module: {default:CustomElementConstructor}=await import(/* @vite-ignore */ previewEngineModule(template));
      if(disposed)return;abort.signal.throwIfAborted();
      const tag=`studio-${template.id.toLowerCase().replaceAll('_','-')}-${template.version.replaceAll('.','-')}`;
      if(!customElements.get(tag))customElements.define(tag,module.default);
      element=document.createElement(tag) as Graphic;
      if(format==='tv')installBAPreviewSurfaces(element as unknown as LegacyGraphic,template,mediaPresentation===undefined?undefined:mediaPresentation!=='canvas',mediaPresentation!=='svg-all-png');
      await installPreviewMediaSurfaces(element as unknown as LegacyGraphic,template,format!=='tv',mediaPresentation===undefined?undefined:mediaPresentation!=='canvas');
      installAEMediaTrim(element as unknown as LegacyGraphic,template);
      if(disposed||abort.signal.aborted){void element.dispose().catch(()=>{});abort.signal.throwIfAborted();return;}
      audio=await previewAudio(element as unknown as LegacyGraphic,template);if(disposed||abort.signal.aborted){audio.dispose();void element.dispose().catch(()=>{});abort.signal.throwIfAborted();return;}audioControl.current=audio;
      installSupplementalVoice(element as unknown as LegacyGraphic,template,{context:audio.context,destination:audio.bus,signal:abort.signal,permission:sessionState.permission});
      installNativeVoiceFit(element as unknown as LegacyGraphic,template);
      installBALoader(element as unknown as LegacyGraphic,template,label=>{if(!disposed)setStage(label);});
      installBAPreviewPlayback(element as unknown as LegacyGraphic,template);
      if(format==='tv'){installGraphicCompatibility(element,{...template,module:new URL(template.module,document.baseURI).href});installPreviewBackgrounds(element as unknown as LegacyGraphic,template,label=>{if(!disposed)setStage(label);});}
      else installSocialScene(element as unknown as LegacyGraphic,template);
      installTypography(element as unknown as LegacyGraphic,template,resolved);
      element.style.cssText='display:block;position:relative;width:100%;height:100%;overflow:hidden';
      host.current?.replaceChildren(element);graphic.current=element;
      element.addEventListener('broadcast-error',report);element.addEventListener('broadcast-media-error',report);
      element.addEventListener('broadcast-audio-warning',warn);
      element.addEventListener('broadcast-layout-warning',layoutWarn);
      await installBAMediaReadiness(template);abort.signal.throwIfAborted();
      check(await element.load({renderType:'realtime',previewMuted:true,data:previewData(engineData(resolved,true),true,!!element.setMuted)}));abort.signal.throwIfAborted();
      if(format!=='tv'&&!disposed)await attachSocialPreview(element as unknown as LegacyGraphic,template,previewData(resolved,true,!!element.setMuted),abort.signal);
      if(disposed)return;abort.signal.throwIfAborted();
      if(rebuildFailure.current)throw Error(rebuildFailure.current);
      controls=installPreviewTransport(element as unknown as LegacyGraphic,template,()=>latest.current,error=>{if(!disposed)setError(error.message);},sessionState.permission);transport.current=controls;
      const timeline=previewTimeline(element as unknown as LegacyGraphic,template,snapshot);
      setTextWarnings((element as unknown as LegacyGraphic).state?.renderedTemplate?.__studioTextWarnings||[]);
      loadedGraphic.current=true;lastGood.current=structuredClone(snapshot);failedLoad.current='';applied.current=previewSignature(template,snapshot);setAppliedSignature(applied.current);setReady(true);setPhase('Prêt — hors antenne');setDuration(timeline.duration);
      setLoadMs(performance.now()-loadStarted);
    })().catch(e=>{if(!disposed){failedLoad.current=previewSignature(template,snapshot);audio?.dispose();void element?.dispose().catch(()=>{});setError(e instanceof Error?e.message:String(e));setPhase('À corriger');}}).finally(()=>{releaseMedia();clearTimeout(timeout);if(!disposed)setLoading(false);});
    return()=>{stop();if(lifetime.current===abort)lifetime.current=null;logoLayoutKey.current='';logoCallback.current?.(undefined);if(element){element.removeEventListener('broadcast-error',report);element.removeEventListener('broadcast-media-error',report);element.removeEventListener('broadcast-audio-warning',warn);element.removeEventListener('broadcast-layout-warning',layoutWarn);}};
  },[template,localKey,retry,format,mediaPresentation]);
  useEffect(()=>{
    if(!ready||needsRebuild)return;
    const timer=setInterval(()=>{const snapshot=transport.current?.snapshot();if(snapshot){setPhase(snapshot.phase);setPosition(snapshot.seconds);setPlaying(snapshot.playing);}const g=graphic.current as unknown as LegacyGraphic|null,layout=g?.__socialPreview?.logoLayout?.()??g?.__studioLogo?.layout?.();const key=JSON.stringify(layout)||'';if(key!==logoLayoutKey.current){logoLayoutKey.current=key;logoCallback.current?.(layout);}},100);
    return()=>clearInterval(timer);
  },[ready,needsRebuild,format,template.id]);
  useEffect(()=>{if(!ready)return;const timer=setInterval(()=>{try{const sample=audioControl.current?.sample();if(sample){setPeak(sample.peak);setAudioState(sample.state);}}catch{setAudioState('unavailable');}},150);return()=>clearInterval(timer);},[ready]);
  useEffect(()=>{audioControl.current?.volume(sessionSuspended?0:volume);},[volume,ready,sessionSuspended]);
  function recover(restart:boolean){
    failedLoad.current=previewSignature(template,latest.current);
    interrupt.current();operation.current=false;textPause.current=null;setReady(false);setLoading(false);setBusy(false);setSoundLoading(false);setPlaying(false);setMuted(true);
    if(restart){setRecovery('Réouverture de l’aperçu sans son ; vos réglages sont conservés.');setRetry(value=>value+1);}
    else{setError('L’aperçu ne répond plus. Relancez-le ; vos textes, médias et réglages sont conservés.');setPhase('À relancer');}
  }
  async function action(run:(g:Graphic,assertAllowed:()=>void)=>Promise<unknown>) {
    if(!graphic.current||rebuildFailure.current||operation.current||busy||soundLoading||rendering)return;operation.current=true;setBusy(true);setError('');setAudioWarning('');
    const current=graphic.current,allowed=sessionState.permission();
    const assertAllowed=()=>{if(rebuildFailure.current)throw Error(rebuildFailure.current);if(!allowed()||graphic.current!==current)throw Error('Cette action a été interrompue. Relancez-la après vérification de la connexion.');};
    try{assertAllowed();await previewOperation(()=>run(current,assertAllowed),lifetime.current!.signal,()=>recover(false));assertAllowed();}catch(e){if(graphic.current===current)setError(e instanceof Error?e.message:String(e));}finally{if(graphic.current===current){operation.current=false;setBusy(false);}}
  }
  async function apply(g:Graphic,nextMuted=muted) {
    const allowed=sessionState.permission();
    const assertAllowed=()=>{if(rebuildFailure.current)throw Error(rebuildFailure.current);if(!allowed()||graphic.current!==g)throw Error('Vérifiez la connexion avant de reprendre l’aperçu.');};
    const snapshot=structuredClone(latest.current);
    const issue=draftTextIssue(template,snapshot);if(issue)throw Error(issue);
    const candidate=previewSources(template,resolveLocalData(template,validateProjectData(template,selectedMediaData(template,snapshot),true)));
    const controls=transport.current,initialPhase=controls?.snapshot().phase,releaseMedia=prioritizeLocalMedia();
    try{
    const adapter=g as unknown as LegacyGraphic;
    const live=format==='tv'?adapter.__typography:adapter.__socialPreview;
    // Text/style-only edits reuse the visible scene and media clock. Changes to
    // media, timing or audio still use the validated engine update below.
    if(!['ready','stopped'].includes(initialPhase||'ready')&&nextMuted===muted&&await live?.updateLive?.(previewData(format==='tv'?engineData(candidate,true):candidate,nextMuted,!!g.setMuted,audioPrepared.current),allowed)){
      assertAllowed();lastGood.current=structuredClone(snapshot);heldPicture.current?.();heldPicture.current=undefined;applied.current=previewSignature(template,snapshot);setAppliedSignature(applied.current);return;
    }
    if(!heldPicture.current&&initialPhase!=='ready'&&initialPhase!=='stopped')heldPicture.current=await holdPreviewFrame(adapter,lifetime.current!.signal);
    assertAllowed();
    await updatePreviewAtPosition(template,controls,async()=>{
    check(await g.updateAction(previewData(format==='tv'?engineData(candidate,true):candidate,nextMuted,!!g.setMuted,audioPrepared.current)));assertAllowed();(g as unknown as LegacyGraphic).__supplementalVoice?.mute(nextMuted);if(g.setMuted)check(await g.setMuted(nextMuted));assertAllowed();
    if(graphic.current!==g)return;
    if(!nextMuted)audioPrepared.current=true;
    applied.current=previewSignature(template,snapshot);setAppliedSignature(applied.current);
    setTextWarnings((g as unknown as LegacyGraphic).state?.renderedTemplate?.__studioTextWarnings||[]);
    setDuration(previewTimeline(g as unknown as LegacyGraphic,template,snapshot).duration);
    },assertAllowed);
    if(initialPhase==='ready'||initialPhase==='stopped'){
      assertAllowed();await controls?.seek(baSocialDirect(template.id,snapshot)?0:Math.min(TIMINGS[template.id].entry+.2,previewTimeline(g as unknown as LegacyGraphic,template,snapshot).duration-.04));
    }
    lastGood.current=structuredClone(snapshot);heldPicture.current?.();heldPicture.current=undefined;
    }catch(error){
      // A failed edit may already have cleared a legacy scene. Even reverting
      // to the previous data must schedule a new recoverable update.
      if(graphic.current===g){applied.current='';setAppliedSignature('');}
      throw error;
    }finally{releaseMedia();if(!allowed()){releaseHeldPicture();audioControl.current?.volume(0);if(g.setMuted)void g.setMuted(true).catch(()=>{});void controls?.pause().catch(()=>{});}}
  }
  async function seek(seconds:number){await action(async(g,assertAllowed)=>{
    if(changed)await apply(g);assertAllowed();
    const controls=transport.current,currentPhase=controls?.snapshot().phase;
    const inspect=async()=>{assertAllowed();await controls?.seek(seconds);assertAllowed();};
    if(currentPhase&&currentPhase!=='ready'&&currentPhase!=='stopped')await withHeldPreviewFrame(g as unknown as LegacyGraphic,lifetime.current!.signal,inspect);
    else await inspect();
    releaseHeldPicture();const current=controls?.snapshot();if(current){setPosition(current.seconds);setInspection(String(current.seconds));setPhase(current.phase);setPlaying(false);}
  });}
  const signature=previewSignature(template,data),changed=signature!==appliedSignature;
  const draftIssue=draftTextIssue(template,data);
  const automatic=useRef<()=>void>(()=>{});
  automatic.current=()=>{attempted.current=signature;if(rebuildFailure.current)recover(true);else void action(g=>apply(g));};
  useEffect(()=>{
    if(!previewUpdateNeeded(signature,appliedSignature,attempted.current,ready,loading||busy||soundLoading||rendering||disabled||!!draftIssue))return;
    const timer=setTimeout(()=>automatic.current(),180);
    return()=>clearTimeout(timer);
  },[signature,appliedSignature,ready,loading,busy,soundLoading,rendering,disabled,draftIssue]);
  useEffect(()=>{if(!ready&&!loading&&!busy&&!rendering&&!disabled&&!draftIssue&&error&&failedLoad.current&&signature!==failedLoad.current){failedLoad.current=signature;setRetry(value=>value+1);}},[signature,ready,loading,busy,rendering,disabled,draftIssue,error]);
  function restoreLastGood(){
    if(!lastGood.current||!onChange)return;
    const restored=structuredClone(lastGood.current);latest.current=restored;onChange(restored);attempted.current='';setError('');
    recover(true);
  }
  async function toggleSound(){
    const g=graphic.current;if(!g||rebuildFailure.current||operation.current||busy||soundLoading||rendering)return;
    const nextMuted=!muted,allowed=sessionState.permission();setSoundLoading(true);setError('');
    // Invoke resume in the click, before any network/update await.
    const unlocked=nextMuted?Promise.resolve():audioControl.current?.unlock()||Promise.resolve();
    try{await previewOperation(async()=>{await unlocked;if(rebuildFailure.current)throw Error(rebuildFailure.current);if(!allowed()||graphic.current!==g)throw Error('Vérifiez la connexion avant de reprendre le son.');if(audioPrepared.current&&!changed&&g.setMuted)check(await g.setMuted(nextMuted));else await apply(g,nextMuted);if(rebuildFailure.current||!allowed()||graphic.current!==g){if(g.setMuted)await g.setMuted(true);if(rebuildFailure.current)throw Error(rebuildFailure.current);return;}setMuted(nextMuted);},lifetime.current!.signal,()=>recover(false));}
    catch(e){if(graphic.current===g)setError(e instanceof Error?e.message:String(e));}
    finally{if(graphic.current===g)setSoundLoading(false);}
  }
  const currentPreviewReady=ready&&!loading&&!busy&&!soundLoading&&!rendering&&!error&&!changed&&!draftIssue;
  function inspectText(){
    if(textPause.current)return textPause.current;
    const g=graphic.current,allowed=sessionState.permission();
    if(!g||rebuildFailure.current||disabled||busy||soundLoading||rendering||changed||!allowed())return Promise.resolve(false);
    const task=(async()=>{try{await transport.current?.pause();if(!allowed()||graphic.current!==g)return false;const snapshot=transport.current?.snapshot();if(snapshot){setPosition(snapshot.seconds);setPlaying(false);setPhase(snapshot.phase);}return true;}catch(e){setError(e instanceof Error?e.message:String(e));return false;}finally{textPause.current=null;}})();
    textPause.current=task;return task;
  }
  function placeText(next:ProjectData){
    next=preservePortraitLayout(template.id,latest.current,next);
    // Already moved in the instance. Avoid a rebuild and preserve native glyphs,
    // keyboard focus and every rapid nudge in the draft.
    latest.current=next;applied.current=previewSignature(template,next);setAppliedSignature(applied.current);onChange?.(next);
  }
  useEffect(()=>{onReadinessChange?.(currentPreviewReady);},[currentPreviewReady,onReadinessChange]);
  const displayPhase=({ready:'Prêt',loaded:'Prêt',in:'Entrée',onair:'Lecture',out:'Sortie',stopped:'Arrêté',stop:'Arrêté',paused:'En pause',inspection:'Inspection'} as Record<string,string>)[phase]||phase;
  const playbackWorking=busy||soundLoading||rendering||needsRebuild;
  const restart=()=>void action(async(g,assertAllowed)=>{if(changed)await apply(g);assertAllowed();await transport.current?.start();setPosition(0);setPlaying(true);setPhase('in');});
  const playPause=()=>void action(async(g,assertAllowed)=>{const controls=transport.current;if(!controls)return;if(controls.snapshot().playing)await controls.pause();else{if(changed)await apply(g);assertAllowed();if(controls.snapshot().phase==='paused')await controls.resume();else await controls.start();}const current=controls.snapshot();setPosition(current.seconds);setPlaying(current.playing);setPhase(current.phase);});
  return <section className="preview-panel" aria-label="Aperçu du modèle">
    <div className="preview-meta monitor-heading"><span className="monitor-name"><Monitor size={15} aria-hidden="true"/> Aperçu <span className="monitor-offair">Hors antenne</span></span><span className="monitor-format">{size.width} × {size.height} · {template.fps} i/s</span></div>
    <div className={`preview-screen ${format!=='tv'?'social-screen':''}`} style={{'--preview-ratio':size.width/size.height,aspectRatio:`${size.width} / ${size.height}`,maxWidth:format==='tv'?undefined:format==='vertical'?432:540,marginInline:'auto'} as CSSProperties}><div ref={host} className="graphic-host"/>{ready&&onSelectElement?<ElementHandles playing={playing} host={host} template={template} social={format!=='tv'} disabled={disabled||busy||soundLoading||rendering||changed} onInspect={inspectText} onSelect={onSelectElement}/>:null}{ready&&onChange?<TypographyHandles playing={playing} host={host} data={data} template={template} onChange={placeText} disabled={disabled||busy||soundLoading||rendering||changed} onInspect={inspectText} onSelect={onSelectElement}/>:null}{!ready ? <div className="preview-loading">{error?'Aperçu indisponible':<Activity key={retry+'-'+format} label={stage} detail="Vos fichiers locaux restent sur ce poste. Vous pouvez quitter ce modèle pour interrompre le chargement."/>}</div>:null}</div>
    {layoutWarning?<p className="notice" role="status">{layoutWarning}</p>:null}
    {draftIssue?<div className="notice" role="status"><p>{draftIssue}</p><p className="small">Le titre reste requis pour la livraison de ce modèle.</p>{lastGood.current&&onChange?<button disabled={busy||loading||disabled} onClick={restoreLastGood}>Revenir aux derniers réglages valides</button>:null}</div>:null}
    {recovery?<p className="notice" role="status">{recovery}<button onClick={()=>setRecovery('')}>Fermer</button></p>:null}
    {error&&!draftIssue ? <div className="notice error" role="alert"><p>{error}</p><p>{needsRebuild?'L’affichage a été interrompu. Relancez l’aperçu pour le reconstruire ; vos textes, médias et réglages restent modifiables et sont conservés.':'Vos réglages restent modifiables. Corrigez le champ ou relancez l’aperçu.'}</p><button disabled={loading||busy||rendering} onClick={()=>recover(true)}>Relancer l’aperçu</button>{lastGood.current&&onChange?<button disabled={loading||busy||disabled||rendering} onClick={restoreLastGood}>Revenir aux derniers réglages valides</button>:null}</div>:null}
    {audioWarning?<p className="notice warning" role="status">{audioWarning}</p>:null}
    {textWarnings.length?<details className="notice text-advice"><summary>Texte à vérifier — aperçu et export disponibles</summary><p>Le moteur conserve votre choix. Dans Textes et dates → Mise en forme du titre, réduisez la taille ou proposez une autre répartition si nécessaire.</p><ul>{textWarnings.map((warning,i)=><li key={i}>{warning.replace(/2 LIGNES HAUT|1 LIGNE 1|1 LIGNE 2/g,'Titre du carton — ligne 1').replace('2 LIGNES BAS','Titre du carton — ligne 2').replace('3 LIGNES BAS','Titre du carton — ligne 3').replace('TYPO 2L 3','Titre du corps — ligne 1').replace('TYPO 2L 4','Titre du corps — ligne 2')}</li>)}</ul></details>:null}
    <div className="monitor-desk">
      <TimeRuler value={Math.min(position,Math.max(0,duration-.04))} duration={duration} onSeek={seconds=>void seek(seconds)} disabled={!ready||playbackWorking} label="Position dans l’aperçu" phase={displayPhase} playing={playing}/>
      <PreviewControls ready={ready} working={playbackWorking} playing={playing} paused={phase==='paused'} muted={muted} soundLoading={soundLoading} onRestart={restart} onPlayPause={playPause} onOut={()=>void action(async()=>{releaseHeldPicture();await transport.current?.out();})} onClear={()=>void action(async()=>{releaseHeldPicture();await transport.current?.clear();setPosition(0);setPhase('stopped');setPlaying(false);})} onSound={()=>void toggleSound()}/>
      {soundLoading?<Activity label="Préparation du son" detail="Lecture et décodage des pistes audio. Cette étape dépend de la connexion et du fichier. Vous pouvez l’annuler sans perdre vos réglages."/>:null}
      {(busy||soundLoading)&&!rendering?<button onClick={()=>recover(true)}>Annuler et revenir à l’aperçu sans son</button>:null}
      {!muted?<div className="preview-audio monitor-audio"><label>Écoute <input aria-label="Volume de l’aperçu" type="range" min="0" max="1" step=".05" value={volume} onChange={e=>setVolume(Number(e.target.value))}/></label><meter aria-label="Niveau sonore de l’aperçu" min="0" max="1" value={peak}/><span>{audioState==='suspended'?'Audio suspendu':playing?peak>.002?'Signal présent':'Aucun signal':'Écoute en pause'}</span></div>:null}
      <div className="monitor-footer">
        <span className={`monitor-sync ${changed||error?'pending':''}`} role="status">{changed||error?<RefreshCw size={13} aria-hidden="true"/>:<Check size={13} aria-hidden="true"/>}{rendering?(sessionSuspended?'Vérification de connexion':'Aperçu en pause · export en cours'):loading?'Chargement…':!ready?'Aperçu indisponible':soundLoading?'Préparation du son…':busy?'Actualisation…':draftIssue?'Saisie en cours · dernier aperçu conservé':error?(changed?'Dernier aperçu conservé':'Aperçu à relancer'):changed?'Modification…':'Aperçu à jour'}</span>
        <details className="monitor-precision"><summary><SlidersHorizontal size={13} aria-hidden="true"/>Précision</summary><div className="preview-inspect"><label><Clock3 size={14} aria-hidden="true"/>Temps <input aria-label="Temps d’inspection en secondes" type="number" min="0" max={duration||86400} step="0.04" value={inspection} onChange={e=>setInspection(e.target.value)}/> s</label><button disabled={!ready||playbackWorking} onClick={()=>void seek(Number(inspection))}><ChevronRight size={15} aria-hidden="true"/>Voir cette image</button></div><p>Les modifications s’affichent automatiquement. La pause et l’inspection sont silencieuses.</p>{data._out_mode==='manual'?<p>{baSocialDirect(template.id,data)?'« Sortie » arrête directement l’image et le son, sans animation.':'Sortie manuelle : « Sortie » joue l’animation de fin. Le compteur peut dépasser la durée prévue.'}</p>:null}<PreviewHealth key={template.id+format+retry} host={host} template={template.id} format={format} loadMs={loadMs} playing={playing} disabled={!ready||playbackWorking}/></details>
      </div>
      {error&&changed&&!needsRebuild?<button disabled={!ready||playbackWorking} onClick={()=>void action(g=>apply(g))}>Réessayer la mise à jour</button>:null}
    </div>
  </section>;
}
