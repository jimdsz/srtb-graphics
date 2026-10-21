import {Component,lazy,Suspense,useCallback,useEffect,useId,useRef,useState,useSyncExternalStore} from 'react';
import type {ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {Check,Download,ListVideo,RotateCcw,ScanEye,Trash2,X} from 'lucide-react';
import {exportQueue} from './export-queue';
import './export-queue.css';

const ExportReport=lazy(()=>import('./VideoExport').then(module=>({default:module.ExportReport})));
const ExportReview=lazy(()=>import('./ExportReview'));
type ExportJob=ReturnType<typeof exportQueue.snapshot>['items'][number];
type Action='cancel'|'remove'|'retry';
const labels:Record<ExportJob['status'],string>={pending:'En attente',checking:'Vérification',rendering:'Calcul en cours',completed:'Fichier prêt',failed:'Échec',cancelled:'Annulé'};
const formats:Record<ExportJob['format'],string>={mp4:'MP4',mov:'MOV · ProRes 4444',png:'Séquence PNG · ZIP',alpha:'WebM · alpha'};
const inProgress=(job:ExportJob)=>job.status==='pending'||job.status==='checking'||job.status==='rendering';

class DetailBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?<p className="export-queue-error" role="alert">Ces détails ne peuvent pas être affichés. Le fichier reste téléchargeable.</p>:this.props.children;}
}

function FileReport({job}:{job:ExportJob}){
  const [open,setOpen]=useState(false);
  if(!job.result)return null;
  return <details className="export-queue-report" onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary>Rapport du fichier</summary>
    {open?<DetailBoundary><Suspense fallback={<p role="status">Ouverture du rapport…</p>}><ExportReport report={job.result.report}/></Suspense></DetailBoundary>:null}
  </details>;
}

