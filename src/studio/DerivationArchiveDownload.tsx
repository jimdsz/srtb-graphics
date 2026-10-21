import type {DerivationArchivePlan,DerivationArchiveState,DerivationArchiveDownloadLink} from './derivation-archive';
import {DERIVATION_MEMORY_LIMIT} from './derivation-archive';
import Activity from './Activity';

const size=(bytes:number)=>(bytes/1024**2).toLocaleString('fr-FR',{maximumFractionDigits:1})+' Mio';
export default function DerivationArchiveDownload({plan,reason,state,directSave,disabled,onDownload,onCancel,download}:{plan:DerivationArchivePlan|null;reason:string;state:DerivationArchiveState;directSave:boolean;disabled:boolean;onDownload:()=>void;onCancel:()=>void;download:DerivationArchiveDownloadLink|null}){
  const memoryTooLarge=!!plan&&!directSave&&plan.maxBytes>DERIVATION_MEMORY_LIMIT,progress=state.progress;
  return <section className="panel" aria-label="Télécharger les fichiers de l’ensemble" aria-busy={state.running}>
    <h3>Télécharger l’ensemble des fichiers calculés</h3>
    {plan?<p>{plan.complete?'Ensemble complet':'Archive partielle'} : <strong>{plan.files.length}/{plan.requestedCount} fichiers</strong> · {size(plan.sourceBytes)} de résultats. {plan.omitted.length?`${plan.omitted.length} sortie(s) non terminée(s) ne seront pas incluses. `:''}Les fichiers sont copiés sans réencodage ; leurs liens individuels restent disponibles.</p>:<p className="small">{reason}</p>}
    {!directSave?<p className={memoryTooLarge?'notice warning':'small'}>Ce navigateur prépare le ZIP en mémoire, limité à 128 Mio, inventaire inclus. {memoryTooLarge?'Pour cet ensemble, utilisez Chrome/Edge avec l’écriture directe sur disque ou les liens de téléchargement individuels.':'Pour les ensembles plus grands, utilisez l’écriture directe sur disque de Chrome/Edge.'}</p>:<p className="small">Écriture directe sur disque, sans chargement intégral en mémoire. Limite du ZIP : 3 Gio. Aucun envoi de fichier.</p>}
    <button type="button" className="primary" disabled={disabled||state.running||!plan||memoryTooLarge} onClick={onDownload}>Télécharger {plan?`les ${plan.files.length} fichiers${plan.complete?'':' terminés'}`:'l’ensemble'} (ZIP)</button>
    {state.running?<><Activity label={state.message} percent={progress&&state.phase!=='choosing'?state.phase==='complete'?100:Math.min(99,Math.floor(progress.copiedBytes/Math.max(1,progress.sourceBytes)*100)):undefined}/>{progress?<p className="small" role="status">Fichier {progress.fileIndex}/{progress.fileCount} · {size(progress.copiedBytes)} / {size(progress.sourceBytes)} copiés · ZIP {size(progress.writtenBytes)} écrit.</p>:null}<button type="button" disabled={state.phase==='committing'||state.phase==='complete'} onClick={onCancel}>{state.phase==='committing'?'Finalisation en cours…':'Annuler le ZIP — conserver les résultats'}</button></>:null}
    {!state.running&&state.message?<p role="status">{state.message}</p>:null}{state.error?<p className="notice error" role="alert">{state.error}</p>:null}
    {download?<><a className="button-link" href={download.url} download={download.filename}>Retélécharger le ZIP {download.complete?'complet':'partiel'} déjà préparé ({download.count}/{download.requestedCount} fichiers)</a>{plan&&download.count!==plan.files.length?<p className="small">Ce ZIP conserve les fichiers de sa préparation précédente. Utilisez le bouton de téléchargement groupé pour inclure les résultats calculés depuis.</p>:null}</>:null}
    <p className="small muted">L’inventaire du ZIP indique les sorties incluses et leurs empreintes SHA-256. Une archive partielle n’est jamais présentée comme la campagne complète.</p>
  </section>;
}
