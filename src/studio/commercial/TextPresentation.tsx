import {useEffect,useState} from 'react';
import {Layers} from 'lucide-react';
import type {CommercialData} from './model';
import {COMMERCIAL_MAX_TEXT_LINES,commercialTextSlots} from './model';
import {measureCommercialLayout} from './render';
import './text-presentation.css';

export function TextDistribution({data,page,disabled,onSplit}:{data:CommercialData;page:number;disabled:boolean;onSplit:()=>void}){
  const [measurement,setMeasurement]=useState<{data:CommercialData;page:number;issue:string;lines:number|null;maxLines:number}|null>(null);
  const [revision,setRevision]=useState(0);
  const slot=commercialTextSlots(data)[page]??commercialTextSlots(data)[0];
  useEffect(()=>{
    let current=true;
    const timer=setTimeout(()=>{
      void measureCommercialLayout(data).then(result=>{
        if(!current)return;
        const count=result.textLines.find(item=>item.index===slot.index);
        setMeasurement({data,page:slot.index,issue:result.errors.find(error=>error.startsWith(`${slot.label} :`))??'',lines:count?.lines??null,maxLines:count?.maxLines??COMMERCIAL_MAX_TEXT_LINES});
      }).catch(error=>{if(current)setMeasurement({data,page:slot.index,issue:error instanceof Error?error.message:'La lisibilité ne peut pas encore être vérifiée.',lines:null,maxLines:COMMERCIAL_MAX_TEXT_LINES});});
    },300);
    return()=>{current=false;clearTimeout(timer);};
  },[data,slot.index,slot.label,revision]);
  const current=measurement?.data===data&&measurement.page===slot.index?measurement:null;
  const overflow=current?.lines!==null&&current?.lines!==undefined&&current.lines>current.maxLines;
  return <div className="commercial-text-flow">
    <p id="commercial-body-lines" className={`commercial-line-count${overflow?' commercial-density-warning':''}`} role="status">{current?current.lines===null?'Nombre de lignes indisponible':`${current.lines} / ${current.maxLines} lignes à l’écran`:'Vérification des lignes à l’écran…'}</p>
    <p id="commercial-body-issue" className={current?.issue?'commercial-density-warning':undefined} role="status">{current?.issue??''}</p>
    {current?.lines===null?<button type="button" disabled={disabled} onClick={()=>{setMeasurement(null);setRevision(value=>value+1);}}>Vérifier les lignes</button>:null}
    {data.textMode?<details className="commercial-text-distribution">
      <summary>Plusieurs informations à afficher ?</summary>
      <p>Résumez d’abord. Si nécessaire, répartissez les informations sur des séquences de {COMMERCIAL_MAX_TEXT_LINES} lignes maximum.</p>
      <button type="button" disabled={disabled||!slot.page.body.trim()} onClick={onSplit}><Layers size={16} aria-hidden="true"/>Répartir le texte</button>
      <small>Les séquences sont ajoutées après celle-ci. Chaque mot est conservé.</small>
    </details>:null}
  </div>;
}
export default function TextPresentation({data,disabled,onMode}:{data:CommercialData;disabled:boolean;onMode:(mode:'summary'|'full')=>void}){
  return <section className="commercial-text-presentation" aria-label="Présentation des textes">
    <strong>Présentation de l’annonce</strong>
    <div className="commercial-text-mode-options" role="group" aria-label="Mode de texte">
      <button type="button" aria-pressed={data.textMode==='summary'} disabled={disabled} onClick={()=>onMode('summary')}><strong>Synthèse visuelle</strong><span>À privilégier</span></button>
      <button type="button" aria-pressed={data.textMode==='full'} disabled={disabled} onClick={()=>onMode('full')}><strong>Texte intégral</strong><span>{COMMERCIAL_MAX_TEXT_LINES} lignes par écran</span></button>
    </div>
    <p id="commercial-body-rule"><strong>Un titre court et {COMMERCIAL_MAX_TEXT_LINES} lignes de texte maximum.</strong> Une idée par séquence. Résumez au maximum ; la voix off porte les détails.</p>
    {data.textMode==='full'?<p>Le texte intégral doit être réparti sur plusieurs séquences, chacune limitée à {COMMERCIAL_MAX_TEXT_LINES} lignes.</p>:!data.textMode?<p>Présentation d’origine conservée. La limite de {COMMERCIAL_MAX_TEXT_LINES} lignes s’applique aussi à l’export de cette annonce.</p>:null}
  </section>;
}
