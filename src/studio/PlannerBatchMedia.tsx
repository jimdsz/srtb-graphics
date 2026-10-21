import {useEffect,useMemo,useRef,useState} from 'react';
import {Check,FolderPlus,FolderSearch,Link2,Search,ShieldCheck,Users} from 'lucide-react';
import type {Member} from './domain';
import {canApprove} from './domain';
import type {DirectoryIndex,PlannerRecord,PlannerRow,PlannerSummary,ProgrammeRule} from './day-planner-model';
import {plannerAPI} from './day-planner-api';
import {mediaDateHint} from './day-planner-media-date';
import {mediaEpisodeHint} from './day-planner-media-episode';
import {chooseFolder,connectedFolder,folderPickerAvailable,persistentFolderPickerAvailable,indexedFile,rememberFolder,scanFolder} from './day-planner-folders';
import type {DirectoryHandle} from './day-planner-folders';
import {beginLocalFile,connectedLocal,localMime} from './local-media';
import type {LocalDescriptor} from './local-media';
import Activity from './Activity';
import NewProjectDialog from './NewProjectDialog';
import PlannerTeamMedia from './PlannerTeamMedia';
import PlannerConnectorMedia from './PlannerConnectorMedia';
import {searchRead,teamDirectoryCatalog} from './planner-team-search';
import type {TeamMediaProposal} from './planner-team-search';
import {directoryMediaWorker} from './planner-team-worker';
import {createPlannerBatchMemory,plannerAccessFailure,savePlannerDirectory} from './planner-media-workflow';
import {plannerMemoryRule,plannerRuleQuery,programmeRules} from './planner-rules';

