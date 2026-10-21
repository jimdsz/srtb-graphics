import {useEffect,useId,useRef,useState,useSyncExternalStore} from 'react';
import type {FieldValue} from './domain';
import {localMediaSnapshot,localURL,sameLocalMediaSource,subscribeLocalMedia} from './local-media';
import {frameTime,markedRange,mediaKind,timeLabel} from './media-trim';
import TimeRuler from './TimeRuler';
import Activity from './Activity';
import {sessionState} from './session-state';

interface Props {value:FieldValue;module:string;start:number;end:number;onChange:(range:{start:number;end:number})=>void;initiallyOpen?:boolean;explicitEnd?:boolean;onDuration?:(duration:number|null)=>void}

/** No whole-file fetch, canvas copy or thumbnail sweep. The browser seeks directly
 * in the original File/HTTP range source. Closing releases the decoder and buffers. */
export default function MediaTrim(props:Props){
  const {value}=props,kind=mediaKind(value),id=useId();
  const [open,setOpen]=useState(!!props.initiallyOpen);
  const identity=useRef<{source:string;key:string}|null>(null);
  useEffect(()=>{const close=(event:Event)=>{if((event as CustomEvent<string>).detail!==id)setOpen(false);};window.addEventListener('srtb-trim-open',close);return()=>window.removeEventListener('srtb-trim-open',close);},[id]);
  if(kind!=='video'&&kind!=='audio')return null;
  const url=typeof value==='object'?value.url:String(value);
  // A verified alias may resolve to another already-bound copy of the same
  // bytes. Keep the selected player even when its blob URL is different.
  if(!identity.current||!sameLocalMediaSource(identity.current.source,url))identity.current={source:url,key:url};
  else identity.current.source=url;
  return <div className="media-trim"><button type="button" aria-expanded={open} onClick={()=>{if(!open)window.dispatchEvent(new CustomEvent('srtb-trim-open',{detail:id}));setOpen(!open);}}>{open?'Fermer le lecteur':'Choisir un extrait visuellement'}</button>
    {open?<TrimPlayer key={identity.current.key} {...props} kind={kind}/>:null}
  </div>;
}
function TrimPlayer({value,module,start,end,onChange,kind,explicitEnd=false,onDuration}:Props&{kind:'video'|'audio'}){
  useSyncExternalStore(subscribeLocalMedia,localMediaSnapshot);
  const player=useRef<HTMLVideoElement|HTMLAudioElement|null>(null),selection=useRef(false),latest=useRef({start,end});latest.current={start,end};
  const [duration,setDuration]=useState(0),[position,setPosition]=useState(0),[error,setError]=useState(''),[waiting,setWaiting]=useState(true);
  const [jump,setJump]=useState('0'),[slow,setSlow]=useState(false);
  const durationCallback=useRef(onDuration),initialPosition=useRef(false);durationCallback.current=onDuration;
  const backing=useRef<{source:string;canonical:string;playback:string}|null>(null);
  let url='',sourceError='';
  try{
    const source=typeof value==='object'?value.url:String(value),canonical=localURL(source),previous=backing.current;
    // Preserve the original live blob across a verified reference promotion.
    // A later reconnection of the same reference with a new backing still loads.
    const alias=previous&&previous.source!==source&&sameLocalMediaSource(previous.source,source);
    const unchanged=previous&&previous.source===source&&previous.canonical===canonical;
    const playback=previous&&(alias||unchanged)?previous.playback:canonical;
    backing.current={source,canonical,playback};url=new URL(playback,new URL(module,document.baseURI)).href;
  }catch(e){backing.current=null;sourceError=e instanceof Error?e.message:String(e);}
  useEffect(()=>{
    setWaiting(true);setError('');setDuration(0);setSlow(false);initialPosition.current=false;durationCallback.current?.(null);
    const node=player.current;if(!node||!url)return;
    node.preload='metadata';node.muted=true;node.src=url;node.load();
    const timer=setTimeout(()=>setSlow(true),12000);
    return()=>{clearTimeout(timer);node.pause();node.removeAttribute('src');node.load();durationCallback.current?.(null);};
  },[url]);
  function seek(seconds:number){const node=player.current;if(!node||!duration||!Number.isFinite(seconds))return;selection.current=false;node.pause();node.currentTime=Math.max(0,Math.min(duration-.001,seconds));setPosition(node.currentTime);}
  function metadata(){const node=player.current!;if(!Number.isFinite(node.duration)||node.duration<=0){setError('Ce média n’a pas de durée lisible. Choisissez un fichier finalisé.');durationCallback.current?.(null);return;}setDuration(node.duration);setWaiting(false);durationCallback.current?.(node.duration);if(!initialPosition.current){initialPosition.current=true;if(latest.current.start<node.duration)node.currentTime=latest.current.start;}}
  function changed(){const node=player.current!;setPosition(node.currentTime);if(selection.current&&node.currentTime>=(latest.current.end||node.duration)){node.pause();selection.current=false;}}
  async function playSelection(){const node=player.current,allowed=sessionState.permission();if(!node||!allowed())return;try{node.pause();node.currentTime=start;selection.current=true;node.muted=false;await node.play();if(!allowed()){node.pause();selection.current=false;}}catch(e){selection.current=false;setError(e instanceof Error?e.message:String(e));}}
  function mark(which:'start'|'end'){const node=player.current;if(node&&duration)onChange(markedRange(which,node.currentTime,start,end,duration));}
  const events={controls:true,onLoadedMetadata:metadata,onDurationChange:metadata,onTimeUpdate:changed,onSeeking:()=>setWaiting(true),onSeeked:()=>{setWaiting(false);setPosition(player.current?.currentTime||0);},onError:()=>{setWaiting(false);durationCallback.current?.(null);setError('Le navigateur ne peut pas lire ce fichier. Vérifiez l’accès au disque réseau et le codec (MP4 H.264 ou WebM conseillé).');}};
  if(sourceError)return <small role="alert">{sourceError}</small>;
  return <section className="trim-player" aria-label="Lecteur de sélection d’extrait">
    {kind==='video'?<video ref={node=>{player.current=node;}} playsInline {...events}/>:<audio ref={node=>{player.current=node;}} {...events}/>}
    {error?<small role="alert">{error}</small>:<>
      <TimeRuler value={position} duration={duration} label="Position dans le fichier" onSeek={seek} selection={{start,end}}/>
      <div className="trim-jump"><label>Aller à (secondes)<input type="number" min="0" max={duration||86400} step="0.04" value={jump} onChange={event=>setJump(event.target.value)}/></label><button type="button" disabled={!duration} onClick={()=>seek(Number(jump))}>Aller</button></div>
      <div className="trim-buttons"><button type="button" disabled={!duration} onClick={()=>seek(frameTime(position-.04))}>−1 image</button><button type="button" disabled={!duration} onClick={()=>seek(frameTime(position+.04))}>+1 image</button></div>
      <div className="trim-buttons"><button type="button" disabled={!duration||waiting} onClick={()=>mark('start')}>Début ici</button><button type="button" disabled={!duration||waiting} onClick={()=>mark('end')}>Fin ici</button></div>
      {explicitEnd&&end===0?<p className="trim-range">Repère OUT de la BA non défini. Ce lecteur permet seulement d’écouter la source{duration?` · ${duration.toFixed(5)} s selon ses métadonnées`:''}. Utilisez la durée décodée pour sélectionner le fichier entier ; cette durée du lecteur n’est pas un repère validé.</p>:<p className="trim-range">Extrait : {timeLabel(start)} → {end?timeLabel(end):'fin du fichier'}{duration?' · '+Math.max(0,(end||duration)-start).toFixed(2)+' s':''}</p>}
      <button type="button" disabled={!duration||start>=duration||(end>0&&(end<=start||end>duration+.02))} onClick={()=>void playSelection()}>{explicitEnd&&end===0?'Écouter le fichier source':'Lire cet extrait'}</button>
      {waiting?<Activity label="Chargement du passage" detail={slow?'Sur un disque réseau, vérifiez que le lecteur est accessible.':undefined}/>:null}
      <small>Déplacez la tête de lecture, puis marquez le début et la fin. Les points sont conservés dans les réglages. Aucun média n’est envoyé.</small>
    </>}
  </section>;
}
