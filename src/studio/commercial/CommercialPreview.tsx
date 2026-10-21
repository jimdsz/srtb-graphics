import {useEffect,useRef,useState} from 'react';
import {Pause,Play,RotateCcw} from 'lucide-react';
import type {CommercialData} from './model';
import {commercialTimeline,commercialSequenceTimeline} from './model';
import {prepareCommercial} from './render';
import {prepareCommercialAudio,createCommercialAudioPlayer,primeCommercialAudioContext} from './audio';
import {resolveCommercialMedia} from './media';
import {sessionState} from '../session-state';
import {CanvasEditing,ElementTransform} from './CanvasEditing';
import type {CommercialSelection,CommercialEditBox} from './editing';
import type {CommercialLogoSize} from './logo-layout';
import SequenceEditor from './SequenceEditor';
import {commercialPreviewIdentity,commercialPreviewMoment,commercialPreviewPageAt,rebaseCommercialPreview} from './preview-cursor';
import {COMMERCIAL_LAYOUT_LABELS} from './sequence-labels';

export const clockLabel=(seconds:number)=>`${Math.floor(seconds/60).toString().padStart(2,'0')}:${Math.floor(seconds%60).toString().padStart(2,'0')}`;
function previewError(error:unknown){
  const message=error instanceof Error?error.message:String(error);
  return /failed to fetch|network ?error|network request|load failed/i.test(message)
    ?'Le chargement des ressources de l’aperçu a été interrompu. Vérifiez votre connexion, puis réessayez.'
    :message;
}
export default function CommercialPreview({data,page,onPage,busy,selection,editRequest,logoSize,onLogoSize,onSelect,onChange}:{data:CommercialData;page:number;onPage:(page:number,source?:'select'|'playback')=>void;busy:boolean;selection:CommercialSelection|null;editRequest:number;logoSize:CommercialLogoSize|null;onLogoSize:(size:(CommercialLogoSize&{url:string})|null)=>void;onSelect:(selection:CommercialSelection|null)=>void;onChange:(data:CommercialData)=>void}){
  const host=useRef<HTMLDivElement>(null),prepared=useRef<Awaited<ReturnType<typeof prepareCommercial>>|null>(null),player=useRef<ReturnType<typeof createCommercialAudioPlayer>|null>(null);
  const [time,setTime]=useState(()=>commercialPreviewMoment(data,page));
  const [ready,setReady]=useState(false),[error,setError]=useState(''),[playing,setPlaying]=useState(false),[preparing,setPreparing]=useState(false),[sceneRevision,setSceneRevision]=useState(0);
  const [boxes,setBoxes]=useState<CommercialEditBox[]>([]),[layoutIssues,setLayoutIssues]=useState<string[]>([]);
  const latest=useRef(data),loadingScene=useRef(false);latest.current=data;
  const appliedData=useRef<CommercialData|null>(null),cursor=useRef({data,page}),pageEcho=useRef<number|null>(null),pendingSelection=useRef<{data:CommercialData;page:number}|null>(null);
  const pageCallback=useRef(onPage);pageCallback.current=onPage;
  const logoSizeCallback=useRef(onLogoSize);logoSizeCallback.current=onLogoSize;
  const logoStamp=useRef('');
  const clock=useRef(time),run=useRef(0),animation=useRef(0),playingRef=useRef(false),audioController=useRef<AbortController|null>(null),timeline=commercialTimeline(data);
  function refreshElements(){const scene=prepared.current;if(scene){setBoxes(scene.elements());setLayoutIssues(scene.layoutIssues());const size=scene.logoSize(),stamp=JSON.stringify(size);if(stamp!==logoStamp.current){logoStamp.current=stamp;logoSizeCallback.current(size);}}}
  function stop(){run.current++;cancelAnimationFrame(animation.current);playingRef.current=false;setPlaying(false);audioController.current?.abort();player.current?.stop();prepared.current?.stopPlayback();refreshElements();}
  function showError(error:unknown){setError(previewError(error));setReady(false);}
  function retry(){stop();void player.current?.dispose();player.current=null;setReady(false);setPreparing(false);setError('');setBoxes([]);setSceneRevision(value=>value+1);}
  function publishPage(index:number,source:'select'|'playback') {
    cursor.current={data:latest.current,page:index};pageEcho.current=index;pageCallback.current(index,source);
  }
  function followClock(seconds:number) {
    const index=commercialPreviewPageAt(latest.current,seconds,cursor.current.page);
    if(index!==cursor.current.page)publishPage(index,'playback');
  }
  async function drawClock(scene:Awaited<ReturnType<typeof prepareCommercial>>,generation=run.current) {
    if(appliedData.current!==latest.current)return false;
    const value=clock.current;await scene.frame(value);
    if(generation!==run.current||prepared.current!==scene||appliedData.current!==latest.current)return false;
    setTime(value);refreshElements();setReady(true);return true;
  }
  useEffect(()=>{
    const previous=cursor.current,echo=pageEcho.current===page;
    if(echo)pageEcho.current=null;
    const pending=pendingSelection.current?.data===data?pendingSelection.current:null;
    const externalPage=page!==previous.page&&!echo?page:undefined;
    const requested=pending?.page??externalPage;
    const next=rebaseCommercialPreview(previous.data,data,previous.page,clock.current,requested);
    // Canvas selection belongs to the frame already visible, including its
    // outgoing card during a transition. Do not move a grabbed element.
    if(!pending&&externalPage!==undefined&&previous.data===data&&boxes.some(box=>box.page===externalPage))next.time=clock.current;
    const oldIdentity=commercialPreviewIdentity(previous.data,previous.page);
    const identityChanged=oldIdentity?.sequenceId!==next.identity?.sequenceId||oldIdentity?.slot!==next.identity?.slot;
    cursor.current={data,page:next.page};if(pending)pendingSelection.current=null;
    if(next.page!==page||identityChanged&&requested===undefined)publishPage(next.page,'playback');
    if(Math.abs(next.time-clock.current)>1e-7){setBoxes([]);void seek(next.time,false);}
  },[data,page]);
  useEffect(()=>{
    if(!editRequest)return;
    const visible=commercialSequenceTimeline(data).some(span=>span.pageIndices.includes(page)&&clock.current>=span.start&&clock.current<span.end);
    void seek(visible?clock.current:commercialPreviewMoment(data,page),false);
  },[editRequest]);
  useEffect(()=>{
    const control=new AbortController();stop();setReady(false);setError('');setBoxes([]);loadingScene.current=true;
    const timer=setTimeout(()=>{void (async()=>{let scene:Awaited<ReturnType<typeof prepareCommercial>>|undefined;try{scene=await prepareCommercial(resolveCommercialMedia(latest.current),control.signal,{preview:true});control.signal.throwIfAborted();let applied:CommercialData;do{applied=latest.current;await scene.update(resolveCommercialMedia(applied));control.signal.throwIfAborted();}while(applied!==latest.current);prepared.current=scene;appliedData.current=applied;host.current?.replaceChildren(scene.canvas);clock.current=Math.min(clock.current,commercialTimeline(latest.current).duration-.04);await drawClock(scene);control.signal.throwIfAborted();}catch(e){if(scene&&prepared.current!==scene)void scene.dispose();if(!control.signal.aborted)showError(e);}finally{if(!control.signal.aborted)loadingScene.current=false;}})();},120);
    return()=>{clearTimeout(timer);cancelAnimationFrame(animation.current);control.abort();run.current++;playingRef.current=false;void prepared.current?.dispose();prepared.current=null;appliedData.current=null;};
  },[data.theme,sceneRevision]);
  useEffect(()=>{
    stop();audioController.current?.abort();void player.current?.dispose();player.current=null;setError('');
    const scene=prepared.current;let active=true;
    if(!scene){if(!loadingScene.current)setSceneRevision(value=>value+1);return;}
    setReady(false);
    void (async()=>{try{if(!await scene.update(resolveCommercialMedia(data))||!active||latest.current!==data)return;appliedData.current=data;clock.current=Math.min(clock.current,timeline.duration-.04);await drawClock(scene);}catch(e){if(active&&prepared.current===scene)showError(e);}})();
    return()=>{active=false;};
  },[data]);
  useEffect(()=>{
    if(busy)stop();
    // An intervening dialog/export may invalidate the pending initial draw.
    // Once it closes, resume that draw rather than leaving Lire disabled.
    else if(!ready&&prepared.current&&appliedData.current===latest.current)void seek(clock.current,false);
  },[busy]);
  useEffect(()=>sessionState.subscribe(()=>{if(!sessionState.permitted(sessionState.snapshot().epoch))stop();}),[]);
  useEffect(()=>()=>{audioController.current?.abort();void player.current?.dispose();},[]);
  async function seek(value:number,follow=true){stop();const generation=run.current,scene=prepared.current;clock.current=Math.max(0,Math.min(value,commercialTimeline(latest.current).duration-.04));setTime(clock.current);try{if(scene&&await drawClock(scene,generation)&&follow)followClock(clock.current);}catch(e){if(generation===run.current&&scene===prepared.current)showError(e);}}
  async function play(){
    if(playingRef.current){stop();return;}if(!ready||busy||preparing)return;
    const generation=++run.current;const controller=new AbortController();audioController.current?.abort();audioController.current=controller;setPreparing(true);setError('');
    let primed:ReturnType<typeof primeCommercialAudioContext>|undefined,transferred=false;
    try{
      if(player.current)await player.current.resumeFromGesture();
      if(!player.current){primed=primeCommercialAudioContext();await primed.ready;controller.signal.throwIfAborted();const mixed=await prepareCommercialAudio(resolveCommercialMedia(data),controller.signal);controller.signal.throwIfAborted();if(generation!==run.current)return;if(mixed){player.current=createCommercialAudioPlayer(mixed.buffer,primed.context);transferred=true;}}
      controller.signal.throwIfAborted();if(generation!==run.current)return;
      if(clock.current>=timeline.duration-.05)clock.current=0;
      const start=clock.current,activePlayer=player.current,scene=prepared.current;
      if(!scene)return;await scene.startPlayback(start);
      if(controller.signal.aborted||generation!==run.current){scene.stopPlayback();return;}
      await activePlayer?.play(start);
      if(controller.signal.aborted||generation!==run.current||!sessionState.permitted(sessionState.snapshot().epoch)){activePlayer?.stop();scene.stopPlayback();return;}
      const started=performance.now();let lastUpdate=0;
      playingRef.current=true;setPlaying(true);
      function tick(now:number){if(generation!==run.current||!playingRef.current)return;try{const seconds=activePlayer?activePlayer.currentTime:start+(now-started)/1000;clock.current=Math.min(seconds,timeline.duration);scene!.playbackFrame(Math.min(clock.current,timeline.duration-.001));if(now-lastUpdate>=100){setTime(clock.current);followClock(clock.current);lastUpdate=now;}if(clock.current>=timeline.duration){setTime(clock.current);followClock(clock.current);stop();return;}animation.current=requestAnimationFrame(tick);}catch(e){if(generation===run.current){stop();showError(e);}}}
      animation.current=requestAnimationFrame(tick);
    }catch(e){if(!controller.signal.aborted&&generation===run.current)showError(e);}finally{if(primed&&!transferred)await primed.dispose();if(audioController.current===controller)setPreparing(false);}
  }
  function select(index:number){publishPage(index,'select');setBoxes([]);void seek(commercialPreviewMoment(data,index),false);}
  function changeSequences(next:CommercialData,index?:number){stop();const rebased=rebaseCommercialPreview(data,next,cursor.current.page,clock.current,index);pendingSelection.current={data:next,page:rebased.page};clock.current=rebased.time;setTime(clock.current);setBoxes([]);pageEcho.current=rebased.page;pageCallback.current(rebased.page,'select');onChange(next);}
  const sequenceSpans=commercialSequenceTimeline(data),visibleSequence=sequenceSpans.find(span=>time>=span.start&&time<span.end);
  return <section className="commercial-preview" aria-label="Aperçu de l’annonce">
    <div className="commercial-preview-context"><strong>{visibleSequence?`Séquence ${visibleSequence.index+1} sur ${sequenceSpans.length}`:time<timeline.firstStart?'Ouverture':'Fin'}</strong><span>{visibleSequence?COMMERCIAL_LAYOUT_LABELS[visibleSequence.layout]:'Signature de l’annonce'}</span></div>
    <div className="commercial-canvas-wrap"><div className="commercial-canvas" ref={host} role="img" aria-label={`Aperçu vidéo ${data.theme}, ${clockLabel(time)}`}/>{!playing&&boxes.length?<CanvasEditing data={data} boxes={boxes} selection={selection} logoSize={logoSize} disabled={busy||!!error} onSelect={onSelect} onChange={onChange}/>:null}</div>
    {!ready&&!error&&!boxes.length?<p role="status">Préparation de l’aperçu…</p>:null}
    {error?<div className="commercial-error" role="alert"><p>{error}</p><p>Vos textes et réglages sont conservés.</p><button type="button" disabled={busy} onClick={retry}>Réessayer l’aperçu</button></div>:null}
    <div className="commercial-transport"><button type="button" disabled={!ready||busy||preparing} aria-label={playing?'Mettre en pause':'Lire l’annonce'} onClick={()=>void play()}>{playing?<Pause size={20}/>:<Play size={20}/>}</button><span>{clockLabel(time)} / {clockLabel(Math.round(timeline.duration))}</span><input type="range" aria-label="Position de lecture" min="0" max={timeline.duration-.04} step="0.033367" value={Math.min(time,timeline.duration-.04)} disabled={!ready||busy} onChange={e=>void seek(Number(e.target.value))}/><button type="button" aria-label="Revenir au début" disabled={!ready||busy} onClick={()=>void seek(0)}><RotateCcw size={18}/></button></div>
    {preparing?<small role="status">Préparation du mixage audio…</small>:null}
    <p className="commercial-canvas-help">{playing?'Mettez en pause pour modifier un élément dans l’image.':'Cliquez sur un titre, un texte ou le logo dans l’image pour régler sa taille et sa position.'}</p>
    {!playing?<ElementTransform data={data} selection={selection} logoSize={logoSize} disabled={busy} onSelect={onSelect} onChange={onChange}/>:null}
    {layoutIssues.length?<p className="commercial-error" role="status">{layoutIssues.join('\n')} Ajustez les réglages avant l’export.</p>:null}
    <SequenceEditor data={data} page={page} disabled={busy} onSelect={select} onChange={changeSequences}/>
  </section>;
}
