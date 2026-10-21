import {useState} from 'react';
import type {BroadcastTemplate,ProjectData} from './domain';
import {baTextDefaults,distributeTitle,titleLines} from './text-editing';
import {presentation} from './presentation';

export default function TextSettings({template,data,onChange,disabled}:{template:BroadcastTemplate;data:ProjectData;onChange:(patch:ProjectData)=>void;disabled:boolean}){
  const [proposal,setProposal]=useState<{source:string;lines:string[]}|null>(null);
  const [undo,setUndo]=useState<{before:ProjectData;after:ProjectData}|null>(null);
  if(template.id!=='BTV_BA_1P')return null;
  const lines=titleLines(data),signature=JSON.stringify(lines),social=presentation(data)!=='tv';
  const fresh=proposal?.source===signature;
  const canUndo=undo&&Object.entries(undo.after).every(([key,value])=>data[key]===value);
  function apply(patch:ProjectData){setUndo({before:Object.fromEntries(Object.keys(patch).map(key=>[key,data[key]??baTextDefaults[key]??''])),after:patch});onChange(patch);setProposal(null);}
  return <details className="field-section text-settings"><summary>Titre BA · répartition et réglages de groupe</summary>
    <fieldset disabled={disabled}>
      <p className="small muted">Ces réglages déplacent les groupes du titre TV. Pour la police ou le style d’une ligne, ouvrez « Mise en forme du texte » ci-dessus. Les dépassements sont des avertissements, sans blocage de l’aperçu ni de l’export.</p>
      {!social?<>{(['pack','body'] as const).map(scope=><div className="text-style-group" key={scope}>
        <strong>{scope==='pack'?'Carton final':'Titre pendant la bande-annonce'}</strong>
        <label>Taille · {Number(data[`_studio_ba_${scope}_scale`]??100)} %<input aria-label={scope==='pack'?'Taille du titre du carton final':'Taille du titre du corps'} type="range" min="20" max="200" step="1" value={Number(data[`_studio_ba_${scope}_scale`]??100)} onChange={e=>onChange({[`_studio_ba_${scope}_scale`]:Number(e.target.value)})}/></label>
        <div className="text-position">{(['x','y'] as const).map(axis=><label key={axis}>{axis==='x'?'Horizontal (px)':'Vertical (px)'}<input aria-label={`${scope==='pack'?'Carton':'Corps'} — ${axis==='x'?'position horizontale':'position verticale'}`} type="number" min={axis==='x'?-800:-500} max={axis==='x'?800:500} step="1" value={Number(data[`_studio_ba_${scope}_${axis}`]??0)} onChange={e=>onChange({[`_studio_ba_${scope}_${axis}`]:Number(e.target.value)})}/></label>)}</div>
      </div>)}<p className="small muted">100 % = taille du modèle. Une valeur plus petite réduit les lettres sans les étirer. Les déplacements peuvent sortir des marges : vérifiez le corps et le carton avec la réglette.</p>
      <button type="button" onClick={()=>apply({...baTextDefaults})}>Rétablir la mise en forme du modèle</button></>:<p className="small muted">En format social, le texte se répartit dans son cartouche. La position du bloc se règle dans Graphisme ; les tailles TV restent conservées.</p>}
      <div className="text-style-group"><strong>Proposer une autre répartition</strong><div className="row">{([2,3] as const).map(count=><button type="button" key={count} onClick={()=>setProposal({source:signature,lines:distributeTitle(lines,count)})}>Sur {count} lignes</button>)}</div>
      {proposal?<div className="text-proposal"><p className="small">Proposition — les mots restent inchangés</p><pre>{proposal.lines.filter(Boolean).join('\n')}</pre>{!fresh?<p role="status">Le titre a changé. Demandez une nouvelle proposition.</p>:<button type="button" onClick={()=>apply(Object.fromEntries(proposal.lines.map((line,i)=>[`_titre_ligne_${i+1}`,line])))}>Utiliser cette répartition</button>}<button type="button" onClick={()=>setProposal(null)}>Fermer la proposition</button></div>:null}
      </div>
      {canUndo?<button type="button" onClick={()=>{onChange(undo.before);setUndo(null);}}>Annuler la dernière proposition appliquée</button>:null}
      <p className="small muted">Les modifications s’affichent automatiquement dans l’aperçu. Relancez IN pour revoir l’animation complète. Le projet partagé ne change qu’à l’enregistrement.</p>
    </fieldset>
  </details>;
}
