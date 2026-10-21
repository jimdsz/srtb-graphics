import {useEffect,useRef,useState} from 'react';
import {FolderSearch,RefreshCw,Square,Link2} from 'lucide-react';
import ConnectorSetup from './ConnectorSetup';
import {connectorRoots,scanConnector,searchConnector,leaseConnector} from './connector-client';
import type {ConnectorRoot} from './connector-client';
import {rankMedia} from './day-planner-model';
import type {DirectoryIndex,IndexedMedia,PlannerRecord,PlannerRow} from './day-planner-model';
import {bindConnectorMedia,connectedLocal} from './local-media';
import type {LocalDescriptor} from './local-media';
import {plannerAPI} from './day-planner-api';
import {savePlannerDirectory} from './planner-media-workflow';
import Activity from './Activity';
type Match={rootId:string;rootName:string;file:IndexedMedia;reason:string;score:number};
const supported=(name:string)=>/\.(mp4|webm|png|jpe?g|webp)$/i.test(name);
const matchKey=(m:Match)=>JSON.stringify([m.rootId,m.file.path]);
export default function PlannerConnectorMedia({rows,onApply,onBusyChange}:{rows:PlannerRow[];onApply:(id:string,media:LocalDescriptor,location:PlannerRow['location'])=>void;onBusyChange?:(busy:boolean)=>void}){
 const [roots,setRoots]=useState<ConnectorRoot[]>([]),[results,setResults]=useState<{row:PlannerRow;matches:Match[]}[]>([]),[choices,setChoices]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(''),[message,setMessage]=useState(''),[error,setError]=useState(''),[share,setShare]=useState(false),[page,setPage]=useState(0);
 const control=useRef<AbortController|null>(null),lock=useRef(false),mounted=useRef(true);
 useEffect(()=>{onBusyChange?.(!!busy);return()=>onBusyChange?.(false);},[busy,onBusyChange]);
 useEffect(()=>{mounted.current=true;const clear=()=>{control.current?.abort();setRoots([]);setResults([]);setChoices({});};window.addEventListener('srtb-connector-disconnect',clear);return()=>{mounted.current=false;control.current?.abort();window.removeEventListener('srtb-connector-disconnect',clear);};},[]);
 const scanning=roots.some(root=>root.state==='scanning');
 useEffect(()=>{if(!scanning||busy)return;const c=new AbortController();let timer:ReturnType<typeof setTimeout>;const poll=async()=>{try{const next=await connectorRoots(c.signal);if(!c.signal.aborted)setRoots(next);}catch{if(!c.signal.aborted)setMessage('Actualisation de l’index indisponible. Réessayez avec « Actualiser l’état ».');}finally{if(!c.signal.aborted)timer=setTimeout(poll,4000);}};timer=setTimeout(poll,1000);return()=>{c.abort();clearTimeout(timer);};},[scanning,busy]);
 async function run(label:string,work:(signal:AbortSignal)=>Promise<unknown>){if(lock.current)return;lock.current=true;const c=new AbortController();control.current=c;setBusy(label);setError('');setMessage('');try{await work(c.signal);}catch(e){if(mounted.current)setError(c.signal.aborted?'Action arrêtée. Les médias déjà reliés restent conservés.':e instanceof Error?e.message:String(e));}finally{lock.current=false;if(mounted.current)setBusy('');}}
 async function refresh(signal:AbortSignal){const value=await connectorRoots(signal);signal.throwIfAborted();setRoots(value);}
 async function search(signal:AbortSignal){
  const selected=rows.filter(row=>row.included&&(!row.media||!connectedLocal(row.media.url)));
  if(!selected.length){setResults([]);setChoices({});setMessage('Tous les programmes sélectionnés ont déjà un média disponible.');return;}
  const response=await searchConnector(selected.map(({id,title,subtitle,airDate})=>({id,title,subtitle,airDate})),signal);signal.throwIfAborted();setRoots(response.roots);
  setResults(selected.map(row=>{const entries=response.results.find(r=>r.id===row.id)?.matches||[];const byRoot=new Map<string,typeof entries>();for(const m of entries)byRoot.set(m.rootId,[...byRoot.get(m.rootId)||[],m]);
   const matches=[...byRoot].flatMap(([id,items])=>{const directory={id,revision:1,data:{kind:'directory',name:items[0].rootName,files:items.map(m=>m.file),partial:true,scannedAt:new Date().toISOString()}} as PlannerRecord<DirectoryIndex>;return rankMedia(row,directory).map(m=>({...m,rootId:id,rootName:items[0].rootName}));}).sort((a,b)=>b.score-a.score).slice(0,10);
   return {row,matches};}));setChoices({});setPage(0);
 }
 async function apply(row:PlannerRow,match:Match,signal:AbortSignal){
  const lease=await leaseConnector(match.rootId,match.file,signal);signal.throwIfAborted();if(row.media&&row.media.url!==lease.descriptor.url)throw Error('Le contenu a changé. Choisissez explicitement son remplacement sur le programme.');
  const descriptor=bindConnectorMedia(lease.descriptor,lease.url);let location:PlannerRow['location']=null,warning='';
  if(share){try{
   let previous:PlannerRecord<DirectoryIndex>|undefined;try{previous=await plannerAPI.get<DirectoryIndex>(match.rootId,signal);}catch(e){if((e as {status?:number}).status!==404)throw e;}signal.throwIfAborted();
   if(previous&&(previous.archived||previous.data.kind!=='directory'))throw Error('Cette référence d’équipe n’est plus disponible.');
   const files=[...(previous?.data.files||[]).filter(f=>f.path!==match.file.path),match.file];if(files.length>1000)throw Error('Le registre partagé de cet emplacement est plein.');
   await savePlannerDirectory(plannerAPI,match.rootId,previous?.revision||0,{kind:'directory',name:match.rootName.slice(0,120),files,partial:true,scannedAt:new Date().toISOString()},signal);signal.throwIfAborted();
   location={directoryId:match.rootId,path:match.file.path,size:match.file.size,modified:match.file.modified};
  }catch(e){signal.throwIfAborted();warning=' Le partage de cette référence n’est pas confirmé. Le média reste disponible sur ce poste.';}}
  onApply(row.id,descriptor,location);setResults(list=>list.filter(p=>p.row.id!==row.id));setMessage('Média vérifié et relié, sans téléversement.'+warning);return warning;
 }
 const visible=results.filter(p=>{const row=rows.find(r=>r.id===p.row.id);return row&&row.included&&row.title===p.row.title&&row.subtitle===p.row.subtitle&&row.airDate===p.row.airDate&&(!row.media||!connectedLocal(row.media.url));});const current=Math.min(page,Math.max(0,Math.ceil(visible.length/15)-1));
 const chosen=visible.flatMap(({row,matches})=>{const match=matches.find(m=>matchKey(m)===choices[row.id]);return match&&supported(match.file.name)?[{row,match}]:[];});
 async function applyChosen(signal:AbortSignal){let done=0,warning='';for(const item of chosen){signal.throwIfAborted();setBusy(`Vérification et liaison ${done+1}/${chosen.length}`);warning=(await apply(item.row,item.match,signal))||warning;done++;}setMessage(`${done} médias vérifiés et reliés. Aucun fichier envoyé.`+warning);}
 return <section aria-label="Recherche sur les disques avec le connecteur">
  <ConnectorSetup onConnected={()=>void run('Lecture des emplacements autorisés',refresh)}/>
  {busy?<><Activity label={busy}/><button type="button" onClick={()=>control.current?.abort()}><Square size={16}/>Arrêter cette action</button></>:null}
  {error?<p className="notice error" role="alert">{error}</p>:null}{message?<p className="notice" role="status">{message}</p>:null}
  {roots.length>0?<fieldset disabled={!!busy} className="planner-media-choices"><legend>Emplacements de ce poste</legend>
   {roots.map(root=><div key={root.id}><div className="row"><span><strong>{root.name}</strong> · {root.state==='scanning'?`Indexation : ${root.found??0} médias / ${root.visited??0} entrées parcourues`:`${root.files} médias`}{root.partial?' · partiel':''}</span><button type="button" onClick={()=>void run(root.state==='scanning'?'Arrêt de l’indexation':'Lancement de l’indexation',async signal=>{await scanConnector(root.id,root.state==='scanning',signal);await refresh(signal);})}>{root.state==='scanning'?'Arrêter':root.resumeAvailable?'Reprendre l’indexation':'Indexer / actualiser'}</button></div>{root.message?<p className="small" role="status">{root.message}</p>:null}</div>)}
   <div className="row"><button type="button" onClick={()=>void run('Actualisation des emplacements',refresh)}><RefreshCw size={16}/>Actualiser l’état</button><button type="button" className="primary" disabled={!roots.some(r=>r.updatedAt)} onClick={()=>void run('Recherche des programmes sur les disques',search)}><FolderSearch size={18}/>Rechercher les médias de cette vue</button></div>
   <p className="small muted">Recherche par noms dans tous les emplacements indexés. Vérifiez l’épisode, la date et la version avant de relier. Aucun choix automatique.</p>
   <label className="check"><input type="checkbox" checked={share} onChange={e=>setShare(e.target.checked)}/>Partager avec l’équipe les références des fichiers que je relie (noms et chemins relatifs, pas les vidéos ni les permissions)</label>
   {chosen.length>1?<button type="button" className="primary" onClick={()=>void run('Vérification des médias choisis',applyChosen)}><Link2 size={16}/>Vérifier et relier mes {chosen.length} choix</button>:null}
   {visible.slice(current*15,(current+1)*15).map(({row,matches})=>{const selected=matches.find(m=>matchKey(m)===choices[row.id]);return <article key={row.id} className="planner-index-confirm"><strong>{row.time.slice(0,5)} · {row.title} {row.subtitle}</strong><label>Média trouvé<select value={choices[row.id]||''} onChange={e=>setChoices(v=>({...v,[row.id]:e.target.value}))}><option value="">{matches.length?'Choisir un fichier à vérifier':'Aucune correspondance trouvée'}</option>{matches.map(m=><option key={matchKey(m)} value={matchKey(m)} disabled={!supported(m.file.name)}>{m.rootName} · {m.file.path}{supported(m.file.name)?'':' · conversion nécessaire'}</option>)}</select></label>{selected?<><p className="small">{selected.reason}</p><button type="button" onClick={()=>void run('Vérification du fichier puis liaison au programme',signal=>apply(row,selected,signal))}><Link2 size={16}/>Vérifier et relier ce média</button></>:null}</article>;})}
   {visible.length>15?<nav className="row" aria-label="Résultats du connecteur"><button disabled={!current} onClick={()=>setPage(current-1)}>Précédent</button><span>{current*15+1}–{Math.min((current+1)*15,visible.length)} / {visible.length}</span><button disabled={(current+1)*15>=visible.length} onClick={()=>setPage(current+1)}>Suivant</button></nav>:null}
  </fieldset>:null}
 </section>;
}
