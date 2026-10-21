import {Clock3} from 'lucide-react';
import {commercialTimeline,effectiveCommercialDuration,COMMERCIAL_DURATIONS} from './model';
import type {CommercialData} from './model';

export function durationLabel(seconds:number){
  const rounded=Math.max(0,Math.round(seconds*10)/10),minutes=Math.floor(rounded/60),remainder=Math.round((rounded-minutes*60)*10)/10;
  const value=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:1}).format(remainder);
  return minutes?`${minutes} min${remainder>=.05?` ${value} s`:''}`:`${value} s`;
}
export default function DurationSettings({data,onChange,disabled}:{data:CommercialData;onChange:(data:CommercialData)=>void;disabled:boolean}){
  const duration=effectiveCommercialDuration(data),automatic=!!data.voice,manualSequences=!!data.sequences&&data.sequenceTiming==='manual';
  const guideOnly=automatic||manualSequences;
  return <section className="commercial-duration" aria-label="Durée de l’annonce">
    <div className="commercial-duration-heading"><Clock3 size={19} aria-hidden="true"/><div><h2>Durée de l’annonce</h2><p>{manualSequences?'La voix off est conservée. Vérifiez que vos durées permettent de lire chaque écran.':data.textMode?'La durée couvre la voix off et laisse le temps de lire chaque écran.':automatic?'Calculée à partir de la voix off, avec ouverture et fin.':'Importez une voix off ou choisissez une durée totale.'}</p></div><output aria-label="Durée totale de l’annonce">{durationLabel(duration)}</output></div>
    <div className="commercial-duration-presets"><span>{automatic?'Repères pour vos prochains enregistrements':'Durées conseillées sans voix off'}</span><div>{COMMERCIAL_DURATIONS.map(seconds=>{
      const timeline=commercialTimeline(seconds),voiceSeconds=Math.floor(timeline.closingStart-timeline.firstStart);
      return guideOnly?<div key={seconds} className="commercial-duration-reference"><strong>{seconds} s</strong><small>Voix ≈ {voiceSeconds} s</small></div>:<button type="button" key={seconds} disabled={disabled} aria-pressed={data.duration===seconds} onClick={()=>onChange({...data,duration:seconds,durationMode:'manual'})}><strong>{seconds} s</strong><small>Voix ≈ {voiceSeconds} s</small></button>;
    })}</div></div>
    {!guideOnly?<details className="commercial-details"><summary>Définir une autre durée</summary><label className="commercial-custom-duration">Durée sans voix off (s)<input type="number" min="15" max="600" step="1" disabled={disabled} value={data.duration} onChange={e=>{const duration=Number(e.target.value);if(Number.isFinite(duration))onChange({...data,duration,durationMode:'manual'});}}/></label></details>:<small>{manualSequences?'Réglez les durées dans Déroulé de l’annonce. La vidéo conserve chaque séquence et la voix entière.':'La voix reste entière. Les repères de 60, 75 et 90 s ne limitent pas votre annonce.'}</small>}
  </section>;
}
