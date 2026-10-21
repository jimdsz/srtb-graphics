import type {CommercialAudio} from './model';

export default function AudioSettings({label,value,onChange,music=false}:{label:string;value:CommercialAudio;onChange:(value:CommercialAudio)=>void;music?:boolean}){
  const display=(n:number)=>Number(n.toFixed(3));
  const excerpt=Math.max(0,(value.end||value.duration)-value.start);
  function number(key:keyof CommercialAudio,input:string){const n=Number(input);if(Number.isFinite(n))onChange({...value,[key]:n});}
  return <div className="commercial-audio-settings">
    <label>Volume {label.toLowerCase()} · {Math.round(value.volume*100)} %<input type="range" min="0" max="2" step="0.01" aria-label={`Volume ${label.toLowerCase()}`} value={value.volume} onChange={e=>number('volume',e.target.value)}/></label>
    {music?<label className="commercial-check"><input type="checkbox" checked={value.loop} onChange={e=>onChange({...value,loop:e.target.checked})}/>Répéter la musique jusqu’à la fin</label>:<p className="commercial-hint">Extrait utilisé : {new Intl.NumberFormat('fr-FR',{maximumFractionDigits:1}).format(excerpt)} s. La durée de l’annonce s’adapte à cet enregistrement.</p>}
    <details className="commercial-details"><summary>Découpage, départ et fondus</summary><div className="commercial-details-content">
      <div className="commercial-pair"><label>Début de l’extrait (s)<input aria-label={`Début extrait ${label}`} type="number" min="0" max={value.duration} step="0.1" value={display(value.start)} onChange={e=>number('start',e.target.value)}/></label><label>Fin de l’extrait (s)<input aria-label={`Fin extrait ${label}`} type="number" min="0" max={value.duration} step="0.1" value={display(value.end||value.duration)} onChange={e=>number('end',e.target.value)}/></label></div>
      <label>Départ dans l’annonce (s)<input aria-label={`Départ ${label}`} type="number" min="0" max="595" step="0.1" value={display(value.delay)} onChange={e=>number('delay',e.target.value)}/></label>
      <div className="commercial-pair"><label>Fondu d’entrée (s)<input aria-label={`Fondu entrée ${label}`} type="number" min="0" max="10" step="0.1" value={display(value.fadeIn)} onChange={e=>number('fadeIn',e.target.value)}/></label><label>Fondu de sortie (s)<input aria-label={`Fondu sortie ${label}`} type="number" min="0" max="10" step="0.1" value={display(value.fadeOut)} onChange={e=>number('fadeOut',e.target.value)}/></label></div>
    </div></details>
  </div>;
}