/** A session-level view only: hiding it never cancels work or releases a result. */
export default function ExportQueuePanel(){
  const snapshot=useSyncExternalStore(exportQueue.subscribe,exportQueue.snapshot,exportQueue.snapshot);
  const [open,setOpen]=useState(false),[reviewId,setReviewId]=useState<string|null>(null);
  const [pending,setPending]=useState<ReadonlySet<string>>(new Set()),[errors,setErrors]=useState<Record<string,string>>({});
  const trigger=useRef<HTMLButtonElement>(null),heading=useRef<HTMLHeadingElement>(null),panel=useRef<HTMLElement>(null);
  const returnFocus=useRef<HTMLElement|null>(null),opened=useRef(false),mounted=useRef(false),actions=useRef(new Set<string>());
  const actionFocus=useRef<{jobId:string;node:Element}|null>(null);
  const panelId=useId(),headingId=useId(),noteId=useId();

  const close=useCallback((restore=true)=>{
    opened.current=false;setOpen(false);setReviewId(null);
    if(restore)(returnFocus.current?.isConnected?returnFocus.current:trigger.current)?.focus({preventScroll:true});
  },[]);
  const show=useCallback(()=>{
    if(opened.current){heading.current?.focus({preventScroll:true});return;}
    returnFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    opened.current=true;setOpen(true);
  },[]);

  useEffect(()=>{
    mounted.current=true;
    window.addEventListener('srtb-export-queue-open',show);
    return()=>{mounted.current=false;window.removeEventListener('srtb-export-queue-open',show);};
  },[show]);
  useEffect(()=>{
    if(!open)return;
    heading.current?.focus({preventScroll:true});
    const escape=(event:KeyboardEvent)=>{
      // Another dialog owns Escape when it is open above this non-modal region.
      if(event.key!=='Escape'||event.defaultPrevented||document.querySelector('dialog:modal')||Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).some(dialog=>dialog.getClientRects().length))return;
      const restore=!!panel.current?.contains(document.activeElement)||document.activeElement===trigger.current;
      event.preventDefault();close(restore);
    };
    document.addEventListener('keydown',escape);
    return()=>document.removeEventListener('keydown',escape);
  },[open,close]);
  useEffect(()=>{
    if(snapshot.running||!snapshot.items.some(job=>job.id===reviewId&&job.result))setReviewId(null);
  },[snapshot.running,snapshot.items,reviewId]);
  useEffect(()=>{
    const target=actionFocus.current;
    if(!target)return;
    if(!opened.current){actionFocus.current=null;return;}
    if(target.node.isConnected){
      if(document.activeElement!==target.node&&document.activeElement!==document.body)actionFocus.current=null;
      return;
    }
    if(document.activeElement!==document.body){actionFocus.current=null;return;}
    if(pending.has(target.jobId))return;
    const row=Array.from(panel.current?.querySelectorAll<HTMLElement>('[data-export-job]')||[]).find(node=>node.dataset.exportJob===target.jobId);
    (row?.querySelector<HTMLElement>('button:not(:disabled),a[download],summary')||heading.current)?.focus({preventScroll:false});
    actionFocus.current=null;
  },[snapshot.items,pending]);

  async function act(job:ExportJob,action:Action){
    if(actions.current.has(job.id))return;
    const previousFocus=document.activeElement;
    actionFocus.current=previousFocus&&panel.current?.contains(previousFocus)?{jobId:job.id,node:previousFocus}:null;
    actions.current.add(job.id);setPending(new Set(actions.current));
    setErrors(current=>({...current,[job.id]:''}));
    if(action==='remove'&&reviewId===job.id)setReviewId(null);
    try{
      await exportQueue[action](job.id);
    }catch(error){
      if(mounted.current)setErrors(current=>({...current,[job.id]:error instanceof Error?error.message:'Cette action n’a pas abouti. Réessayez.'}));
    }finally{
      actions.current.delete(job.id);
      if(mounted.current)setPending(new Set(actions.current));
    }
  }

  const waiting=snapshot.items.filter(job=>job.status==='pending').length;
  const ready=snapshot.items.filter(job=>job.status==='completed'&&job.result).length;
  const failed=snapshot.items.filter(job=>job.status==='failed').length;
  const current=snapshot.items.find(job=>job.status==='checking'||job.status==='rendering');
  const summary=snapshot.items.length?`${current?labels[current.status]+'. ':''}${waiting} en attente · ${ready} fichier${ready>1?'s':''} prêt${ready>1?'s':''}${failed?` · ${failed} en échec`:''}`:'';

  return <>
    <button type="button" className="export-queue-trigger" ref={trigger} aria-label={`Exports · ${snapshot.items.length} dans la file`} aria-expanded={open} aria-controls={panelId} onClick={()=>open?close():show()}>
      <ListVideo size={18} aria-hidden="true"/><span>Exports</span>
      {snapshot.items.length?<span className="export-queue-count" data-running={snapshot.running||undefined} aria-hidden="true">{snapshot.items.length}</span>:null}
    </button>
    <span className="export-queue-announcement" role="status" aria-live="polite" aria-atomic="true">{summary}</span>
    {open?createPortal(<aside id={panelId} ref={panel} className="export-queue-panel" aria-labelledby={headingId} aria-describedby={noteId} role="region">
      <header className="export-queue-heading">
        <div><h2 id={headingId} ref={heading} tabIndex={-1}>File d’exports</h2><p>Calcul local · cet onglet</p></div>
        <button type="button" className="export-queue-close" aria-label="Fermer la file d’exports" onClick={()=>close()}><X size={19} aria-hidden="true"/></button>
      </header>
      <div className="export-queue-scroll">
        <p id={noteId} className="export-queue-note">Vous pouvez continuer dans Graphics. Gardez cet onglet ouvert : la file et ses fichiers ne sont pas repris après fermeture.</p>
        {snapshot.items.length?<>
          <p className="export-queue-summary">{summary}</p>
          <ol className="export-queue-list">{snapshot.items.map(job=>{
            const working=inProgress(job),busy=pending.has(job.id),result=job.status==='completed'?job.result:undefined;
            const percent=Number.isFinite(job.progress.percent)?Math.max(0,Math.min(100,job.progress.percent)):undefined;
            const reviewing=reviewId===job.id&&!snapshot.running&&!!result;
            return <li key={job.id} className="export-queue-item" data-status={job.status} data-export-job={job.id}>
              <div className="export-queue-item-heading"><h3>{job.title||'Projet sans titre'}</h3><span className="export-queue-state">{job.status==='completed'?<Check size={13} aria-hidden="true"/>:null}{labels[job.status]}</span></div>
              <p className="export-queue-meta">{formats[job.format]} · {job.composition}</p>
              {job.unsaved?<p className="export-queue-unsaved">Avec les retouches non enregistrées au lancement</p>:null}
              {job.status==='checking'||job.status==='rendering'?<div className="export-queue-progress">
                <p>{job.progress.message||labels[job.status]}{job.status==='rendering'&&percent!==undefined?<span>{Math.round(percent)} %</span>:null}</p>
                <progress max={100} value={job.status==='rendering'?percent:undefined} aria-label={`${labels[job.status]} · ${job.title}`}/>
              </div>:null}
              {job.error?<p className="export-queue-error">{job.error}</p>:null}
              <div className="export-queue-actions">
                {working?<button type="button" disabled={busy} onClick={()=>void act(job,'cancel')}><X size={15} aria-hidden="true"/>Annuler</button>:null}
                {result?<a className="button-link export-queue-download" href={result.url} download={result.filename}><Download size={15} aria-hidden="true"/>Télécharger</a>:null}
                {job.status==='failed'||job.status==='cancelled'?<button type="button" disabled={busy} onClick={()=>void act(job,'retry')}><RotateCcw size={15} aria-hidden="true"/>Réessayer</button>:null}
                {!working?<button type="button" disabled={busy} title="Retirer de la file et libérer le fichier temporaire. Les projets et les fichiers déjà téléchargés restent intacts." onClick={()=>void act(job,'remove')}><Trash2 size={15} aria-hidden="true"/>Retirer</button>:null}
              </div>
              {errors[job.id]?<p className="export-queue-error" role="alert">{errors[job.id]}</p>:null}
              {result?<>
                <p className="export-queue-temporary">Fichier temporaire. « Retirer » ne touche ni au projet ni à vos téléchargements.</p>
                <FileReport job={job}/>
                {job.format!=='png'?<>
                  <button type="button" className="export-queue-review-button" disabled={snapshot.running||busy} aria-expanded={reviewing} onClick={()=>setReviewId(reviewing?null:job.id)}><ScanEye size={15} aria-hidden="true"/>{reviewing?'Fermer le contrôle':'Contrôler le fichier'}</button>
                  {snapshot.running?<p className="export-queue-temporary">Contrôle disponible après le calcul en cours.</p>:null}
                  {reviewing?<DetailBoundary key={job.id}><Suspense fallback={<p role="status">Ouverture du contrôle…</p>}><ExportReview blob={result.blob} duration={result.report.duration}/></Suspense></DetailBoundary>:null}
                </>:null}
              </>:null}
              <details className="export-queue-origin"><summary>Réglages au lancement</summary><dl>
                <div><dt>Version</dt><dd>r{job.revision}{job.unsaved?' + retouches non enregistrées':''}</dd></div>
                <div><dt>Chaîne</dt><dd>{job.channelId}</dd></div>
              </dl><p>Les modifications suivantes du projet ne changent pas cet export.</p></details>
            </li>;
          })}</ol>
        </>:<div className="export-queue-empty"><h3>Aucun export dans la file</h3><p>Ajoutez un export depuis un projet.</p></div>}
      </div>
    </aside>,document.body):null}
  </>;
}
