import {useEffect,useRef,useState} from 'react';
import {Trash2,AlertTriangle,ChevronRight,Folder,Image,UserRoundX,Check} from 'lucide-react';
import {api} from './api';
import type {Member} from './domain';
import type {MemberDeletionJob,MemberDeletionPreview,DeletionItem} from './member-deletion';
import './member-deletion.css';

export function MemberDeletion({target,onClose,onDone}:{target:Member;onClose:()=>void;onDone:()=>Promise<void>}){
  const dialog=useRef<HTMLDialogElement>(null),[preview,setPreview]=useState<MemberDeletionPreview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[typed,setTyped]=useState(''),[agreed,setAgreed]=useState(false),[job,setJob]=useState<MemberDeletionJob|null>(null),[done,setDone]=useState(false);
  const mounted=useRef(true);
  useEffect(()=>{const previous=document.activeElement;mounted.current=true;dialog.current?.showModal();void load();return()=>{mounted.current=false;if(previous instanceof HTMLElement)previous.focus();};},[]);
  async function load(){setBusy(true);setError('');setTyped('');setAgreed(false);setPreview(null);try{const state=await api.deletionStatus();if(!mounted.current)return;if(state.job){setJob(state.job);return;}if(!state.configured){setError('La suppression définitive attend l’activation de l’accès serveur Firebase. Aucun contenu ne sera effacé.');return;}const p=await api.deletionPreview(target.email);if(mounted.current)setPreview(p);}catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Bilan indisponible.');}finally{if(mounted.current)setBusy(false);}}
  async function advance(current:MemberDeletionJob){
    let next:MemberDeletionJob|null=current;
    // Every durable step can be safely retried after a lost response. The server
    // owns the work list, never the browser. Stop on error/unmount, not on a timer.
    while(next&&mounted.current){const result=await api.deletionContinue(next.id);next=result.job;if(mounted.current)setJob(next);}
    if(!next&&mounted.current){setDone(true);await onDone();}
  }
  async function confirm(){if(!preview||!agreed||typed.trim().toLowerCase()!==preview.impact.email)return;setBusy(true);setError('');try{const result=await api.deletionConfirm(preview.token,typed.trim());setJob(result.job);setPreview(null);await advance(result.job);}catch(e){setError(e instanceof Error?e.message:'Suppression non confirmée.');const state=await api.deletionStatus().catch(()=>null);if(state?.job)setJob(state.job);}finally{setBusy(false);}}
  async function resume(){if(!job)return;setBusy(true);setError('');try{await advance(job);}catch(e){setError(e instanceof Error?e.message:'Suppression à terminer.');}finally{setBusy(false);}}
  function items(title:string,rows:DeletionItem[],icon:'image'|'folder'='folder'){return <details className="deletion-group"><summary>{icon==='image'?<Image size={17} aria-hidden="true"/>:<Folder size={17} aria-hidden="true"/>}<span>{title}</span><strong>{rows.length}</strong><ChevronRight className="deletion-chevron" size={16} aria-hidden="true"/></summary>{rows.length?<ul>{rows.map(item=><li key={item.id}><strong>{item.name}</strong><small>{item.channel}</small></li>)}</ul>:<p className="muted small">Aucun contenu</p>}</details>;}
  return <dialog className="native-dialog member-deletion" ref={dialog} aria-labelledby="deletion-title" aria-busy={busy} onCancel={e=>{e.preventDefault();if(!busy)onClose();}}>
    <header className="deletion-heading"><span className="deletion-heading-icon">{done?<Check size={24} aria-hidden="true"/>:<UserRoundX size={24} aria-hidden="true"/>}</span><div><p className="eyebrow">SUPPRESSION DÉFINITIVE</p><h2 id="deletion-title">{done?'Suppression terminée':job?'Suppression à terminer':target.name}</h2><p className="deletion-email">{job?.email??target.email}</p></div></header>
    <div className="deletion-body">
      {error?<p className="notice error" role="alert">{error}</p>:null}
      {done?<p className="deletion-status" role="status">Le compte de connexion et ses contenus ont été supprimés de Graphics. Vous pouvez créer un nouvel accès avec cette adresse.</p>:job?<><p className="deletion-status" role="status">{job.identityDeleted?'Identité de connexion effacée.':'Accès et contenus retirés de Graphics.'} {job.mediaRemaining} fichier(s) à effacer du stockage.</p><p className="small">L’équipe peut continuer à travailler. Un administrateur peut reprendre ici en cas d’interruption. Cette adresse reste bloquée jusqu’à la fin ; les suppressions déjà réalisées ne peuvent pas être annulées.</p></>:preview?<>
        <div className="notice error deletion-warning"><AlertTriangle size={19} aria-hidden="true"/><p><strong>Cette suppression est définitive.</strong><span>Elle efface aussi les contenus partagés de ce membre.</span></p></div>
        <section className="deletion-inventory" aria-labelledby="deletion-inventory-title"><div className="deletion-section-heading"><h3 id="deletion-inventory-title">Contenus à supprimer</h3><button type="button" className="quiet" disabled={busy} onClick={()=>void load()}>Actualiser</button></div>
          <div className="deletion-groups">{items('Projets et leurs versions',preview.impact.projects)}{items('Médias importés',preview.impact.media,'image')}{items('Voix et fiches de préparation',preview.impact.profiles)}{items('Conducteurs, dossiers et règles',preview.impact.preparations)}{items('Fiches émission créées',preview.impact.programmes)}</div>
          <p className="small muted">{preview.impact.comments} commentaire(s) effacé(s) · {preview.impact.assignments} attribution(s) libérée(s).</p>
        </section>
        {preview.impact.affected.length?<section className="deletion-team-impact"><h3>Conséquences pour l’équipe</h3><p>Ces contenus d’autres membres restent, mais perdent un média, une fiche ou leur liaison de production :</p><ul>{preview.impact.affected.map(item=><li key={item.id}><strong>{item.name}</strong><small>{item.channel}</small></li>)}</ul></section>:null}
        <details className="deletion-scope"><summary>Étendue de la suppression<ChevronRight size={16} aria-hidden="true"/></summary><p>La suppression couvre toutes les chaînes. Les accès, sessions et références personnelles seront retirés. Les modifications des collègues sont conservées avec une attribution anonyme.</p><p>Les chaînes, les originaux sur disques, les copies téléchargées et les sauvegardes techniques ne sont pas effacés. Un compte neuf pourra être créé après la fin de l’effacement.</p></details>
        <section className="deletion-confirmation" aria-labelledby="deletion-confirmation-title"><h3 id="deletion-confirmation-title">Confirmer la suppression</h3><p className="small muted">Terminez les transferts en cours avant de confirmer.</p>
          <label className="check deletion-consent"><input type="checkbox" checked={agreed} disabled={busy} onChange={e=>setAgreed(e.target.checked)}/><span>J’ai vérifié les contenus et les conséquences pour l’équipe.</span></label>
          <label className="deletion-confirm-email">Recopiez l’adresse e-mail<input type="text" inputMode="email" autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={busy} value={typed} onChange={e=>setTyped(e.target.value)} /></label>
        </section>
      </>:busy?<p className="deletion-status" role="status">Vérification des contenus…</p>:<button type="button" onClick={()=>void load()}>Actualiser le bilan</button>}
    </div>
    <footer className="deletion-footer"><button type="button" disabled={busy} onClick={onClose}>{done?'Fermer':job?'Fermer et reprendre plus tard':'Annuler'}</button>{!done&&job?<button type="button" className="danger" disabled={busy} onClick={()=>void resume()}>{busy?'Suppression en cours…':'Terminer la suppression'}</button>:!done&&preview?<button type="button" className="danger" disabled={busy||!agreed||typed.trim().toLowerCase()!==preview.impact.email} onClick={()=>void confirm()}><Trash2 size={17} aria-hidden="true"/>{busy?'Confirmation…':'Supprimer définitivement'}</button>:null}</footer>
  </dialog>;
}
