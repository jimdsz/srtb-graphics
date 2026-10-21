import {useEffect,useId,useMemo,useRef,useState} from 'react';
import {Check,Image as ImageIcon,Monitor,RefreshCw,Upload} from 'lucide-react';
import type {Plan,PlannerRow} from './day-planner-model';
import type {ProfileAsset} from './preparation-profile-model';
import {profileAssetSchema,sharedProfileAsset} from './preparation-profile-model';
import {api} from './api';
import {beginLocalFile,connectedLocal,localURL} from './local-media';
import {readProgrammeResources} from './planner-programme-resources';
import {checkedLocalLogo,logoImageMime,readSharedLogo} from './planner-logo-selection';
import {reviewPlannerLogo} from './planner-logo-reuse';
import type {PlannerLogoReview} from './planner-logo-reuse';
import {plannerRecoveryFingerprint as fingerprint} from './planner-local-recovery-model';
import {activeChannelId} from './channel-context';
import PlannerSharedMedia from './PlannerSharedMedia';
import NewProjectDialog from './NewProjectDialog';
import Activity from './Activity';
import './planner-logo.css';

type Selection={asset:ProfileAsset;previewUrl:string;token:number}|{asset:null;token:number};
type Props={row:PlannerRow;onChange:(logo:ProfileAsset|null)=>void;onClose:()=>void;reuse?:{plan:Plan;context:string;onApply:(review:PlannerLogoReview,selectedIds:string[],replaceIds:string[])=>void}};
export default function PlannerLogoDialog({row,onChange,onClose,reuse}:Props){
 const id=useId(),[proposal,setProposal]=useState<ProfileAsset|null>(null),[proposalBusy,setProposalBusy]=useState(false),[proposalMessage,setProposalMessage]=useState(''),[retry,setRetry]=useState(0);
 const [selection,setSelection]=useState<Selection|null>(null),[confirmed,setConfirmed]=useState(false),[previewReady,setPreviewReady]=useState(false),[previewError,setPreviewError]=useState(false);
 const [busy,setBusy]=useState(''),[progress,setProgress]=useState<number>(),[error,setError]=useState(''),[failedURL,setFailedURL]=useState('');
 const [review,setReview]=useState<PlannerLogoReview|null>(null),[grouped,setGrouped]=useState(false),[selectedIds,setSelectedIds]=useState<string[]>([]),[replaceExisting,setReplaceExisting]=useState(false),[invalidContext,setInvalidContext]=useState(false);
 const work=useRef<AbortController|null>(null),active=useRef(true),version=useRef(0),selectedToken=useRef(0),latestRow=useRef(row.id),applied=useRef(false);
 const initial=useRef({channel:activeChannelId(),context:reuse?.context||''}),latest=useRef({row,reuse});latest.current={row,reuse};
 const proposalWork=useRef<AbortController|null>(null);
 function live(){return active.current&&initial.current.channel===activeChannelId()&&initial.current.context===(latest.current.reuse?.context||'');}
 const programmeContext=useRef('');programmeContext.current=JSON.stringify([row.programmeId,row.programmeRevision]);
 const previewHeading=useRef<HTMLHeadingElement|null>(null);
 latestRow.current=row.id;
 useEffect(()=>{active.current=true;const changed=()=>{work.current?.abort();proposalWork.current?.abort();setInvalidContext(true);setSelection(null);setProposal(null);setConfirmed(false);setBusy('');setProposalBusy(false);};window.addEventListener('srtb-channel-change',changed);return()=>{active.current=false;work.current?.abort();proposalWork.current?.abort();window.removeEventListener('srtb-channel-change',changed);};},[]);
 useEffect(()=>{if(initial.current.context===(reuse?.context||''))return;work.current?.abort();proposalWork.current?.abort();setInvalidContext(true);setSelection(null);setProposal(null);setConfirmed(false);setBusy('');setProposalBusy(false);},[reuse?.context]);
 useEffect(()=>{work.current?.abort();setSelection(null);setReview(null);setGrouped(false);setSelectedIds([]);setReplaceExisting(false);setConfirmed(false);setPreviewReady(false);setPreviewError(false);setError('');setFailedURL('');setBusy('');selectedToken.current=0;applied.current=false;},[row.id]);
 useEffect(()=>{
  const controller=new AbortController();proposalWork.current=controller;setProposal(null);setProposalMessage('');setConfirmed(false);
  if(!live()||invalidContext||!row.programmeId){setProposalBusy(false);return()=>controller.abort();}
  setProposalBusy(true);
  void (async()=>{
   const resources=await readProgrammeResources(row,api.programme,controller.signal);controller.signal.throwIfAborted();if(!live())return;
   if(resources.warning){setProposalMessage(resources.warning);return;}
   const url=resources.programme?.data.logo||'';
   if(!url){setProposalMessage('Aucun logo renseigné dans cette fiche émission.');return;}
   const asset=await readSharedLogo(url,api.mediaAsset,controller.signal);controller.signal.throwIfAborted();if(live())setProposal(asset);
  })().catch(cause=>{if(live()&&!controller.signal.aborted)setProposalMessage(cause instanceof Error?cause.message:String(cause));}).finally(()=>{if(live()&&!controller.signal.aborted)setProposalBusy(false);});
  return()=>controller.abort();
 },[row.id,row.programmeId,row.programmeRevision,retry,invalidContext]);
 useEffect(()=>{if(selection)previewHeading.current?.focus({preventScroll:true});},[selection?.token]);
 function choose(asset:ProfileAsset|null,reviewPlan=reuse?.plan){
  if(!live()||invalidContext)return;
  let nextReview:PlannerLogoReview|null=null;
  try{if(reviewPlan)nextReview=reviewPlannerLogo(reviewPlan,row.id,asset);}catch(cause){setError(cause instanceof Error?cause.message:String(cause));return;}
  const previewUrl=asset?localURL(asset.url):'';
  const token=++version.current;selectedToken.current=token;
  const next:Selection=asset?{asset,previewUrl,token}:{asset:null,token};
  setSelection(next);setReview(nextReview);setGrouped(false);setSelectedIds([row.id]);setReplaceExisting(false);setConfirmed(false);setPreviewReady(false);setPreviewError(false);setError('');setFailedURL('');applied.current=false;
 }
 async function readChoice(label:string,operation:(signal:AbortSignal)=>Promise<ProfileAsset>,url='',expectedProgramme?:string){
  if(!live()||invalidContext)return;
  work.current?.abort();const controller=new AbortController();work.current=controller;
  const snapshot=reuse?structuredClone(reuse.plan):undefined,rowSnapshot=fingerprint(row);
  const rowId=row.id;setBusy(label);setProgress(undefined);setError('');setFailedURL('');setConfirmed(false);
  try{
   const asset=await operation(controller.signal);controller.signal.throwIfAborted();
   if(!live()||work.current!==controller||latestRow.current!==rowId)return;
   if(expectedProgramme&&expectedProgramme!==programmeContext.current){setError('La fiche émission a changé pendant la vérification. Choisissez à nouveau le logo souhaité.');return;}
   if(rowSnapshot!==fingerprint(latest.current.row)){setError('Cette ligne a changé pendant la vérification. Vos retouches sont conservées ; choisissez à nouveau le logo.');return;}
   choose(asset,snapshot);
  }catch(cause){if(live()&&!controller.signal.aborted&&work.current===controller){setError(cause instanceof Error?cause.message:String(cause));setFailedURL(url);}}
  finally{if(live()&&work.current===controller){work.current=null;setBusy('');}}
 }
 function shared(url:string,fromProposal=false){void readChoice('Vérification du logo partagé',signal=>readSharedLogo(url,api.mediaAsset,signal),url,fromProposal?programmeContext.current:undefined);}
 function local(file:File){void readChoice('Vérification locale de l’image',async signal=>{
  const checked=await checkedLocalLogo(file,signal);
  const asset=await beginLocalFile(checked,value=>{if(active.current&&!signal.aborted)setProgress(value*100);},undefined,signal).verified;
  signal.throwIfAborted();return profileAssetSchema.parse(asset);
 });}
 function current(){
  if(!row.logo)return;
  if(sharedProfileAsset.test(row.logo.url)){shared(row.logo.url);return;}
  try{const asset=profileAssetSchema.parse(row.logo);if(!logoImageMime(asset.mimeType))throw Error('Le logo enregistré n’est pas une image PNG, JPEG ou WebP.');if(!connectedLocal(asset.url))throw Error('Ce logo local n’est pas relié sur ce poste. Choisissez le même fichier ci-dessous, puis vérifiez son aperçu.');choose(asset);}catch(cause){setError(cause instanceof Error?cause.message:String(cause));}
 }
 function close(){work.current?.abort();proposalWork.current?.abort();active.current=false;onClose();}
 const currentRows=useMemo(()=>new Map(reuse?.plan.rows.map(candidate=>[candidate.id,fingerprint(candidate)])||[]),[reuse?.plan.rows]);
 const reviewedRows=useMemo(()=>new Map(review?.rows.map(candidate=>[candidate.id,{fingerprint:fingerprint(candidate),logo:candidate.logo}])||[]),[review]);
 const contextInvalid=invalidContext||!live(),sourceChanged=!!review&&!!reuse&&(review.source!==reuse.plan.source||review.sourceHash!==reuse.plan.sourceHash||reviewedRows.get(row.id)?.fingerprint!==currentRows.get(row.id));
 const canConfirm=!!selection&&!busy&&!contextInvalid&&!sourceChanged&&(!selection.asset||previewReady&&!previewError);
 const chosen=grouped?selectedIds:[row.id],otherRows=review?.rows.slice(1)||[];
 const selectedSet=new Set(selectedIds);
 const changedRow=(candidate:PlannerRow)=>!!reuse&&reviewedRows.get(candidate.id)?.fingerprint!==currentRows.get(candidate.id);
 function save(){
  if(!selection||!canConfirm||!confirmed||applied.current||!live())return;
  applied.current=true;
  if(reuse&&review)reuse.onApply(review,chosen,grouped&&replaceExisting?chosen.filter(id=>id!==row.id):[]);
  else onChange(selection.asset);
  close();
 }
 return <NewProjectDialog labelledBy={`${id}-title`} busy={false} onClose={close}><div className="planner-logo-dialog">
  <header><p className="eyebrow">À faire / Logo de l’émission</p><h2 id={`${id}-title`} tabIndex={-1} data-dialog-autofocus>Logo facultatif</h2><p className="planner-logo-programme">{row.title}</p><p className="planner-logo-scope">Pour les nouveaux brouillons de cette émission, dans tous les formats retenus. Les projets existants et le semainier restent inchangés.</p></header>
  {contextInvalid?<p className="notice warning" role="alert">Le compte, la chaîne ou la préparation a changé. Fermez ce dialogue puis rouvrez le choix du logo dans le contexte actuel.</p>:null}
  {sourceChanged?<p className="notice warning" role="alert">Cette ligne a changé depuis la vérification. Vos retouches sont conservées. Choisissez à nouveau le logo avant de confirmer.</p>:null}
  {row.logo?<div className="planner-logo-current"><span><strong>Logo enregistré</strong><small>{row.logo.name}</small></span><div><button type="button" disabled={!!busy||contextInvalid} onClick={current}>Vérifier le logo enregistré</button><button type="button" disabled={!!busy||contextInvalid} onClick={()=>choose(null)}>Retirer le logo</button></div></div>:null}
  <section className="planner-logo-proposal" aria-label="Proposition de la fiche émission">
   {proposalBusy?<p role="status">Lecture du logo de la fiche…</p>:null}
   {proposal?<><p><strong>Logo de la fiche émission</strong><span>{proposal.name}</span></p><button type="button" disabled={!!busy||contextInvalid} onClick={()=>shared(proposal.url,true)}><ImageIcon size={17} aria-hidden="true"/>Voir le logo proposé</button></>:null}
   {proposalMessage?<p role="status">{proposalMessage}</p>:null}
   {proposalMessage&&row.programmeId?<button className="quiet" type="button" disabled={proposalBusy} onClick={()=>setRetry(value=>value+1)}><RefreshCw size={16} aria-hidden="true"/>Réessayer la proposition</button>:null}
  </section>
  {error?<div className="notice error" role="alert"><p>{error}</p>{failedURL?<button type="button" disabled={!!busy} onClick={()=>shared(failedURL)}>Réessayer ce choix</button>:null}</div>:null}
  {busy?<div className="planner-logo-busy"><Activity label={busy} percent={progress}/><button type="button" onClick={()=>work.current?.abort()}>Arrêter la vérification</button></div>:null}
  <fieldset className="planner-logo-choices" disabled={!!busy||contextInvalid}>
   <label className="planner-file-button planner-local-file"><span><Monitor size={22} strokeWidth={1.5} aria-hidden="true"/><span><strong>Choisir une image sur ce poste</strong><small>PNG, JPEG, WebP · 20 Mo maximum · aucun envoi</small></span><Upload size={18} aria-hidden="true"/></span><input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Choisir une image sur ce poste" onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)local(file);}}/></label>
   <PlannerSharedMedia imageOnly selectedUrl={selection?.asset?.url} onSelect={asset=>shared(asset.url)}/>
  </fieldset>
  {selection?<section className="planner-logo-review" aria-labelledby={`${id}-review`}><h3 id={`${id}-review`} ref={previewHeading} tabIndex={-1}>{selection.asset?'Vérifier le logo':'Retrait du logo'}</h3>
   {selection.asset?<><p className="planner-logo-filename">{selection.asset.name}</p><div className="planner-logo-preview"><img key={selection.token} src={selection.previewUrl} alt="Logo sélectionné" onLoad={event=>{if(selectedToken.current===selection.token){const ready=event.currentTarget.naturalWidth>0&&event.currentTarget.naturalHeight>0;setPreviewReady(ready);setPreviewError(!ready);}}} onError={()=>{if(selectedToken.current===selection.token){setPreviewReady(false);setPreviewError(true);setConfirmed(false);}}}/></div>{previewError?<p className="notice warning" role="alert">L’image n’a pas pu être affichée. Votre logo enregistré reste inchangé. <button type="button" disabled={!!busy} onClick={()=>choose(selection.asset)}>Recharger l’aperçu</button></p>:!previewReady?<p role="status" className="small muted">Chargement de l’aperçu…</p>:null}<p className="small muted">Ce logo sera un élément modifiable dans chaque nouveau projet. Aucun fichier local n’est envoyé : sur un autre poste, resélectionnez ce fichier. Un lien dans le catalogue n’autorise pas l’accès au disque.</p></>:<p>Les prochains brouillons de cette ligne seront créés sans logo d’émission. Aucun ancien projet ne sera modifié.</p>}
   <label className="planner-logo-confirm"><input type="checkbox" checked={confirmed} disabled={!canConfirm} onChange={event=>setConfirmed(event.target.checked)}/><span>{selection.asset?'J’ai vérifié ce logo pour cette émission.':'Je confirme le retrait du logo pour les nouveaux brouillons.'}</span></label>
   {selection.asset&&review&&otherRows.length?<fieldset className="planner-logo-reuse" disabled={!canConfirm}>
    <legend>Appliquer dans cette préparation</legend>
    <p className="small muted">Cette ligne uniquement par défaut. Modifie la préparation, pas les projets existants. Aucun enregistrement partagé.</p>
    <label className="planner-logo-confirm"><input type="checkbox" checked={grouped} onChange={event=>{setGrouped(event.target.checked);setSelectedIds([row.id]);setReplaceExisting(false);}}/><span>Autres occurrences de cette fiche</span></label>
    {grouped?<><p className="small muted">{review.rows.length} lignes liées à la même fiche. Les titres peuvent différer ; les autres fiches et lignes retirées ou écartées sont exclues.</p>
     <div className="planner-logo-reuse-actions"><button type="button" onClick={()=>setSelectedIds([row.id,...otherRows.filter(candidate=>!candidate.logo&&!changedRow(candidate)).map(candidate=>candidate.id)])}>Sélectionner les lignes sans logo</button><button type="button" className="quiet" onClick={()=>setSelectedIds([row.id])}>Garder cette ligne seule</button></div>
     {otherRows.some(candidate=>candidate.logo)?<label className="planner-logo-confirm"><input type="checkbox" checked={replaceExisting} onChange={event=>{setReplaceExisting(event.target.checked);if(!event.target.checked)setSelectedIds(ids=>ids.filter(id=>id===row.id||!reviewedRows.get(id)?.logo));}}/><span>Autoriser le remplacement des logos déjà renseignés<small>Puis choisir chaque ligne concernée ci-dessous.</small></span></label>:null}
     <div className="planner-logo-occurrences" role="group" aria-label="Lignes proposées pour ce logo" tabIndex={0}>{review.rows.map(candidate=>{
      const source=candidate.id===row.id,stale=changedRow(candidate),protectedLogo=!source&&!!candidate.logo&&!replaceExisting;
      return <label key={candidate.id} className="planner-logo-occurrence"><input type="checkbox" aria-label={`${candidate.airDate} ${candidate.time} · ${candidate.title}${candidate.subtitle?` · ${candidate.subtitle}`:''}`} checked={source||selectedSet.has(candidate.id)} disabled={source||stale||protectedLogo} onChange={event=>setSelectedIds(ids=>event.target.checked?[...ids,candidate.id]:ids.filter(id=>id!==candidate.id))}/><span><strong>{candidate.title||'Sans titre'}{source?' · ligne ouverte':''}</strong><span>{candidate.airDate} · {candidate.time||'Horaire à préciser'}{candidate.subtitle?` · ${candidate.subtitle}`:''}</span><small>{stale?'Modifiée depuis la revue · conservée':candidate.logo?`Logo actuel : ${candidate.logo.name}${protectedLogo?' · protégé':''}`:'Sans logo'}{candidate.programmeRevision?` · fiche r${candidate.programmeRevision}`:''}</small></span></label>;
     })}</div>
     <p className="small" role="status">{chosen.length} {chosen.length>1?'lignes sélectionnées':'ligne sélectionnée'}. Les lignes modifiées depuis cette revue seront conservées sans changement.</p>
    </>:null}
   </fieldset>:null}
  </section>:null}
  <div className="planner-logo-footer"><button type="button" className="primary" disabled={!canConfirm||!confirmed} onClick={save}><Check size={17} aria-hidden="true"/>{selection&&!selection.asset?'Confirmer le retrait':grouped?`Appliquer à ${chosen.length} lignes`:'Utiliser ce logo'}</button><button type="button" onClick={close}>Annuler</button></div>
 </div></NewProjectDialog>;
}
