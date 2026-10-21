import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {frameTime,timeLabel} from './media-trim';
export default function TimeRuler({value,duration,onSeek,disabled=false,label='Position dans l’aperçu',selection,phase,playing=false}:{value:number;duration:number;onSeek:(value:number)=>void;disabled?:boolean;label?:string;selection?:{start:number;end:number};phase?:string;playing?:boolean}){
  const [draft,setDraft]=useState(value),[dragging,setDragging]=useState(false),pending=useRef<number|null>(null),limit=Math.max(0,(Number.isFinite(duration)?duration:0)-.04);
  useEffect(()=>{if(!dragging)setDraft(value);},[value,dragging]);
  const commit=()=>{if(pending.current===null)return;const next=pending.current;pending.current=null;setDragging(false);onSeek(Math.max(0,Math.min(limit,frameTime(next))));};
  const current=Math.max(0,Math.min(limit||1,dragging?draft:value));
  return <div className="time-ruler"><div className="time-ruler-label">{phase?<span className={`timeline-phase ${playing?'is-playing':''}`}><i aria-hidden="true"/>{phase}</span>:<strong>{label}</strong>}<output aria-label="Temps de l’aperçu">{timeLabel(dragging?draft:value)} <span>/ {duration?timeLabel(duration):'—'}</span></output></div><div className="time-ruler-track" style={{'--timeline-progress':`${100*current/(limit||1)}%`} as CSSProperties}>
    {selection&&duration>0?<span className="time-selection" style={{left:100*selection.start/duration+'%',width:100*Math.max(0,(selection.end||duration)-selection.start)/duration+'%'}}/>:null}
    <input aria-label={label} aria-valuetext={timeLabel(dragging?draft:value)} type="range" min="0" max={limit||1} step=".04" value={current} disabled={disabled||!duration} onChange={e=>{const next=Number(e.target.value);pending.current=next;setDragging(true);setDraft(next);}} onPointerUp={commit} onPointerCancel={()=>{pending.current=null;setDragging(false);}} onKeyUp={commit} onBlur={commit}/></div>
    <div className="time-ruler-ticks" aria-hidden="true">{[0,.25,.5,.75,1].map(f=><span key={f}>{timeLabel(duration*f)}</span>)}</div>
  </div>;
}