export default function PlannerBatchMedia({rows,member,onApply,onClose}:{rows:PlannerRow[];member:Member;onApply:(id:string,media:LocalDescriptor,location:PlannerRow['location'])=>void;onClose:()=>void}){
 const canLearn=canApprove(member.role);
 const [directories,setDirectories]=useState<PlannerSummary[]>([]),[directory,setDirectory]=useState<PlannerRecord<DirectoryIndex>|null>(null),[rules,setRules]=useState<PlannerRecord<ProgrammeRule>[]>([]);
 const [choices,setChoices]=useState<Record<string,string>>({}),[busy,setBusy]=useState('Lecture des dossiers d’équipe'),[percent,setPercent]=useState<number>(),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [remember,setRemember]=useState(true),[learn,setLearn]=useState(false),[preview,setPreview]=useState<{url:string;name:string;type:string}|null>(null);
 const [reuse,setReuse]=useState(false);
 const [pendingIndex,setPendingIndex]=useState<{id:string;data:DirectoryIndex;handle:DirectoryHandle}|null>(null);
 const [localDirectory,setLocalDirectory]=useState<PlannerRecord<DirectoryIndex>|null>(null);
 const [teamSearch,setTeamSearch]=useState(false);
 const [connectorBusy,setConnectorBusy]=useState(false);
 const [matched,setMatched]=useState<TeamMediaProposal[]>([]),[page,setPage]=useState(0);
 const [teamMemory]=useState(()=>createPlannerBatchMemory(plannerAPI));
 const handles=useRef(new Map<string,DirectoryHandle>()),control=useRef<AbortController|null>(null),lock=useRef(false),active=useRef(true);
 useEffect(()=>{active.current=true;void loadCatalog();return()=>{active.current=false;control.current?.abort();lock.current=false;};},[]);
 useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview.url);},[preview]);
 // Keep the computed candidates, but drop completed rows without repeating the
 // expensive search each time a file is bound or a team preference is saved.
 const proposals=useMemo(()=>{
  const current=new Map(rows.filter(r=>r.included&&(!r.media||!connectedLocal(r.media.url))).map(r=>[r.id,r]));
  return matched.flatMap(p=>{const row=current.get(p.row.id);return row?[{...p,row}]:[];});
 },[rows,matched]);
 const currentPage=Math.min(page,Math.max(0,Math.ceil(proposals.length/20)-1));
 async function matchDirectory(d:PlannerRecord<DirectoryIndex>,preferences:PlannerRecord<ProgrammeRule>[],signal:AbortSignal){
  setMatched([]);setChoices({});setPage(0);setPreview(null);setLearn(false);setReuse(false);
  const candidates=rows.filter(r=>r.included&&(!r.media||!connectedLocal(r.media.url)));
  setBusy(`Comparaison des noms · ${candidates.length} programmes · ${d.data.files.length} fichiers`);
  const result=await directoryMediaWorker(candidates,d,preferences,signal);signal.throwIfAborted();setMatched(result);
 }
 async function run(label:string,fn:(signal:AbortSignal)=>Promise<void>,mayWrite=false){
  if(lock.current)return;lock.current=true;const c=new AbortController();control.current=c;setBusy(label);setError('');setNotice('');
  try{await fn(c.signal);}catch(e){if(active.current&&control.current===c){
   if(c.signal.aborted)setNotice(mayWrite?'Arrêté. Les médias déjà reliés sont conservés. Un index ou une association peut avoir été enregistré : actualisez les dossiers d’équipe avant de réessayer.':'Recherche arrêtée. Aucun média modifié. Vous pouvez choisir un autre dossier ou actualiser pour recommencer.');
   else if(e instanceof DOMException&&e.name==='AbortError')setNotice('Choix du dossier annulé. Aucun changement.');
   else setError(e instanceof Error?e.message:String(e));
  }}finally{if(control.current===c){lock.current=false;if(active.current){setBusy('');setPercent(undefined);}}}
 }
 async function loadCatalog(){await run('Lecture des dossiers d’équipe',async signal=>{
  setMatched([]);setChoices({});setPage(0);setPreview(null);
  const dirs=await teamDirectoryCatalog((offset,s)=>plannerAPI.list('directory',offset,undefined,s),signal,n=>setBusy(`Lecture des dossiers d’équipe · ${n} index`));
  const query=plannerRuleQuery(rows),r=await searchRead(s=>plannerAPI.rules(query.programmes,s,query.families),signal);signal.throwIfAborted();setDirectories(dirs);setRules(r.rules);teamMemory.refreshed();
  if(pendingIndex&&dirs.some(d=>d.id===pendingIndex.id&&d.revision>0&&d.name===pendingIndex.data.name.trim())){
   setPendingIndex(null);setNotice('L’index a bien été partagé. Sélectionnez-le dans les dossiers d’équipe pour poursuivre ; aucun nouveau partage nécessaire.');
  }
  if(directory){
   if(directory.id===localDirectory?.id){await matchDirectory(localDirectory,r.rules,signal);return;}
   if(!dirs.some(d=>d.id===directory.id)){setDirectory(null);return;}
   const fresh=await searchRead(s=>plannerAPI.get<DirectoryIndex>(directory.id,s),signal);signal.throwIfAborted();
   if(fresh.id!==directory.id||fresh.archived||fresh.data.kind!=='directory'){setDirectory(null);throw Error('Dossier retiré ou modifié. Choisissez un autre dossier.');}
   setDirectory(fresh);await matchDirectory(fresh,r.rules,signal);
  }
 });}
 async function folder(signal:AbortSignal){signal.throwIfAborted();if(!directory)throw Error('Choisissez un dossier.');const cached=handles.current.get(directory.id),handle=cached||await connectedFolder(member.email,directory.id,signal);signal.throwIfAborted();if(!handle)throw Error('Cliquez sur « Connecter ce dossier » pour autoriser sa lecture sur ce poste.');handles.current.set(directory.id,handle);return handle;}
 async function addFolder(){await run('Choix du dossier à lire',async signal=>{
  const handle=await chooseFolder(signal);signal.throwIfAborted();
  setPendingIndex(null);setBusy('Lecture des noms du dossier');const data=await scanFolder(handle,signal,n=>setBusy(`Lecture des noms · ${n} fichiers trouvés`));signal.throwIfAborted();
  setPendingIndex({id:crypto.randomUUID(),data,handle});
 });}
 async function shareFolder(){if(!pendingIndex)return;const pending=pendingIndex;await run('Partage des références du dossier',async signal=>{
  const saved=await savePlannerDirectory(plannerAPI,pending.id,0,{...pending.data,name:pending.data.name.trim()},signal);
  // Commit the successful save locally before optional persistence, so a local
  // storage failure cannot offer to create the same index a second time.
  setDirectory(saved);setDirectories(ds=>[...ds.filter(d=>d.id!==saved.id),{id:saved.id,revision:saved.revision,kind:'directory',name:saved.data.name,updatedAt:saved.updatedAt,archived:false}]);
  handles.current.set(saved.id,pending.handle);setPendingIndex(null);setChoices({});setPreview(null);
  const warning=await rememberFolder(member.email,saved.id,pending.handle,remember);signal.throwIfAborted();
  setNotice(warning||'Dossier prêt pour cette journée et les prochaines. Vérifiez les propositions ci-dessous ; aucun fichier envoyé.');
  await matchDirectory(saved,rules,signal);
 },true);}
 async function useLocalFolder(){if(!pendingIndex)return;const pending=pendingIndex;await run('Recherche sur ce poste',async signal=>{
  // This record exists only while the dialog is open. Never persist its ID in
  // a planner location or a team rule: other computers cannot resolve it.
  const local:PlannerRecord<DirectoryIndex>={id:pending.id,revision:0,data:pending.data,createdBy:member.email,updatedBy:member.email,updatedAt:new Date().toISOString(),archived:false};
  handles.current.set(local.id,pending.handle);setLocalDirectory(local);setDirectory(local);setPendingIndex(null);
  await matchDirectory(local,rules,signal);
  setNotice('Recherche locale prête. Cet index n’est pas partagé avec l’équipe ; aucun fichier envoyé.');
 });}
 async function apply(){if(!directory)return;await run('Vérification des médias sélectionnés',async signal=>{
  const localOnly=directory.id===localDirectory?.id,learnForTeam=canLearn&&learn&&!localOnly;
  const handle=await folder(signal),chosen=proposals.filter(p=>choices[p.row.id]),verified=new Map<string,LocalDescriptor>(),failed:string[]=[],currentRules=programmeRules(rules).unique;let done=0,learned=0;
  for(const [index,p] of chosen.entries()){signal.throwIfAborted();const entry=directory.data.files.find(f=>f.path===choices[p.row.id]);if(!entry)continue;
   try{let media=verified.get(entry.path);if(!media){const file=await indexedFile(handle,entry,signal);signal.throwIfAborted();setBusy(`Vérification locale · ${index+1}/${chosen.length} · ${entry.name}`);media=await beginLocalFile(file.file,n=>setPercent((index+n)/chosen.length*100),remember?file.handle:undefined,signal).verified;verified.set(entry.path,media);}
    signal.throwIfAborted();if(p.row.media&&p.row.media.url!==media.url)throw Error('Le contenu diffère du média enregistré. Choisissez explicitement un remplacement sur le programme ; aucune substitution automatique.');onApply(p.row.id,p.row.media||media,localOnly?null:{directoryId:directory.id,path:entry.path,size:entry.size,modified:entry.modified});done++;
    if(learnForTeam&&!p.row.media&&!teamMemory.needsRefresh){
     setBusy(`Mémorisation pour l’équipe · ${p.row.title}`);
     const data=plannerMemoryRule(p.row,directory.id,entry.path,reuse),prior=currentRules.get(data.programme);
     const {saved}=await teamMemory.remember(prior?.id||crypto.randomUUID(),prior?.revision||0,data,signal);
     if(saved){currentRules.set(data.programme,saved);setRules(previous=>[...previous.filter(r=>r.data.programme!==data.programme),saved]);learned++;}
    }
   }catch(e){signal.throwIfAborted();if(plannerAccessFailure(e))throw e;failed.push(`${p.row.title} : ${e instanceof Error?e.message:String(e)}`);}
   setPercent((index+1)/chosen.length*100);
  }
  setNotice(`${done} média(s) lié(s) à la préparation${learnForTeam?` · ${learned} association(s) mémorisée(s)`:''}. Aucun fichier envoyé.${learnForTeam&&teamMemory.needsRefresh?' La mémorisation d’équipe n’est pas confirmée pour tous les médias. Les liaisons locales sont conservées ; actualisez les dossiers d’équipe avant de réessayer.':''}`);if(failed.length)setError(failed.join('\n'));setChoices({});setLearn(false);setReuse(false);
 },true);}
 if(teamSearch)return <PlannerTeamMedia rows={rows} member={member} directories={directories} rules={rules} onApply={onApply} onLearn={rule=>setRules(previous=>[...previous.filter(r=>r.data.programme!==rule.data.programme),rule])} onClose={onClose} onBack={()=>setTeamSearch(false)}/>;
 return <NewProjectDialog labelledBy="planner-batch-title" busy={(!!busy&&!!control.current)||connectorBusy} onClose={onClose}>
  <div className="planner-media-heading"><FolderSearch size={28} aria-hidden="true"/><div><h2 id="planner-batch-title">Retrouver les médias de cette vue</h2><p>{rows.filter(r=>r.included&&(!r.media||!connectedLocal(r.media.url))).length} programmes à relier ou reconnecter</p></div></div>
  <p className="planner-privacy"><ShieldCheck size={17} aria-hidden="true"/>Les fichiers restent sur le poste ou le réseau. Chaque proposition reste à vérifier.</p>
  <fieldset disabled={!!busy} style={{border:0,padding:0,margin:0}}><PlannerConnectorMedia rows={rows} onApply={onApply} onBusyChange={setConnectorBusy}/></fieldset>
  {busy?<><Activity label={busy} percent={percent}/>{control.current?<button onClick={()=>control.current?.abort()}>Arrêter</button>:null}</>:null}
  {error?<p className="notice error" role="alert">{error}</p>:null}{notice?<p className="notice" role="status">{notice}</p>:null}
  <fieldset disabled={!!busy||connectorBusy} className="planner-media-choices">
   {directories.length>0?<button className="planner-team-search-button" onClick={()=>setTeamSearch(true)}><FolderSearch size={23} aria-hidden="true"/><span><strong>Rechercher dans tous les dossiers d’équipe</strong><small>{directories.length} index · les correspondances regroupées en une seule liste</small></span></button>:null}
   <button className="quiet" onClick={()=>void loadCatalog()}>Actualiser les dossiers d’équipe</button>
   <div className="planner-batch-folder-start"><label>Dossier de recherche<select value={directory?.id||''} onChange={e=>{const id=e.target.value;setDirectory(null);setPendingIndex(null);setMatched([]);setPage(0);setChoices({});setPreview(null);if(id)void run('Ouverture de l’index',async signal=>{const d=id===localDirectory?.id?localDirectory:await searchRead(s=>plannerAPI.get<DirectoryIndex>(id,s),signal);signal.throwIfAborted();if(d.id!==id||d.archived||d.data.kind!=='directory')throw Error('Dossier retiré ou modifié. Actualisez la liste.');setDirectory(d);await matchDirectory(d,rules,signal);});}}><option value="">Choisir un dossier indexé</option>{localDirectory?<option value={localDirectory.id}>{localDirectory.data.name} · ce poste uniquement</option>:null}{directories.map(d=><option key={d.id} value={d.id}>{d.name} · équipe</option>)}</select></label>
    {folderPickerAvailable()?<button onClick={()=>void addFolder()}><FolderPlus size={18} aria-hidden="true"/>Ajouter un dossier local ou réseau</button>:<p className="small muted">Ce navigateur ne permet pas de sélectionner un dossier. Le choix individuel reste disponible sur chaque programme.</p>}
   </div>
   {persistentFolderPickerAvailable()?<label className="check"><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/>Mémoriser l’accès sur ce navigateur</label>:<p className="small muted">Choisissez un dossier précis, pas tout le disque. Accès pour cette ouverture uniquement : resélectionnez le dossier au prochain lancement. Aucun fichier envoyé.</p>}
   {!directories.length&&!directory&&!busy&&!pendingIndex?<p className="small muted">Choisissez le dossier de vos programmes. Graphics y cherchera les correspondances pour toute cette vue, sans parcourir les autres disques.</p>:null}
   {pendingIndex?<section className="planner-index-confirm notice" aria-label="Vérifier le nouvel index">
    <h3><FolderSearch size={19} aria-hidden="true"/> {pendingIndex.data.files.length} fichiers visuels trouvés</h3>
    <label>Nom du dossier<input maxLength={120} value={pendingIndex.data.name} onChange={e=>setPendingIndex({...pendingIndex,data:{...pendingIndex.data,name:e.target.value}})}/></label>
    <p>Recherchez sur ce poste, ou partagez l’index pour aider l’équipe à retrouver ces médias. Le partage concerne uniquement les noms, chemins relatifs, tailles et dates. Les fichiers et autorisations de disque restent sur ce poste.</p>
    {pendingIndex.data.partial?<p className="notice warning">Lecture partielle : certains fichiers sont inaccessibles ou la limite est atteinte. Choisissez un sous-dossier pour compléter.</p>:null}
    <details><summary>Voir les références à partager</summary><ul className="planner-index-sample">{pendingIndex.data.files.slice(0,10).map(file=><li key={file.path}>{file.path}</li>)}</ul>{pendingIndex.data.files.length>10?<p>… et {pendingIndex.data.files.length-10} autres références.</p>:null}</details>
    {!pendingIndex.data.files.length?<p>Aucune vidéo MP4/WebM ni image PNG/JPEG/WebP trouvée dans ce dossier.</p>:null}
    <div className="row"><button className="primary" disabled={!pendingIndex.data.files.length} onClick={()=>void useLocalFolder()}><Search size={16} aria-hidden="true"/>Chercher sans partager</button><button disabled={!pendingIndex.data.name.trim()||!pendingIndex.data.files.length} onClick={()=>void shareFolder()}><Users size={16} aria-hidden="true"/>Partager l’index et chercher</button><button onClick={()=>setPendingIndex(null)}>Annuler</button></div>
   </section>:null}
   {directory&&!pendingIndex?<><div className="row">{directory.id!==localDirectory?.id&&folderPickerAvailable()?<button onClick={()=>void run('Connexion du dossier sur ce poste',async signal=>{const h=await chooseFolder(signal);signal.throwIfAborted();const warning=await rememberFolder(member.email,directory.id,h,remember);signal.throwIfAborted();handles.current.set(directory.id,h);setNotice(warning||'Dossier connecté. Vérifiez les propositions avant de les relier.');})}><Link2 size={17} aria-hidden="true"/>Connecter ce dossier</button>:null}<button disabled={!proposals.some(p=>p.suggested)} onClick={()=>setChoices(Object.fromEntries(proposals.filter(p=>p.suggested).map(p=>[p.row.id,p.matches.find(m=>m.key===p.suggested)!.file.path])))}><Check size={17} aria-hidden="true"/>Cocher les correspondances distinctes</button></div>
    {directory.id===localDirectory?.id?<p className="notice" role="status">Sur ce poste uniquement · index non partagé. Les liaisons choisies seront conservées avec la préparation, mais l’accès au dossier reste local.</p>:null}
    <p className="small muted">Suggestions par noms, dates et associations de l’équipe, sans analyse du contenu. Une autre date reste sélectionnable pour une rediffusion.</p>
    {directory.data.partial?<p className="notice warning">Index partiel : certains fichiers peuvent manquer. Pas de présélection par nom ; choisissez les médias manuellement ou complétez cet index.</p>:null}
    <div className="planner-batch-candidates">{proposals.slice(currentPage*20,(currentPage+1)*20).map(p=>{
     const chosen=p.matches.find(m=>m.file.path===choices[p.row.id]);
     const datesToCheck=!p.suggested&&p.matches.some(m=>mediaDateHint(m.file,p.row.airDate).manual);
     const episodesToCheck=!p.suggested&&p.matches.some(m=>mediaEpisodeHint(m.file,p.row).manual);
     const usageToCheck=!p.suggested&&p.matches.some(m=>'manual' in m&&m.manual);
     return <article key={p.row.id}><div><strong>{p.row.time.slice(0,5)} · {p.row.title}</strong><small>{p.row.airDate.split('-').reverse().join('/')} {p.row.subtitle?' · '+p.row.subtitle:''}</small></div>
      {p.ruleConflict?<small className="notice warning">Associations d’équipe contradictoires : choisissez le média manuellement. Aucun choix d’équipe ne sera remplacé automatiquement.</small>:null}
      <label>Média proposé<select aria-label={`Média pour ${p.row.title} ${p.row.subtitle} ${p.row.time}`} value={choices[p.row.id]||''} onChange={e=>setChoices(c=>({...c,[p.row.id]:e.target.value}))}><option value="">{p.matches.length?'Ne pas relier pour le moment':'Aucune correspondance dans ce dossier'}</option>{p.matches.map(m=><option key={m.file.path} value={m.file.path}>{m.file.path} — {m.reason}</option>)}</select></label>
      {chosen?<small>{chosen.reason}</small>:datesToCheck?<small>Dates à vérifier : choisissez le fichier voulu.</small>:episodesToCheck?<small>Épisode ou saison à vérifier : choisissez le fichier voulu.</small>:usageToCheck?<small>Ressource d’habillage possible : vérifiez le média avant de le choisir.</small>:p.matches.length>1&&!p.suggested?<small>Plusieurs versions possibles : choisissez celle qui convient.</small>:null}
      {chosen?<button onClick={()=>void run('Ouverture du média à vérifier',async signal=>{const source=await indexedFile(await folder(signal),chosen.file,signal);signal.throwIfAborted();setPreview({url:URL.createObjectURL(source.file),name:chosen.file.name,type:localMime(source.file)});})}><Search size={15} aria-hidden="true"/>Voir le média</button>:null}
     </article>;
    })}</div>
    {proposals.length>20?<nav className="planner-pagination" aria-label="Médias par page"><button disabled={!currentPage} onClick={()=>setPage(currentPage-1)}>Précédent</button><span>{currentPage*20+1}–{Math.min((currentPage+1)*20,proposals.length)} / {proposals.length}</span><button disabled={(currentPage+1)*20>=proposals.length} onClick={()=>setPage(currentPage+1)}>Suivant</button></nav>:null}
    {Object.values(choices).some(Boolean)?<p className="small" role="status">{proposals.filter(p=>choices[p.row.id]).length} média(s) sélectionné(s), toutes pages confondues.</p>:null}
    {preview?<section className="planner-media-preview"><h3>{preview.name}</h3>{preview.type.startsWith('image/')?<img src={preview.url} alt="Média à vérifier"/>:<video src={preview.url} controls preload="metadata"/>}</section>:null}
    {canLearn&&directory.id!==localDirectory?.id?<><label className="check"><input type="checkbox" checked={learn} onChange={e=>{setLearn(e.target.checked);setReuse(false);}}/>Retenir ces associations pour les prochaines préparations de l’équipe</label>
    {learn?<label className="check"><input type="checkbox" checked={reuse} onChange={e=>setReuse(e.target.checked)}/><span>Réutiliser aussi les dossiers et habillages pour les prochains épisodes<small>Les fichiers restent propres à chaque épisode. Aucun ancien projet ne change.</small></span></label>:null}</>:null}
    {!canLearn?<p className="small muted">Reliez les médias à cette préparation, puis confirmez vos choix dans « Habitudes proposées ». Les règles d’équipe sont validées par la diffusion ou l’administration.</p>:null}
    <button className="primary" disabled={!Object.values(choices).some(Boolean)} onClick={()=>void apply()}><Check size={17} aria-hidden="true"/>Relier les médias sélectionnés</button>
   </>:null}
  </fieldset><div className="planner-dialog-footer"><button disabled={(!!busy&&!!control.current)||connectorBusy} onClick={onClose}>Terminer</button></div>
 </NewProjectDialog>;
}
