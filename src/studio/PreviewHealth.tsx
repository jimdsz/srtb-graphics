import {useEffect,useRef,useState} from 'react';
import type {RefObject} from 'react';
import type {LegacyGraphic} from './video/engine';
import {tracksOf} from './media-tracks';
import {loadedStudioEntry} from './app-version';
import {previewHealthMessage} from './preview-health-summary';
import {probePreviewRange} from './preview-range-probe';
import type {PreviewRangeResult} from './preview-range-probe';
import {PreviewPictureSamples,PICTURE_SOURCE_LIMIT,pictureSourceSample} from './preview-picture-progress';
import type {PictureSourceSample} from './preview-picture-progress';

/** On-demand local measurement, without media names, paths, telemetry or
 * device fingerprinting. RAF is UI availability, not proof of rendered fps. */
export default function PreviewHealth({host,template,format,loadMs,playing,disabled}:{host:RefObject<HTMLDivElement|null>;template:string;format:string;loadMs:number;playing:boolean;disabled:boolean}){
  const [seconds,setSeconds]=useState<number|null>(null),[report,setReport]=useState(''),[message,setMessage]=useState(''),[copied,setCopied]=useState(false);
  const cancel=useRef<()=>void>(()=>{});
  const finishOnPause=useRef<()=>void>(()=>{});
  useEffect(()=>()=>cancel.current(),[]);
  useEffect(()=>{if(disabled)cancel.current();else if(!playing)finishOnPause.current();},[disabled,playing]);
  function start(){
    cancel.current();setReport('');setMessage('');setCopied(false);setSeconds(0);
    const g=host.current?.firstElementChild as LegacyGraphic|null;if(!g){setSeconds(null);return;}
    const begin=performance.now(),gaps:number[]=[],videos=new Map<HTMLVideoElement,{total:number;dropped:number;lastTotal:number;lastDropped:number}>();
    const rangeAbort=new AbortController(),probed=new Set<string>(),ranges:PreviewRangeResult[]=[];
    const pictures=new PreviewPictureSamples(),sourceIds=new WeakMap<HTMLVideoElement,number>();let nextSourceId=0;
    const sourceId=(node:HTMLVideoElement)=>{let id=sourceIds.get(node);if(id===undefined){id=nextSourceId++;sourceIds.set(node,id);}return id;};
    let last=begin,raf=0,finished=false,buffering=0,samples=0,activeVideoSamples=0;
    function sample(){
      samples++;
      const sources:PictureSourceSample[]=[],seen=new Set<HTMLVideoElement>();
      for(const track of Object.values(tracksOf(g!)))for(const clip of track.clips){
        const node=clip.node;if(!(node instanceof HTMLVideoElement))continue;
        if(seen.has(node))continue;seen.add(node);
        const observation=pictureSourceSample(node,sourceId(node));
        if(sources.length<=PICTURE_SOURCE_LIMIT){
          sources.push(observation);
        }
        const source=node.currentSrc||node.src;
        if(!probed.has(source)){probed.add(source);void probePreviewRange(source,document.baseURI,rangeAbort.signal).then(result=>{if(result&&!finished)ranges.push(result);});}
        if(!node.paused&&!node.ended)activeVideoSamples++;
        if(!node.paused&&!node.ended&&node.readyState<3)buffering++;
        if(observation.frames===null||observation.dropped===null)continue;
        let entry=videos.get(node);
        if(!entry){entry={total:observation.frames,dropped:observation.dropped,lastTotal:observation.frames,lastDropped:observation.dropped};videos.set(node,entry);}
        entry.lastTotal=observation.frames;entry.lastDropped=observation.dropped;
      }
      pictures.add(performance.now()-begin,g!.__previewTransport?.snapshot().seconds??null,sources,g!.__previewPictureStats?.(sourceId)??null);
    }
    function end(complete:boolean,reason='interrupted'){
      if(finished)return;finished=true;rangeAbort.abort();cancelAnimationFrame(raf);clearInterval(timer);clearTimeout(deadline);document.removeEventListener('visibilitychange',visibility);setSeconds(null);
      if(!complete){setMessage('Mesure interrompue. Relancez-la pendant la lecture, en gardant cet onglet visible.');return;}
      sample();gaps.sort((a,b)=>a-b);
      const long=gaps.filter(ms=>ms>80).length,p95=Math.round(gaps[Math.floor(gaps.length*.95)]||0);
      let total=0,dropped=0;for(const value of videos.values()){total+=Math.max(0,value.lastTotal-value.total);dropped+=Math.max(0,value.lastDropped-value.dropped);}
      const observed=total>0,pictureProgress=pictures.snapshot();
      setMessage(ranges.some(result=>result.partial===false)?'La lecture partielle d’un média de démonstration n’est pas confirmée par le serveur. Le déplacement dans la vidéo peut être incorrect ; copiez le bilan.':previewHealthMessage({longGaps:long,frames:total,dropped,buffering,activeVideoSamples,copyStalled:pictureProgress.copyStallSignals.length>0}));
      const bounds=g!.getBoundingClientRect(),scene=g!.scene?.container?.getBoundingClientRect();
      setReport(JSON.stringify({schema:9,appEntry:loadedStudioEntry(),template,format,previewRenderer:g!.__previewRenderer||'standard',previewRasterEdge:g!.__previewMediaEdge??null,mediaPlayback:g!.__previewPlaybackStats?.()??null,mediaPresentation:g!.__previewPresentationStats?.(begin)??null,pictureProgress,observationEnd:reason,rangeChecks:ranges,displaySize:[Math.round(bounds.width),Math.round(bounds.height)],sceneSize:scene?[Math.round(scene.width),Math.round(scene.height)]:null,openingMs:Math.round(loadMs),observationMs:Math.round(performance.now()-begin),uiRafP95Ms:p95,uiGapsOver80ms:long,videoCountersAvailable:videos.size>0,videoFramesObserved:observed,activeVideoSamples,videoFrames:total,videoDroppedFrames:dropped,bufferingObservations:buffering,samples},null,2));
    }
    const visibility=()=>{if(document.hidden)end(false);};
    const tick=()=>{const now=performance.now();gaps.push(now-last);last=now;raf=requestAnimationFrame(tick);};
    const timer=setInterval(()=>{sample();setSeconds(Math.min(15,Math.floor((performance.now()-begin)/1000)));},500),deadline=setTimeout(()=>end(true,'deadline'),15000);
    sample();document.addEventListener('visibilitychange',visibility);raf=requestAnimationFrame(tick);cancel.current=()=>end(false);
    // Short templates can end before 15 s. Keep their actual observation rather
    // than making the diagnostic impossible to complete on those templates.
    finishOnPause.current=()=>end(performance.now()-begin>=2000,'playback-stopped');
  }
  return <div className="preview-health"><button disabled={disabled||!playing||seconds!==null} onClick={start}>Tester la fluidité sur ce poste</button>{seconds!==null?<><progress aria-label="Mesure de fluidité" value={seconds} max={15}/><span role="status">Observation de la lecture · {seconds} / 15 s</span><button onClick={()=>cancel.current()}>Annuler</button></>:null}{message?<p role="status">{message}</p>:null}{report?<><button onClick={()=>void navigator.clipboard.writeText(report).then(()=>setCopied(true),()=>setMessage('Copie indisponible ; le bilan reste lisible ci-dessous.'))}>{copied?'Bilan copié':'Copier le bilan'}</button><details><summary>Détails de la mesure</summary><pre>{report}</pre></details></>:null}<p>À lancer pendant la lecture, jusqu’à 15 secondes. Mesure locale, sans envoi de fichiers ni de noms de médias.</p></div>;
}
