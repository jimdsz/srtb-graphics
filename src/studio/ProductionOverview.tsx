import {useEffect,useId,useRef,useState} from 'react';
import {ArrowRight,RefreshCw} from 'lucide-react';
import {plannerAPI} from './day-planner-api';
import {dateSchema,plannerLabels} from './day-planner-model';
import type {ProductionOverviewItem,ProductionOverviewPage,ProductionOverviewView} from './production-overview-model';
import {searchRead} from './planner-team-search';
import './production-overview.css';

const views:{id:ProductionOverviewView;label:string;description:string;empty:string}[]=[
 {id:'mine',label:'Mes tâches',description:'Vos tâches attribuées pour ce jour du conducteur.',empty:'Aucune tâche ne vous est attribuée pour ce jour.'},
 {id:'missing-media',label:'Médias à choisir',description:'Lignes retenues sans média sélectionné. L’accès aux fichiers sur ce poste n’est pas vérifié ici.',empty:'Aucune ligne sans média sélectionné pour ce jour.'},
 {id:'review',label:'À valider',description:'Versions soumises auxquelles vous avez accès pour ce jour.',empty:'Aucune version soumise accessible pour ce jour.'},
];
const stateLabels:Record<string,string>={assigned:'Attribué',draft:'Brouillon',submitted:'À valider',approved:'Validé',rejected:'À corriger',archived:'Archivé','missing-media':'Média à choisir'};
const formats={tv:'TV · 16:9',portrait:'Portrait · 4:5',vertical:'Vertical · 9:16'};
const dateLabel=new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'short',timeZone:'UTC'});
function localToday(){const value=new Date();return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;}

