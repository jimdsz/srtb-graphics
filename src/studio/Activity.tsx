import {useEffect,useState} from 'react';
import ProgressGauge from './ui/ProgressGauge';
import BusyIndicator from './ui/BusyIndicator';

/** Elapsed time is measured, percentages are supplied only by real completed work. */
export default function Activity({label,percent,detail}:{label:string;percent?:number;detail?:string}){
  const [started]=useState(()=>Date.now()),[elapsed,setElapsed]=useState(0);
  const [showIndicator,setShowIndicator]=useState(false);
  useEffect(()=>{const timer=setTimeout(()=>setShowIndicator(true),300);return()=>clearTimeout(timer);},[]);
  useEffect(()=>{const timer=setInterval(()=>setElapsed(Math.floor((Date.now()-started)/1000)),1000);return()=>clearInterval(timer);},[started]);
  return <div className="activity" aria-busy="true"><div className="activity-heading"><span className="activity-indicator" aria-hidden="true">{showIndicator?<BusyIndicator/>:null}</span><strong role="status">{label}</strong><span className="activity-elapsed" aria-label={`Temps écoulé : ${elapsed} secondes`}>{elapsed<60?`${elapsed} s`:`${Math.floor(elapsed/60)} min ${elapsed%60} s`}</span></div>{percent!==undefined?<ProgressGauge value={percent} label={label}/>:null}{detail?<details className="activity-detail"><summary>Détails du traitement</summary><p className="small muted">{detail}</p></details>:null}</div>;
}
