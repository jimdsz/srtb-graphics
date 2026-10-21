import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,Check,FolderSearch,Link2,Search,ShieldCheck,TriangleAlert} from 'lucide-react';
import type {Member} from './domain';
import {canApprove} from './domain';
import type {DirectoryIndex,PlannerRecord,PlannerRow,PlannerSummary,ProgrammeRule} from './day-planner-model';
import {plannerAPI} from './day-planner-api';
import {searchRead,searchTeamIndexes} from './planner-team-search';
import {createPlannerBatchMemory,plannerAccessFailure} from './planner-media-workflow';
import {plannerMemoryRule,plannerRuleQuery,programmeRules} from './planner-rules';
import type {TeamMediaMatch,TeamMediaProposal} from './planner-team-search';
import {teamMediaWorker} from './planner-team-worker';
import {chooseFolder,connectedFolder,folderPickerAvailable,persistentFolderPickerAvailable,indexedFile,IndexedFileChanged,rememberFolder} from './day-planner-folders';
import type {DirectoryHandle} from './day-planner-folders';
import {beginLocalFile,connectedLocal,localMime} from './local-media';
import type {LocalDescriptor} from './local-media';
import NewProjectDialog from './NewProjectDialog';
import Activity from './Activity';

export default function PlannerTeamMedia({rows,member,directories,rules,onApply,onLearn,onBack,onClose}:{
 rows:PlannerRow[];member:Member;directories:PlannerSummary[];rules:PlannerRecord<ProgrammeRule>[];
 onApply:(id:string,media:LocalDescriptor,location:PlannerRow['location'])=>void;onLearn:(rule:PlannerRecord<ProgrammeRule>)=>void;onBack:()=>void;onClose:()=>void;
}){
 const canLearn=canApprove(member.role);
 const [proposals,setProposals]=useState<TeamMediaProposal[]>([]),[choices,setChoices]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState('Recherche dans les dossiers d’équipe'),[percent,setPercent]=useState<number>(),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [failures,setFailures]=useState<{id:string;name:string;message:string}[]>([]),[searched,setSearched]=useState<number|null>(null);
 const [partial,setPartial]=useState<{id:string;name:string}[]>([]);
 const [remember,setRemember]=useState(true),[learn,setLearn]=useState(false),[preview,setPreview]=useState<{rowId:string;key:string;url:string;name:string;type:string}|null>(null);
 const [connectionNeeded,setConnectionNeeded]=useState<{rowId:string;key:string}|null>(null),connectionButton=useRef<HTMLButtonElement|null>(null);
 const previewHeading=useRef<HTMLHeadingElement|null>(null);
 const pendingFocus=useRef<'connection'|'preview'|null>(null);
 const [reuse,setReuse]=useState(false);
 const [connected,setConnected]=useState<string[]>([]),[page,setPage]=useState(0);
 const handles=useRef(new Map<string,DirectoryHandle>()),control=useRef<AbortController|null>(null),lock=useRef(false),active=useRef(true);
 const currentRules=useRef(rules);
 const [teamMemory]=useState(()=>createPlannerBatchMemory(plannerAPI));
 async function run(label:string,fn:(signal:AbortSignal)=>Promise<void>){
  if(lock.current)return;lock.current=true;const c=new AbortController();control.current=c;
  setBusy(label);setPercent(undefined);setError('');setNotice('');
  try{await fn(c.signal);}catch(e){if(active.current&&control.current===c){if(c.signal.aborted||e instanceof DOMException&&e.name==='AbortError')setNotice('Arrêté. Les médias déjà reliés sont conservés. Une association peut avoir été enregistrée : recherchez à nouveau avant de la mémoriser à nouveau.');else setError(e instanceof Error?e.message:String(e));}}
  finally{if(control.current===c){lock.current=false;if(active.current){setBusy('');setPercent(undefined);}}}
 }
 async function search(){await run('Recherche dans les dossiers d’équipe',async signal=>{
  pendingFocus.current=null;setProposals([]);setChoices({});setPreview(null);setConnectionNeeded(null);setFailures([]);setPartial([]);setSearched(null);setPage(0);setLearn(false);setReuse(false);
  if(teamMemory.needsRefresh){const query=plannerRuleQuery(rows),fresh=await searchRead(s=>plannerAPI.rules(query.programmes,s,query.families),signal);signal.throwIfAborted();currentRules.current=fresh.rules;teamMemory.refreshed();}
  const candidates=rows.filter(r=>r.included&&(!r.media||!connectedLocal(r.media.url)));
  const matcher=teamMediaWorker(candidates,currentRules.current,signal);
  try{
   const result=await searchTeamIndexes({directories,get:(id,s)=>plannerAPI.get<DirectoryIndex>(id,s),add:matcher.add,result:matcher.result,signal,
    onProgress:p=>{if(!signal.aborted){setBusy(`Recherche dans les index · ${p.done}/${p.total} dossiers`);setPercent(p.total?p.done/p.total*100:100);}}});
   signal.throwIfAborted();setProposals(result.proposals);setFailures(result.failures);setPartial(result.partial);setSearched(result.searched);
  }finally{matcher.close();}
 });}
 // Opening this view is an explicit search action. Only shared metadata is read;
 // permissions and file reads happen later, after selecting a candidate.
 useEffect(()=>{active.current=true;void search();return()=>{active.current=false;control.current?.abort();lock.current=false;};},[]);
 useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview.url);},[preview]);
 useEffect(()=>{
  if(busy||!pendingFocus.current)return;
  const intent=pendingFocus.current,target=intent==='connection'?connectionButton.current:previewHeading.current;
  pendingFocus.current=null;target?.focus({preventScroll:true});target?.scrollIntoView({block:intent==='preview'?'start':'nearest',behavior:'instant'});
 },[busy,connectionNeeded,preview]);
 const chosen=proposals.flatMap(p=>{const match=p.matches.find(m=>m.key===choices[p.row.id]);return match?[{row:p.row,match}]:[];});
 const folders=[...new Map(chosen.map(p=>[p.match.directory.id,p.match.directory])).values()];
 async function folder(id:string,signal:AbortSignal,required=true){
  signal.throwIfAborted();const handle=handles.current.get(id)||await connectedFolder(member.email,id,signal);signal.throwIfAborted();
  if(!handle){if(required)throw Error('Connectez ce dossier dans « Accès aux dossiers sélectionnés » ou ouvrez le média pour le connecter directement.');return null;}
  handles.current.set(id,handle);setConnected(ids=>ids.includes(id)?ids:[...ids,id]);return handle;
 }
 async function previewMedia(rowId:string,match:TeamMediaMatch,handle:DirectoryHandle,signal:AbortSignal){
  const source=await indexedFile(handle,match.file,signal);signal.throwIfAborted();
  pendingFocus.current='preview';setPreview({rowId,key:match.key,url:URL.createObjectURL(source.file),name:match.file.name,type:localMime(source.file)});setConnectionNeeded(null);
 }
 async function show(rowId:string,match:TeamMediaMatch){await run('Ouverture du média sélectionné',async signal=>{
  pendingFocus.current=null;setPreview(null);setConnectionNeeded(null);
  try{const handle=await folder(match.directory.id,signal,false);
   if(!handle){pendingFocus.current='connection';setConnectionNeeded({rowId,key:match.key});return;}
   await previewMedia(rowId,match,handle,signal);
  }catch(error){signal.throwIfAborted();if(!(error instanceof IndexedFileChanged)){pendingFocus.current='connection';setConnectionNeeded({rowId,key:match.key});}throw error;}
 });}
 async function connectAndShow(rowId:string,match:TeamMediaMatch){await run('Connexion du dossier pour ce média',async signal=>{
  pendingFocus.current='connection';
  const handle=await chooseFolder(signal);signal.throwIfAborted();
  const warning=await rememberFolder(member.email,match.directory.id,handle,remember);signal.throwIfAborted();
  handles.current.set(match.directory.id,handle);setConnected(ids=>ids.includes(match.directory.id)?ids:[...ids,match.directory.id]);
  await previewMedia(rowId,match,handle,signal);setNotice(warning||'Dossier connecté. Vérifiez le média avant de le relier.');
 });}
 async function apply(){await run('Vérification des médias sélectionnés',async signal=>{
  const learnForTeam=canLearn&&learn;
  const verified=new Map<string,LocalDescriptor>(),failed:string[]=[];let done=0,learned=0;
  for(const [index,p] of chosen.entries()){
   signal.throwIfAborted();const {directory,file,key}=p.match;
   try{
    let media=verified.get(key);
    if(!media){const source=await indexedFile((await folder(directory.id,signal))!,file,signal);signal.throwIfAborted();
     setBusy(`Vérification locale · ${index+1}/${chosen.length} · ${file.name}`);
     media=await beginLocalFile(source.file,n=>setPercent((index+n)/chosen.length*100),remember?source.handle:undefined,signal).verified;verified.set(key,media);}
    signal.throwIfAborted();
    if(p.row.media&&p.row.media.url!==media.url)throw Error('Le contenu a changé. Remplacez le média volontairement sur le programme ; aucune substitution automatique.');
    onApply(p.row.id,p.row.media||media,{directoryId:directory.id,path:file.path,size:file.size,modified:file.modified});done++;
    setProposals(previous=>previous.filter(item=>item.row.id!==p.row.id));
    setChoices(previous=>{const next={...previous};delete next[p.row.id];return next;});
    // Optional team memory must not undo a successful local binding.
    if(learnForTeam&&!p.row.media&&!teamMemory.needsRefresh){
     setBusy(`Mémorisation pour l’équipe · ${p.row.title}`);
     const data=plannerMemoryRule(p.row,directory.id,file.path,reuse);
     const prior=programmeRules(currentRules.current).unique.get(data.programme),{saved}=await teamMemory.remember(prior?.id||crypto.randomUUID(),prior?.revision||0,data,signal);
     if(saved){currentRules.current=[...currentRules.current.filter(r=>r.id!==saved.id),saved];onLearn(saved);learned++;}
    }
   }catch(e){signal.throwIfAborted();if(plannerAccessFailure(e))throw e;failed.push(`${p.row.title} : ${e instanceof Error?e.message:String(e)}`);}
   setPercent((index+1)/chosen.length*100);
  }
  setPage(0);setLearn(false);setReuse(false);setNotice(`${done} média(s) lié(s)${learnForTeam?` · ${learned} association(s) mémorisée(s)`:''}. Aucun fichier envoyé.${learnForTeam&&teamMemory.needsRefresh?' La mémorisation d’équipe n’est pas confirmée pour tous les médias. Les liaisons locales sont conservées ; recherchez à nouveau avant de réessayer.':''}`);if(failed.length)setError(failed.join('\n'));
 });}
 const distinct=proposals.filter(p=>p.suggested),ambiguous=proposals.filter(p=>p.matches.length&&!p.suggested),missing=proposals.filter(p=>!p.matches.length);
 return <NewProjectDialog labelledBy="planner-team-title" busy={!!busy} onClose={onClose}>
  <div className="planner-media-heading"><FolderSearch size={28} aria-hidden="true"/><div><h2 id="planner-team-title">Tous les dossiers d’équipe</h2><p>Une recherche pour les programmes de cette vue.</p></div></div>
  <p className="planner-privacy"><ShieldCheck size={17} aria-hidden="true"/>Noms et associations partagés uniquement. Aucun disque parcouru pendant cette recherche.</p>
  {busy?<div><Activity label={busy} percent={percent}/><button onClick={()=>control.current?.abort()}>Arrêter</button></div>:null}
  {error?<p className="notice error" role="alert">{error}</p>:null}{notice?<p className="notice" role="status">{notice}</p>:null}
  <fieldset disabled={!!busy} className="planner-media-choices">
   {searched!==null?<>
    <div className="planner-team-summary" aria-label="Résultats de la recherche"><span><Check size={18} aria-hidden="true"/><strong>{distinct.length}</strong> correspondances distinctes</span><span><TriangleAlert size={18} aria-hidden="true"/><strong>{ambiguous.length}</strong> à vérifier</span><span><Search size={18} aria-hidden="true"/><strong>{missing.length}</strong> sans correspondance</span></div>
    <p className="small muted">{searched} index consulté(s). Les propositions utilisent les noms, les dates et les choix de l’équipe, pas une reconnaissance du contenu.</p>
    {failures.length?<div className="notice warning"><p>{failures.length} dossier(s) non consulté(s). Pas de présélection par nom tant que la recherche est incomplète.</p><details><summary>Voir les dossiers concernés</summary><ul>{failures.map(f=><li key={f.id}>{f.name} — {f.message}</li>)}</ul></details></div>:null}
    {partial.length?<div className="notice warning"><p>{partial.length} index partiel(s) : certains fichiers peuvent manquer. Choisissez vos médias manuellement ou complétez ces index.</p><details><summary>Voir les index partiels</summary><ul>{partial.map(d=><li key={d.id}>{d.name}</li>)}</ul></details></div>:null}
    <div className="row"><button disabled={!distinct.length} onClick={()=>setChoices(Object.fromEntries(distinct.map(p=>[p.row.id,p.suggested])))}><Check size={17} aria-hidden="true"/>Cocher les correspondances distinctes</button><button onClick={()=>void search()}>Rechercher à nouveau</button></div>
    <div className={`planner-batch-candidates${preview?' has-preview':''}`}>{proposals.slice(page*20,(page+1)*20).map(p=>{
     const selected=p.matches.find(m=>m.key===choices[p.row.id]);
     return <article key={p.row.id}><div><strong>{p.row.time.slice(0,5)} · {p.row.title}</strong><small>{p.row.airDate.split('-').reverse().join('/')} {p.row.subtitle?' · '+p.row.subtitle:''}</small></div>
      {p.ruleConflict?<small className="notice warning">Associations d’équipe contradictoires : choisissez le média manuellement. Aucun choix d’équipe ne sera remplacé automatiquement.</small>:null}
      <label>Média proposé<select aria-label={`Média pour ${p.row.title} ${p.row.subtitle} ${p.row.time}`} value={choices[p.row.id]||''} onChange={e=>{setChoices(v=>({...v,[p.row.id]:e.target.value}));setConnectionNeeded(null);setPreview(null);}}><option value="">{p.matches.length?'Ne pas relier pour le moment':'Aucune correspondance dans les index'}</option>{p.matches.map(m=><option key={m.key} value={m.key}>{m.directory.name} / {m.file.path} — {m.reason}</option>)}</select></label>
      {selected?<><small>{selected.directory.name} / {selected.file.path}</small><small>{selected.reason}{selected.directory.partial?' · Index partiel':''}</small><button onClick={()=>void show(p.row.id,selected)}><Search size={15} aria-hidden="true"/>Voir le média</button>
       {connectionNeeded?.rowId===p.row.id&&connectionNeeded.key===selected.key?<div className="planner-inline-connection"><p role="status">Autorisez l’accès au dossier sur ce poste pour voir ce média.</p>{folderPickerAvailable()?<button ref={connectionButton} onClick={()=>void connectAndShow(p.row.id,selected)}><Link2 size={16} aria-hidden="true"/>Connecter {selected.directory.name} pour voir ce média</button>:<p>Le choix de dossier n’est pas disponible ici. Choisissez le fichier depuis la fiche du programme.</p>}</div>:null}
       {preview?.rowId===p.row.id&&preview.key===selected.key?<section className="planner-media-preview"><h3 ref={previewHeading} tabIndex={-1}>{preview.name}</h3>{preview.type.startsWith('image/')?<img src={preview.url} alt="Média à vérifier"/>:<video src={preview.url} controls preload="metadata"/>}</section>:null}
      </>:p.matches.length&&!p.suggested?<small>Vérifiez les versions et la date avant de choisir.</small>:null}
     </article>;
    })}</div>
    {proposals.length>20?<nav className="planner-pagination" aria-label="Résultats par page"><button disabled={!page} onClick={()=>setPage(p=>p-1)}>Précédent</button><span>{page*20+1}–{Math.min((page+1)*20,proposals.length)} / {proposals.length}</span><button disabled={(page+1)*20>=proposals.length} onClick={()=>setPage(p=>p+1)}>Suivant</button></nav>:null}
    {folders.length?<section className="planner-team-connections" aria-label="Accès aux dossiers sélectionnés"><h3>{chosen.length} média(s) sélectionné(s) · {folders.length} dossier(s)</h3><p className="small muted">Les accès déjà mémorisés sont réutilisés à la lecture. Sur un autre poste, connectez chaque dossier nécessaire.</p>
     {folders.map(d=><div key={d.id}><span><strong>{d.name}</strong><small>{connected.includes(d.id)?'Connecté pour cette session':'Accès local à vérifier'}</small></span>{folderPickerAvailable()?<button onClick={()=>void run('Connexion du dossier sélectionné',async signal=>{const h=await chooseFolder(signal);signal.throwIfAborted();const warning=await rememberFolder(member.email,d.id,h,remember);signal.throwIfAborted();handles.current.set(d.id,h);setConnected(ids=>ids.includes(d.id)?ids:[...ids,d.id]);setNotice(warning||'Accès connecté. Chaque fichier sera vérifié avant d’être relié.');})}><Link2 size={16} aria-hidden="true"/>Connecter {d.name}</button>:null}</div>)}
     {persistentFolderPickerAvailable()?<label className="check"><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/>Mémoriser les accès sur ce navigateur</label>:<p className="small muted">Accès pour cette ouverture uniquement. Au prochain lancement, resélectionnez les dossiers demandés. Les références et associations de l’équipe restent conservées.</p>}
     {canLearn?<label className="check"><input type="checkbox" checked={learn} onChange={e=>{setLearn(e.target.checked);setReuse(false);}}/>Retenir ces associations pour l’équipe</label>:<p className="small muted">Reliez les médias à cette préparation, puis confirmez vos choix dans « Habitudes proposées ». Les règles d’équipe sont validées par la diffusion ou l’administration.</p>}
     {canLearn&&learn?<label className="check"><input type="checkbox" checked={reuse} onChange={e=>setReuse(e.target.checked)}/><span>Réutiliser aussi les dossiers et habillages pour les prochains épisodes<small>Les fichiers restent propres à chaque épisode. Aucun ancien projet ne change.</small></span></label>:null}
     <button className="primary" onClick={()=>void apply()}><Check size={17} aria-hidden="true"/>Relier les {chosen.length} médias sélectionnés</button>
    </section>:null}
   </>:!busy?<button onClick={()=>void search()}>Reprendre la recherche</button>:null}
  </fieldset>
  <div className="planner-dialog-footer"><button disabled={!!busy} onClick={onBack}><ArrowLeft size={16} aria-hidden="true"/>Choisir un seul dossier</button><button disabled={!!busy} onClick={onClose}>Terminer</button></div>
 </NewProjectDialog>;
}