export default function ProductionOverview({onOpenPlanner,onOpenItem,onOpenProject,busy=false,reviewer=false}:{onOpenPlanner:()=>void;onOpenItem:(item:ProductionOverviewItem)=>void;onOpenProject:(id:string)=>void;busy?:boolean;reviewer?:boolean}){
 const [view,setView]=useState<ProductionOverviewView>(reviewer?'review':'mine'),[date,setDate]=useState(localToday);
 const [result,setResult]=useState<ProductionOverviewPage|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const [retry,setRetry]=useState(0),[cursor,setCursor]=useState<string|null>(null);
 const read=useRef<AbortController|null>(null),firstNew=useRef<HTMLButtonElement|null>(null),readSummary=useRef<HTMLParagraphElement|null>(null),[newId,setNewId]=useState<string|null>(null);
 const heading=useId(),description=useId();
 const current=views.find(item=>item.id===view)!;
 const validDate=dateSchema.safeParse(date).success;
 const matching=result?.view===view&&result.date===date?result:null;
 useEffect(()=>{
  const controller=new AbortController();read.current=controller;setError('');setNewId(null);
  if(!dateSchema.safeParse(date).success){setLoading(false);return()=>controller.abort();}
  setLoading(true);
  void searchRead(signal=>plannerAPI.overview(view,date,cursor||undefined,signal),controller.signal,20000,'La vue ne répond pas. Réessayez ; aucune préparation n’a été modifiée.').then(page=>{
   controller.signal.throwIfAborted();
   if(page.view!==view||page.date!==date)throw Error('La réponse ne correspond pas à cette vue. Actualisez la liste.');
   setResult(previous=>{
    if(!cursor||previous?.view!==view||previous.date!==date)return page;
    const known=new Set(previous.items.map(item=>item.id));
    const added=page.items.filter(item=>!known.has(item.id));
    return {...page,items:[...previous.items,...added]};
   });
   if(cursor)setNewId(page.items.find(item=>!matching?.items.some(previous=>previous.id===item.id))?.id??'summary');
  }).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:String(cause));}).finally(()=>{if(read.current===controller&&!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[view,date,cursor,retry]);
 useEffect(()=>{if(newId)(newId==='summary'?readSummary.current:firstNew.current)?.focus({preventScroll:true});},[newId]);
 function changeView(next:ProductionOverviewView){if(next===view)return;read.current?.abort();setView(next);setCursor(null);setResult(null);setError('');}
 function refresh(){read.current?.abort();setCursor(null);setRetry(value=>value+1);}
 return <section className="production-overview" aria-labelledby={heading}>
  <header className="overview-heading"><h2 id={heading}>La production du jour</h2><button type="button" className="quiet" onClick={onOpenPlanner} disabled={busy}>Ouvrir À faire<ArrowRight size={16} aria-hidden="true"/></button></header>
  <div className="overview-toolbar"><div className="overview-views" role="group" aria-label="Vue de production">{views.map(item=><button type="button" key={item.id} aria-pressed={view===item.id} onClick={()=>changeView(item.id)}>{item.label}</button>)}</div><label className="overview-date">Jour du conducteur<input type="date" value={date} required onChange={event=>{read.current?.abort();setDate(event.target.value);setCursor(null);setResult(null);setError('');}}/></label><button className="icon-button overview-refresh" type="button" aria-label="Actualiser la production du jour" disabled={loading||!validDate} onClick={refresh}><RefreshCw size={17} aria-hidden="true"/></button></div>
  <p id={description} className="overview-description">{current.description}</p>
  {error?<div className="notice error overview-error" role="alert"><p>{error}</p><button type="button" disabled={loading} onClick={()=>setRetry(value=>value+1)}>Réessayer</button></div>:null}
  {!validDate?<p className="overview-feedback" role="status">Choisissez une date valide.</p>:null}
  {loading?<p className="overview-feedback" role="status">{cursor?'Lecture de la suite…':'Chargement de la production…'}</p>:null}
  <p className="sr-only" ref={readSummary} tabIndex={-1} role="status">{!loading&&matching?`${matching.items.length} élément${matching.items.length>1?'s':''} affiché${matching.items.length>1?'s':''}${matching.next?' ; d’autres préparations restent à lire.':'.'}`:''}</p>
  {matching?.items.length?<ol className="overview-list" aria-label="Tâches affichées" tabIndex={0} aria-describedby={description} aria-busy={loading}>{matching.items.map(item=><li className="overview-item" key={item.id}>
   <div className="overview-time"><time dateTime={`${item.date}T${item.time||'00:00'}`}>{item.time?item.time.slice(0,5):'—'}</time>{item.date!==date?<small>{dateLabel.format(new Date(`${item.date}T12:00:00Z`))}</small>:null}</div>
   <button type="button" className="quiet overview-item-open" ref={item.id===newId?firstNew:undefined} disabled={busy} onClick={()=>onOpenItem(item)} aria-label={`Préparer : ${item.title} · ${item.planName}`}><strong>{item.title}</strong><small>{item.kind==='weekly'?'Semainier':item.kind?plannerLabels[item.kind]:item.planName}{item.format?` · ${formats[item.format]}`:''}{item.kind?` · ${item.planName}`:''}</small></button>
   <div className="overview-state"><span className={`overview-status state-${Object.hasOwn(stateLabels,item.state)?item.state:'unknown'}`}>{stateLabels[item.state]||'État à vérifier'}</span>{item.ownerName?<small>{item.ownerName}</small>:null}</div>
   <div className="overview-actions">{item.projectId?<button type="button" disabled={busy} onClick={()=>onOpenProject(item.projectId!)} aria-label={`${view==='review'?'Relire':'Ouvrir le projet'} : ${item.title}`}>{view==='review'?'Relire':'Projet'}<ArrowRight size={15} aria-hidden="true"/></button>:<span className="overview-private">{item.kind?'Préparation':'Choix du média'}</span>}</div>
  </li>)}</ol>:null}
  {!loading&&!error&&matching&&!matching.items.length?<p className="overview-feedback" role="status">{matching.next?'Aucun élément dans cette partie des préparations. Poursuivez la lecture.':current.empty}</p>:null}
  {matching?.next?<footer className="overview-pagination"><small>Résultats regroupés par préparation.</small><button type="button" disabled={loading} onClick={()=>setCursor(matching.next)}>Charger la suite<ArrowRight size={16} aria-hidden="true"/></button></footer>:null}
 </section>;
}
