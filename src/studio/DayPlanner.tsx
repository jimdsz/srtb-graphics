import {lazy,Suspense,useEffect,useImperativeHandle,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import type {Ref} from 'react';
import {HelpBubble} from './GraphicsHelp';
import {CalendarDays,FileSpreadsheet,FolderSearch,ArrowRight,RefreshCw,Check,CheckCheck,ChevronDown,ChevronLeft,ChevronRight,Clapperboard,Clock3,Film,ImagePlus,Layers3,Link2,ListChecks,Mic2,Monitor,Newspaper,Save,Scissors,Search,Settings2,ShieldCheck,Smartphone,TriangleAlert,Tv,Upload,Users} from 'lucide-react';
import type {Member,Project} from './domain';
import type {WorkspaceNavigation} from './Workspace';
import type {ScheduleSheet} from './day-planner-import';
import {recommendedSheets} from './day-planner-recommendations';
import {MAX_PLANNER_TASKS,addDays,normalized,dateSchema,planSchema,plannerFormats,plannerKinds,plannerLabels,taskKey,timeSchema,linkedTasksForRow} from './day-planner-model';
import type {Plan,PlannerRecord,PlannerRow,PlannerSummary,PlannerTask,PlannerTaskChoice} from './day-planner-model';
import {plannerAPI} from './day-planner-api';
import {plannerProject,plannerSignature} from './day-planner-project';
import {createPlannerQueue,plannerRequest,plannerSelection} from './day-planner-queue';
import {api} from './api';
import Activity from './Activity';
import NewProjectDialog from './NewProjectDialog';
import PlannerMediaDialog from './PlannerMediaDialog';
import PlannerExcerptDialog from './PlannerExcerptDialog';
import PlannerLogoDialog from './PlannerLogoDialog';
import {applyPlannerLogoReview,undoPlannerLogoChanges} from './planner-logo-reuse';
import type {PlannerLogoReview,PlannerLogoChange} from './planner-logo-reuse';
import PlannerWeekly from './PlannerWeekly';
import PlannerWeeklyProposalDialog from './PlannerWeeklyProposalDialog';
import PlannerRecipes from './PlannerRecipes';
import PlannerRecipeEditor from './PlannerRecipeEditor';
import {applyRecipeChanges} from './planner-recipes';
import type {RecipeChange} from './planner-recipes';
import type {RecipeHabitObservation} from './planner-recipe-editor-model';
import {plannerVoiceDescription} from './planner-voice-ui';
import {plannerVoiceLabels} from './planner-voice-model';
import type {PlannerVoice,PlannerVoiceKind} from './planner-voice-model';
import {selectedPlannerVoice} from './planner-voice';
import {patchPlannerProgramme,plannerWeekly,setPlannerIncluded,updatePlannerWeekly,weeklyChoices} from './planner-weekly';
import type {PlannerWeekly as WeeklySettings} from './day-planner-model';
import {timeLabel} from './media-trim';
import PlannerBatchMedia from './PlannerBatchMedia';
import {connectedLocal,subscribeLocalMedia,localMediaSnapshot} from './local-media';
import {loadPlannerLinkedProject,loadPlannerList,loadPlannerPreparation,plannerMediaLabels,plannerMediaState} from './planner-resume';
import {checkedPlannerPreparation,PlannerPreparationError,plannerProblemLocation,plannerRowOrder} from './planner-validation';
import {pendingPlannerEditions,plannerCreationNotice,plannerTaskReview,reusePlannerChoices,updatedPlannerChoices} from './planner-task-review';
import {recurringProgramme} from './day-planner-recurrence';
import './day-planner.css';
import './planner-voice.css';
import {compareConductors} from './conductor-diff';
import type {ConductorDiff} from './conductor-diff';
import ConductorReview from './ConductorReview';
import PlannerTeamBoard from './PlannerTeamBoard';
import PlannerHabits from './PlannerHabits';
import PlannerProgrammeReview from './PlannerProgrammeReview';
import ProductionDossier from './ProductionDossier';
import {plannerEntryLocation} from './planner-entry';
import type {PlannerEntry} from './planner-entry';
import {activeChannelId} from './channel-context';
import {usePlannerLocalDrafts} from './usePlannerLocalDrafts';
import PlannerLocalRecovery,{PlannerLocalStatus} from './PlannerLocalRecovery';
import type {PlannerRecovery} from './PlannerLocalRecovery';
import {plannerRecoveryFingerprint} from './planner-local-recovery-model';
import {DERIVATIONS_ENABLED} from './derivation-feature';

const PlannerVoiceDialog=lazy(()=>import('./PlannerVoiceDialog'));
const ProgrammeProductionDossier=DERIVATIONS_ENABLED?lazy(()=>import('./ProgrammeProductionDossier')):null;
const formatLabels={tv:'TV · 16:9',portrait:'Portrait · 4:5',vertical:'Vertical · 9:16'};
const shortKinds={ba:'BA',popup:'Pop-up',tds:'Tout de suite',renvoi:'Renvoi',event:'Événement'};
const fullDate=new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'long'});
const shortDate=new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'short'});
const dayName=new Intl.DateTimeFormat('fr-FR',{weekday:'short'});
type VoiceTarget={kind:PlannerVoiceKind;rowId?:string};
type VoiceProblem={choice:PlannerTaskChoice;formats:PlannerTaskChoice['format'][];message:string};
function PlannerVoiceProblems({problems,plan,onFix}:{problems:VoiceProblem[];plan:Plan;onFix:(target:VoiceTarget)=>void}){
 if(!problems.length)return null;
 return <div className="planner-voice-problems" role="status" tabIndex={-1}><p><strong>Ces habillages restent à préparer.</strong> Leur voix doit être reconfirmée ou recalée. Les autres choix peuvent être créés ; votre préparation reste enregistrable.</p><ul>{problems.map(({choice,formats,message})=><li key={`${choice.kind}:${JSON.stringify(choice.rowIds)}`}><strong>{plannerVoiceLabels[choice.kind]} · {choice.kind==='weekly'?'Le semainier':plan.rows.find(row=>row.id===choice.rowIds[0])?.title}</strong><small>{formats.map(format=>formatLabels[format]).join(' · ')}</small><span>{message}</span><button type="button" onClick={()=>onFix({kind:choice.kind,rowId:choice.kind==='weekly'?undefined:choice.rowIds[0]})}><Mic2 size={16} aria-hidden="true"/>Corriger la voix et le calage</button></li>)}</ul></div>;
}
function asDate(value:string){return new Date(value+'T12:00:00');}
function ProgrammeIcon({row}:{row:PlannerRow}){
 const type=`${row.category} ${row.title}`.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const Icon=/journal|information|actualit/.test(type)?Newspaper:/film|serie|fiction|cinema/.test(type)?Film:/magazine|emission|debat/.test(type)?Tv:Clapperboard;
 return <Icon size={18} strokeWidth={1.7} aria-hidden="true"/>;
}
function SheetChoice({sheet,selected,date,onToggle,onDate}:{sheet:ScheduleSheet;selected:boolean;date:string;onToggle:(value:boolean)=>void;onDate:(value:string)=>void}){
 return <div className={`planner-sheet${selected?' is-selected':''}`}>
  <label className="check"><input type="checkbox" checked={selected} onChange={e=>onToggle(e.target.checked)}/><span><strong>{sheet.name}</strong><small>{sheet.layout==='week'?'Grille · 7 jours':'Conducteur'} · {sheet.rows.length} entrées</small></span></label>
  <label className="planner-sheet-date">Premier jour<input type="date" value={date} onChange={e=>onDate(e.target.value)}/></label>
  {sheet.warnings.map(w=><p key={w} className="planner-sheet-warning"><TriangleAlert size={14} aria-hidden="true"/>{w}</p>)}
 </div>;
}
function readWorkbook(buffer:ArrayBuffer,name:string,year:number,signal:AbortSignal):Promise<ScheduleSheet[]>{
 if(/\.pdf$/i.test(name))return import('./day-planner-pdf-reader').then(({readPDFSchedule})=>readPDFSchedule(buffer,name,year,signal));
 return new Promise((resolve,reject)=>{const worker=new Worker(new URL('./day-planner.worker.ts',import.meta.url),{type:'module'});let done=false;
  const finish=(error?:unknown,sheets?:ScheduleSheet[])=>{if(done)return;done=true;clearTimeout(timeout);signal.removeEventListener('abort',abort);worker.terminate();if(error)reject(error);else resolve(sheets!);};
  const abort=()=>finish(new DOMException('Import annulé.','AbortError')),timeout=setTimeout(()=>finish(Error('Lecture trop longue : enregistrez seulement les feuilles utiles dans un nouveau XLSX.')),30000);
  signal.addEventListener('abort',abort,{once:true});worker.onerror=()=>finish(Error('Le classeur n’a pas pu être lu. Enregistrez-le à nouveau en XLSX.'));
  worker.onmessage=e=>e.data.error?finish(Error(e.data.error)):finish(undefined,e.data.sheets);worker.postMessage({buffer,name,year},[buffer]);if(signal.aborted)abort();
 });
}
export default function DayPlanner({member,onOpenProject,navigationRef,entry,onEntryConsumed}:{member:Member;onOpenProject:(project:Project,target?:'settings'|'exports')=>void;navigationRef?:Ref<WorkspaceNavigation>;entry?:PlannerEntry;onEntryConsumed?:()=>void}){
 useSyncExternalStore(subscribeLocalMedia,localMediaSnapshot,localMediaSnapshot);
 const [plans,setPlans]=useState<PlannerSummary[]>([]),[next,setNext]=useState<number|null>(null);
 const [listsLoading,setListsLoading]=useState(true),initialLists=useRef<AbortController|null>(null);
 const [record,setRecord]=useState<PlannerRecord<Plan>|null>(null),[plan,setPlan]=useState<Plan|null>(null),[draftId,setDraftId]=useState(''),[tasks,setTasks]=useState<PlannerTask[]>([]);
 const [sheets,setSheets]=useState<ScheduleSheet[]>([]),[checked,setChecked]=useState<string[]>([]),[dates,setDates]=useState<Record<string,string>>({}),[confirmed,setConfirmed]=useState(false);
 const [source,setSource]=useState({name:'',hash:''}),[year,setYear]=useState(new Date().getFullYear());
 const [comparing,setComparing]=useState(false),[conductorDiff,setConductorDiff]=useState<ConductorDiff|null>(null);
 const [day,setDay]=useState(''),[filter,setFilter]=useState(''),[excluded,setExcluded]=useState(false),[page,setPage]=useState(0),[mediaRow,setMediaRow]=useState<string|null>(null);
 const [inspecting,setInspecting]=useState<string|null>(null);
 const [productionDossier,setProductionDossier]=useState<{planId:string;revision:number;rowId:string}|null>(null);
 const [programmeReview,setProgrammeReview]=useState(false);
 const [recipeEdit,setRecipeEdit]=useState<{rowId:string;observation?:RecipeHabitObservation}|null>(null),[recipeUndo,setRecipeUndo]=useState<RecipeChange|null>(null);
 const weekly=plannerWeekly(plan).rowIds;
 function changeWeekly(patch:Partial<WeeklySettings>){setPlan(current=>current?updatePlannerWeekly(current,patch):current);}
 const [batchMedia,setBatchMedia]=useState(false);
 const [weeklyProposalOpen,setWeeklyProposalOpen]=useState(false);
 const [excerptRow,setExcerptRow]=useState<string|null>(null);
 const [logoRow,setLogoRow]=useState<string|null>(null);
 const [logoUndo,setLogoUndo]=useState<{review:PlannerLogoReview;changes:PlannerLogoChange[];context:string}|null>(null);
 const [logoNotice,setLogoNotice]=useState('');
 const [voiceTarget,setVoiceTarget]=useState<VoiceTarget|null>(null),[voiceProblems,setVoiceProblems]=useState<VoiceProblem[]>([]);
 const [confirmTasks,setConfirmTasks]=useState<PlannerTaskChoice[]|null>(null),[leave,setLeave]=useState<{next:()=>void}|null>(null);
 const [queuedChoices,setQueuedChoices]=useState<PlannerTaskChoice[]|null>(null),[confirmLimit,setConfirmLimit]=useState(20),[stopping,setStopping]=useState(false);
 const [includeSignature,setIncludeSignature]=useState(true);
 const [busy,setBusy]=useState(''),[percent,setPercent]=useState<number>(),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [problem,setProblem]=useState<PlannerPreparationError|null>(null),[focusProblem,setFocusProblem]=useState<PlannerPreparationError|null>(null);
 const section=useRef<HTMLElement|null>(null),rowElements=useRef(new Map<string,HTMLElement>());
 const controller=useRef<AbortController|null>(null),lock=useRef(false);
 const entryHandled=useRef(''),latestEntry=useRef(''),entryLoading=useRef('');
 const [failedEntry,setFailedEntry]=useState<PlannerEntry|null>(null);
 if(entry)latestEntry.current=entry.requestId;
 const dirty=useMemo(()=>!!plan&&plannerRecoveryFingerprint(plan)!==plannerRecoveryFingerprint(record?.data),[plan,record?.data]),recommended=recommendedSheets(sheets,source.name);
 const channel=activeChannelId(),local=usePlannerLocalDrafts(member.email,channel,{plan,base:record,draftId,dirty});
 const logoContext=JSON.stringify([member.email,member.role,member.active,channel,draftId]),latestLogoContext=useRef(logoContext);latestLogoContext.current=logoContext;
 useEffect(()=>{setLogoUndo(null);setLogoNotice('');},[logoContext]);
 const editing=useRef({draftId,plan,owner:member.email});editing.current={draftId,plan,owner:member.email};
 const alive=useRef(false);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 function restoreLocal(value:PlannerRecovery){
  setRecipeEdit(null);setRecipeUndo(null);setLogoUndo(null);setLogoNotice('');local.begin(value.draftId,value.source);setDraftId(value.draftId);setRecord(value.record);setPlan(value.plan);setTasks(value.tasks);
  setQueuedChoices(null);setConfirmTasks(null);setVoiceProblems([]);setVoiceTarget(null);setMediaRow(null);setLogoRow(null);setExcerptRow(null);setBatchMedia(false);setWeeklyProposalOpen(false);setProgrammeReview(false);setConductorDiff(null);
  setSheets([]);setFailedEntry(null);setInspecting(null);setDay([...new Set(value.plan.rows.map(row=>row.broadcastDate))].sort()[0]||'');setPage(0);setFilter('');setExcluded(false);setError('');setProblem(null);
  setNotice(value.record?'Copie locale reprise après vérification de la préparation partagée. Aucun projet n’a été modifié.':'Copie locale reprise, non partagée. Aucun projet ni tâche n’a été créé.');
 }
 useImperativeHandle(navigationRef,()=>({leave:next=>{if(dirty||busy||sheets.length)setLeave({next});else next();}}),[dirty,busy,sheets.length]);
 useEffect(()=>{const check=(e:BeforeUnloadEvent)=>{if(dirty||busy){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',check);return()=>window.removeEventListener('beforeunload',check);},[dirty,busy]);
 useEffect(()=>{
  const c=new AbortController();initialLists.current=c;setListsLoading(true);
  void loadPlannerList(s=>plannerAPI.list('plan',0,undefined,s),c.signal).then(result=>{
   if(!c.signal.aborted){setPlans(result.documents);setNext(result.next);}
  }).catch(e=>{if(!c.signal.aborted)setError(e instanceof Error?e.message:String(e));}).finally(()=>{
   if(initialLists.current===c){initialLists.current=null;setListsLoading(false);}
  });
  return()=>{c.abort();if(initialLists.current===c)initialLists.current=null;controller.current?.abort();};
 },[]);
 function showError(e:unknown){setProblem(e instanceof PlannerPreparationError?e:null);if(e instanceof PlannerPreparationError)setLeave(null);setError(e instanceof Error?e.message:String(e));}
 useEffect(()=>{
  if(!focusProblem||busy)return;
  const container=focusProblem.rowId?rowElements.current.get(focusProblem.rowId):section.current;
  const details=container?.querySelector('details.planner-row-settings');if(details instanceof HTMLDetailsElement)details.open=true;
  const control=container?.querySelector<HTMLElement>(`[name="${focusProblem.field}"]`);
  if(control){control.focus({preventScroll:true});control.scrollIntoView({block:'center'});}else container?.scrollIntoView({block:'center'});
  setFocusProblem(null);
 },[focusProblem,busy]);
 function locateProblem(){if(!problem||!plan)return;const location=plannerProblemLocation(plan,problem);if(location){setDay(location.day);setPage(location.page);setExcluded(location.excluded);setFilter('');}if(problem.rowId)setInspecting(problem.rowId);setFocusProblem(problem);}
 async function run(label:string,fn:(signal:AbortSignal)=>Promise<void>,stoppedMessage='Traitement arrêté. Les brouillons déjà créés sont conservés ; vous pouvez reprendre sans doublons.'){if(lock.current)return;lock.current=true;initialLists.current?.abort();initialLists.current=null;setListsLoading(false);const c=new AbortController();controller.current=c;setStopping(false);setBusy(label);setPercent(undefined);setError('');setProblem(null);setNotice('');try{await fn(c.signal);}catch(e){if(c.signal.aborted)setNotice(stoppedMessage);else showError(e);}finally{setBusy('');setPercent(undefined);setStopping(false);lock.current=false;}}
 async function refreshLists(offset=0){await run(offset?'Lecture des autres listes':'Actualisation des listes',async signal=>{
  const result=await loadPlannerList(s=>plannerAPI.list('plan',offset,undefined,s),signal);
  signal.throwIfAborted();setPlans(p=>offset?[...p,...result.documents.filter(d=>!p.some(item=>item.id===d.id))]:result.documents);setNext(result.next);
 },'Lecture arrêtée. Votre préparation et les listes déjà affichées restent conservées.');}
 async function openLinkedProject(id:string,target:'settings'|'exports'='settings'){await run('Ouverture du projet lié',async signal=>{
  const project=await loadPlannerLinkedProject(id,api.project,signal);signal.throwIfAborted();onOpenProject(project,target);
 },'Ouverture arrêtée. Vous restez dans votre préparation.');}
 async function saveThenContinue(){
  if(!leave||lock.current)return;
  const nextAction=leave.next;let saved=false;
  await run('Enregistrement de la préparation',async signal=>{await save();signal.throwIfAborted();saved=true;});
  // Start the next operation only after the save has released the busy lock.
  if(saved){setLeave(null);nextAction();}
 }
 async function keepLocalThenContinue(){
  if(!leave||lock.current)return;
  const nextAction=leave.next;let kept=false;
  await run('Conservation sur ce poste',async signal=>{if(plan&&dirty)await local.flush();signal.throwIfAborted();kept=true;},'Vous restez dans votre préparation.');
  if(kept&&alive.current&&activeChannelId()===channel){setLeave(null);nextAction();}
 }
 function safely(next:()=>void){if(dirty||sheets.length)setLeave({next});else next();}
 function focusEntry(data:Plan,revision:number,target:PlannerEntry){
  const location=plannerEntryLocation(data,target.rowId);
  setDay(location.day);setPage(location.page);setExcluded(location.excluded);setFilter('');setInspecting(target.rowId);
  if(revision!==target.planRevision)setNotice(`La préparation a évolué depuis l’accueil. Vous consultez la version actuelle r${revision}${dirty&&record?.id===target.planId?' avec vos retouches conservées':''}.`);
 }
 async function load(id:string,target?:PlannerEntry){
  if(lock.current)return;
  entryLoading.current=target?.requestId||'';
  let opened=false;
  await run('Ouverture de la préparation',async signal=>{
   const {record:r,tasks:loaded}=await loadPlannerPreparation(id,plannerAPI,signal);signal.throwIfAborted();
   if(target&&target.requestId!==latestEntry.current)return;
   // Validate the destination before replacing any current preparation.
   if(target)plannerEntryLocation(r.data,target.rowId);
   setRecipeEdit(null);setRecipeUndo(null);setLogoUndo(null);setLogoNotice('');setLogoRow(null);local.begin(id);setRecord(r);setPlan(r.data);setDraftId(id);setTasks(loaded);setQueuedChoices(null);setVoiceProblems([]);setVoiceTarget(null);setSheets([]);setFailedEntry(null);
   setPlans(current=>[{id:r.id,revision:r.revision,kind:'plan',name:r.data.name,updatedAt:r.updatedAt,archived:false},...current.filter(item=>item.id!==r.id)]);
   setDay([...new Set(r.data.rows.map(row=>row.broadcastDate))].sort()[0]||'');setPage(0);setFilter('');setExcluded(false);setInspecting(null);
   if(target)focusEntry(r.data,r.revision,target);
   opened=true;
  },'Ouverture arrêtée. Votre préparation actuelle reste conservée.');
  entryLoading.current='';
  if(target&&!opened&&target.requestId===latestEntry.current)setFailedEntry(target);
 }
 useEffect(()=>{
  if(!entry||entryHandled.current===entry.requestId)return;
  // Only supersede our own read. Never interrupt an import, save or creation.
  if(lock.current){if(entryLoading.current&&entryLoading.current!==entry.requestId)controller.current?.abort();return;}
  const target=entry;entryHandled.current=target.requestId;setFailedEntry(null);
  if(record?.id===target.planId&&plan){
   try{setError('');focusEntry(plan,record.revision,target);}catch(cause){showError(cause);}
  }else safely(()=>void load(target.planId,target));
  onEntryConsumed?.();
  // A queued entry is reconsidered after the busy operation has released its lock.
  // Current edits are read only at the moment this navigation intent is consumed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[entry?.requestId,busy]);
 async function save(){
  if(!plan)throw Error('Importez une préparation.');
  const data=checkedPlannerPreparation(plan),id=record?.id||draftId,snapshot=JSON.stringify(plan);
  // A local storage failure must never disable the explicit team save.
  const receipt=await local.flush().catch(()=>null);
  if(!alive.current||activeChannelId()!==channel||editing.current.draftId!==id||editing.current.owner!==member.email)throw new DOMException('Le contexte de préparation a changé.','AbortError');
  const saved=await plannerRequest(signal=>plannerAPI.save(id,record?.revision||0,data,signal));
  if(alive.current&&activeChannelId()===channel&&editing.current.draftId===id&&editing.current.owner===member.email){
   setRecord(saved);if(JSON.stringify(editing.current.plan)===snapshot)setPlan(saved.data);
   setPlans(p=>[{id:saved.id,revision:saved.revision,kind:'plan',name:saved.data.name,updatedAt:saved.updatedAt,archived:false},...p.filter(item=>item.id!==saved.id)]);
  }
  await local.saved(receipt,plan);
  return saved;
 }
 function undoAdaptedRecipe(){if(!plan||!recipeUndo)return;const result=applyRecipeChanges(plan,[recipeUndo],true);setPlan(result.plan);setRecipeUndo(null);setNotice(result.applied.length?'Dernière adaptation annulée dans la préparation uniquement. Les règles et projets restent intacts.':'La ligne a été retouchée depuis. Vos choix actuels sont conservés.');}
 function applyLogo(review:PlannerLogoReview,selectedIds:string[],replaceIds:string[]){
  const current=editing.current.plan;if(!current||member.active!==1||activeChannelId()!==channel||latestLogoContext.current!==logoContext)return;
  const result=applyPlannerLogoReview(current,review,selectedIds,replaceIds);setPlan(result.plan);
  if(result.changes.length)setLogoUndo({review,changes:result.changes,context:logoContext});
  setNotice('');setLogoNotice(result.sourceChanged?'Contexte changé : aucun logo modifié.':`${result.changes.length} ${result.changes.length>1?'logos appliqués':'logo appliqué'} localement.${result.skipped.length?` ${result.skipped.length} ligne(s) conservée(s).`:''}`);
 }
 function undoLogo(){
  if(!plan||!logoUndo||member.active!==1||activeChannelId()!==channel||logoUndo.context!==logoContext)return;
  const result=undoPlannerLogoChanges(plan,logoUndo.review,logoUndo.changes);setPlan(result.plan);setLogoUndo(null);
  setNotice('');setLogoNotice(result.changes.length?`${result.changes.length} ${result.changes.length>1?'logos rétablis':'logo rétabli'} localement.${result.skipped.length?' Choix ultérieurs conservés.':''}`:'Lignes ou logos modifiés depuis : choix actuels conservés.');
 }
 function changeRow(id:string,patch:Partial<PlannerRow>){setPlan(p=>p?patchPlannerProgramme(p,id,patch):p);}
 function closeInspector(){const id=inspecting;setInspecting(null);requestAnimationFrame(()=>{const target=id?rowElements.current.get(id)?.querySelector<HTMLElement>('.planner-item-open'):null;(target??section.current?.querySelector<HTMLElement>('.planner-filters input[type="search"]'))?.focus({preventScroll:true});});}
 function changeVoice(target:VoiceTarget,value?:PlannerVoice){
  if(target.kind==='weekly')changeWeekly({voice:value});
  else{const kind=target.kind;setPlan(current=>{const row=current?.rows.find(row=>row.id===target.rowId);if(!current||!row)return current;const voices={...row.voices};if(value)voices[kind]=value;else delete voices[kind];return patchPlannerProgramme(current,row.id,{voices:Object.keys(voices).length?voices:undefined});});}
  setVoiceProblems(problems=>problems.filter(problem=>problem.choice.kind!==target.kind||(target.kind!=='weekly'&&problem.choice.rowIds[0]!==target.rowId)));
 }
 async function importFile(file:File){await run(/\.pdf$/i.test(file.name)?'Lecture locale du conducteur PDF':'Lecture locale du classeur',async signal=>{if(!/\.(xlsx|pdf)$/i.test(file.name)||file.size>10*1024**2)throw Error('Choisissez un fichier XLSX ou un conducteur PDF avec texte sélectionnable, de 10 Mo maximum.');const buffer=await file.arrayBuffer();signal.throwIfAborted();const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),n=>n.toString(16).padStart(2,'0')).join('');const parsed=await readWorkbook(buffer,file.name,year,signal);signal.throwIfAborted();if(!parsed.some(s=>s.rows.length))throw Error('Aucun tableau reconnu. Il faut une colonne « Horaire » et « Description », ou les sept jours de la semaine.');setSource({name:file.name.slice(0,200),hash});setSheets(parsed);setDates(Object.fromEntries(parsed.map(s=>[s.name,s.date])));setChecked([]);setConfirmed(false);});}
 function acceptSheets(){
  try{
   const selected=sheets.filter(s=>checked.includes(s.name));if(!selected.length||!confirmed)throw Error('Choisissez les feuilles et confirmez leurs dates.');
   const covered=new Set<string>(),rows:PlannerRow[]=[];
   for(const sheet of selected){const date=dateSchema.parse(dates[sheet.name]);for(let i=0;i<(sheet.layout==='week'?7:1);i++){const d=addDays(date,i);if(covered.has(d))throw Error('Deux feuilles couvrent la même journée. Choisissez le conducteur OU la grille pour cette date.');covered.add(d);}
    const offset=Math.round((Date.parse(date)-Date.parse(sheet.date))/86400000);
    rows.push(...sheet.rows.map(row=>({...row,broadcastDate:addDays(row.broadcastDate,offset),airDate:addDays(row.airDate,offset)})));
   }
   if(rows.length>600)throw Error('Limite de 600 lignes par préparation. Séparez les semaines.');
   const data:Plan={kind:'plan',name:`Habillage · ${[...covered].sort()[0]}`,source:source.name,sourceHash:source.hash,rows,sourceRows:structuredClone(rows)};
   if(comparing&&plan){setConductorDiff(compareConductors(plan,data));return;}
   const newId=crypto.randomUUID();setRecipeEdit(null);setRecipeUndo(null);setLogoUndo(null);setLogoNotice('');setLogoRow(null);local.begin(newId);setPlan(planSchema.parse(data));setRecord(null);setDraftId(newId);setTasks([]);setQueuedChoices(null);setVoiceProblems([]);setVoiceTarget(null);setSheets([]);setDay([...covered].sort()[0]||'');setPage(0);setNotice('La première journée est prête à préparer. Vérifiez ses médias, ses titres et ses horaires.');
  }catch(e){setError(e instanceof Error?e.message:String(e));}
 }
 const visible=(plan?.rows.filter(r=>(!day||r.broadcastDate===day)&&(excluded||r.included)&&`${r.title} ${r.subtitle} ${r.category}`.toLocaleLowerCase('fr').includes(filter.toLocaleLowerCase('fr')))||[]).sort(plannerRowOrder);
 const pageRows=visible.slice(page*20,(page+1)*20);
 // Keep the open inspector mounted when a title/hour edit changes the filtered
 // page. Closing it returns the list to its normal filter and pagination.
 if(inspecting&&!pageRows.some(row=>row.id===inspecting)){const row=plan?.rows.find(row=>row.id===inspecting);if(row)pageRows.push(row);}
 const selected=visible.filter(r=>r.included);
 const productionSelected=selected.filter(r=>r.kinds.length>0||weekly.includes(r.id));
 const dayKeys=[...new Set(plan?.rows.map(r=>r.broadcastDate)||[])].sort();
 const missingMedia=productionSelected.filter(r=>!r.media).length,missingTime=productionSelected.filter(r=>!timeSchema.safeParse(r.time).success).length;
 const reconnectMedia=productionSelected.filter(r=>r.media&&!connectedLocal(r.media.url)).length;
 const mediaToPrepare=missingMedia+reconnectMedia;
 const choiceCount=selected.reduce((total,row)=>total+row.kinds.length*row.formats.length,0);
 const otherSheets=sheets.filter(sheet=>sheet.rows.length&&!recommended.includes(sheet.name));
 const generated=new Map(tasks.map(t=>[t.key,t]));
 function propose(choices:PlannerTaskChoice[],known=tasks){try{
  if(!plan)return;const selection=plannerSelection(reusePlannerChoices(choices,known),known),existing=new Set(known.map(task=>task.key));
  checkedPlannerPreparation(plan,selection.choices.filter(c=>!existing.has(taskKey(c))).flatMap(c=>c.rowIds));
  const ready:PlannerTaskChoice[]=[],blocked=new Map<string,VoiceProblem>();
  for(const choice of selection.choices){
   if(!existing.has(taskKey(choice))&&selectedPlannerVoice(plan,choice)){
    try{plannerProject(plan,choice);}catch(cause){const key=`${choice.kind}:${JSON.stringify(choice.rowIds)}`,previous=blocked.get(key);if(previous)previous.formats.push(choice.format);else blocked.set(key,{choice,formats:[choice.format],message:cause instanceof Error?cause.message:String(cause)});continue;}
   }
   ready.push(choice);
  }
  setVoiceProblems([...blocked.values()]);setError('');setProblem(null);setConfirmLimit(20);setConfirmTasks(ready.length?ready:null);
  if(!ready.length&&blocked.size)requestAnimationFrame(()=>{const message=section.current?.querySelector<HTMLElement>('.planner-voice-problems');message?.focus({preventScroll:true});message?.scrollIntoView({block:'center'});});
 }catch(e){setConfirmTasks(null);showError(e);}}
 async function resume(){if(!queuedChoices)return;await run('Vérification des brouillons enregistrés',async signal=>{const fresh=record?await plannerRequest(s=>plannerAPI.tasks(record.id,s)):{tasks};signal.throwIfAborted();setTasks(fresh.tasks);propose(queuedChoices,fresh.tasks);});}
 const signatureCount=confirmTasks?.filter(c=>!generated.has(taskKey(c))&&plannerSignature(c.kind)).length||0;
 const newChoices=confirmTasks?.filter(c=>!generated.has(taskKey(c)))??[],voicedChoices=plan?newChoices.filter(c=>!!selectedPlannerVoice(plan,c)).length:0;
 const currentPreparationRevision=(record?.revision||0)+(dirty?1:0);
 const refreshedChoices=updatedPlannerChoices(confirmTasks||[],tasks,currentPreparationRevision);
 const staleEditions=pendingPlannerEditions(confirmTasks||[],tasks,currentPreparationRevision);
 const voiceRow=voiceTarget?.rowId?plan?.rows.find(row=>row.id===voiceTarget.rowId):undefined;
 async function create(){const choices=confirmTasks?.map(c=>({...c,signature:includeSignature&&!generated.has(taskKey(c))&&!!plannerSignature(c.kind)}));if(!choices)return;setConfirmTasks(null);setQueuedChoices(choices);await run('Vérification et préparation des brouillons',async signal=>{const saved=dirty?await save():record!;const result=await createPlannerQueue({record:saved,choices,api:plannerAPI,signal,onProgress:state=>{setTasks(state.tasks);setPercent(state.completed/state.total*100);setBusy(`Préparation des habillages · ${state.completed} / ${state.total}`);}});setQueuedChoices(null);setNotice(plannerCreationNotice(result.confirmedNew,result.existing));});}
 return <section className={`day-planner${plan?' has-plan':''}`} ref={section}>
  <div className="section-heading planner-heading">
   <div><div className="help-title-row"><h1>À faire</h1><HelpBubble section="planner" role={member.role}/></div>{!plan?<p>Préparez les habillages à partir de votre conducteur.</p>:null}</div>
   <ol className="planner-steps" aria-label="Étapes de préparation">
    <li className={plan?'is-complete':'is-current'} aria-current={!plan?'step':undefined}><span>{plan?<Check size={16} aria-hidden="true"/>:<Upload size={16} aria-hidden="true"/>}</span>Importer</li>
    <li className={plan?'is-current':''} aria-current={plan?'step':undefined}><span><ListChecks size={16} aria-hidden="true"/></span>Préparer</li>
    <li className={tasks.length?'is-complete':''}><span><Layers3 size={16} aria-hidden="true"/></span>Créer</li>
   </ol>
  </div>
  {error&&!leave?<div className="notice error" role="alert"><p>{error}</p><div className="row">{failedEntry?<button onClick={()=>safely(()=>void load(failedEntry.planId,failedEntry))}>Réessayer l’ouverture</button>:null}{problem?<button onClick={locateProblem}>Voir le champ à corriger</button>:null}<button className="quiet" onClick={()=>{setError('');setProblem(null);}}>Fermer</button></div></div>:null}{notice?<p className="notice" role="status">{notice}{recipeUndo?<button type="button" className="quiet" onClick={undoAdaptedRecipe}>Annuler la dernière adaptation</button>:null}</p>:null}
  {plan&&!confirmTasks?<PlannerVoiceProblems problems={voiceProblems} plan={plan} onFix={setVoiceTarget}/>:null}
  {busy?<div className="planner-busy"><Activity label={busy} percent={percent}/><button disabled={stopping} onClick={()=>{setStopping(true);controller.current?.abort();}}>{stopping?'Arrêt demandé…':'Arrêter après l’opération en cours'}</button></div>:null}
  {!busy&&queuedChoices?<div className="planner-queue-resume"><Layers3 size={20} aria-hidden="true"/><span><strong>{queuedChoices.filter(c=>generated.has(taskKey(c))).length} / {queuedChoices.length} confirmés</strong><small>La reprise vérifie les projets enregistrés avant de créer ceux qui manquent.</small></span><button onClick={()=>void resume()}>Reprendre la préparation<ArrowRight size={17} aria-hidden="true"/></button>{record?<button className="quiet" onClick={()=>safely(()=>void load(record.id))}>Recharger la liste partagée</button>:null}</div>:null}
  <PlannerLocalRecovery local={local} channel={channel} contextKey={JSON.stringify([member.email,channel,draftId,plan])} hasPlan={!!plan} disabled={!!busy} onRequest={safely} onRestore={restoreLocal}/>
  <details className="planner-source" open={!plan&&!sheets.length}>
   <summary><FileSpreadsheet size={18} aria-hidden="true"/><span>{sheets.length?source.name:plan?plan.source:'Votre point de départ'}</span><span className="planner-source-action">{plan||sheets.length?'Changer de grille':'Importer ou reprendre'}<ChevronDown size={16} aria-hidden="true"/></span></summary>
   <fieldset disabled={!!busy} className="planner-entry">
    <div className="planner-entry-card">
     <div className="planner-entry-heading"><span className="planner-entry-icon"><FileSpreadsheet size={24} strokeWidth={1.5} aria-hidden="true"/></span><div><strong>Une nouvelle grille</strong><p>Excel · grille ou conducteur ; PDF · conducteur</p></div></div>
     <label className="planner-file-button"><span><Upload size={18} aria-hidden="true"/>Importer un Excel ou PDF</span><input type="file" accept=".xlsx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)safely(()=>{setComparing(false);void importFile(f);});}}/></label>
     {plan&&<label className="planner-file-button"><span><RefreshCw size={18}/>Comparer avec un conducteur actualisé</span><input type="file" accept=".xlsx,.pdf" onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f){setComparing(true);void importFile(f);}}}/></label>}
     <div className="planner-import-options"><label>Année de référence<input aria-label="Année de référence" type="number" min="2000" max="2100" value={year} onChange={e=>setYear(Number(e.target.value))}/></label><span className="planner-local-note"><ShieldCheck size={15} aria-hidden="true"/>Lecture locale · 10 Mo max.</span></div>
    </div>
    <div className="planner-entry-card">
     <div className="planner-entry-heading"><span className="planner-entry-icon"><Users size={24} strokeWidth={1.5} aria-hidden="true"/></span><div><strong>Une préparation en cours</strong><p>Retrouvez le travail de l’équipe</p></div></div>
     <label>Reprendre une préparation d’équipe<select value={record?.id||''} onChange={e=>{const id=e.target.value;if(id)safely(()=>void load(id));}}><option value="">Choisir une liste partagée</option>{plans.map(p=><option key={p.id} value={p.id}>{p.name} · r{p.revision}</option>)}</select></label>
     {listsLoading?<p className="small muted" role="status">Lecture des listes… Vous pouvez déjà importer un Excel ou PDF.</p>:null}
     <div className="row"><button className="quiet" onClick={()=>void refreshLists()}><RefreshCw size={15} aria-hidden="true"/>Actualiser</button>{next!==null?<button className="quiet" onClick={()=>void refreshLists(next)}>Plus de listes</button>:null}</div>
    </div>
   </fieldset>
  </details>
  {sheets.length?<section className="planner-sheet-review">
   <div className="planner-section-title"><div><p className="eyebrow">01 / Importer</p><h2>{/\.pdf$/i.test(source.name)?'Vérifier le conducteur PDF':'Choisir la bonne semaine'}</h2><p className="small">{/\.pdf$/i.test(source.name)?`${sheets.reduce((count,sheet)=>count+sheet.rows.length,0)} entrées reconnues · fichier lu sur votre poste`:`${sheets.length} feuilles dans le classeur · ${checked.length} sélectionnées`}</p></div><CalendarDays size={28} strokeWidth={1.5} aria-hidden="true"/></div>
   {recommended.length?<div className="planner-recommendation"><div><CheckCheck size={20} aria-hidden="true"/><span><strong>{recommended.length} conducteurs proposés</strong><small>Dates du fichier · horaires détaillés</small></span></div><button onClick={()=>{setChecked(recommended);setConfirmed(false);}}>Sélectionner les feuilles proposées<Check size={16} aria-hidden="true"/></button></div>:null}
   <div className="planner-sheet-list">{sheets.filter(s=>s.rows.length&&(recommended.length?recommended.includes(s.name):true)).map(sheet=><SheetChoice key={sheet.name} sheet={sheet} selected={checked.includes(sheet.name)} date={dates[sheet.name]} onToggle={value=>{setChecked(v=>value?[...v,sheet.name]:v.filter(n=>n!==sheet.name));setConfirmed(false);}} onDate={value=>{setDates(d=>({...d,[sheet.name]:value}));setConfirmed(false);}}/>)}</div>
   {recommended.length&&otherSheets.length?<details className="planner-other-sheets"><summary><Layers3 size={17} aria-hidden="true"/>Autres feuilles du classeur <span>{otherSheets.length}{checked.some(name=>otherSheets.some(s=>s.name===name))?` · ${checked.filter(name=>otherSheets.some(s=>s.name===name)).length} sélectionnées`:''}</span><ChevronDown size={16} aria-hidden="true"/></summary><div className="planner-sheet-list">{otherSheets.map(sheet=><SheetChoice key={sheet.name} sheet={sheet} selected={checked.includes(sheet.name)} date={dates[sheet.name]} onToggle={value=>{setChecked(v=>value?[...v,sheet.name]:v.filter(n=>n!==sheet.name));setConfirmed(false);}} onDate={value=>{setDates(d=>({...d,[sheet.name]:value}));setConfirmed(false);}}/>)}</div></details>:null}
   {/\.pdf$/i.test(source.name)?<details className="planner-help"><summary>Vérifier les lignes reconnues<ChevronDown size={15} aria-hidden="true"/></summary><ol>{sheets.flatMap(sheet=>sheet.rows.map(row=><li key={row.id}><strong>{row.time||'Horaire à renseigner'}</strong> · {row.raw}<small> · {row.cell}{row.airDate!==row.broadcastDate?' · après minuit, lendemain':''}{row.duration!==null?` · durée ${Math.round(row.duration/60)} min`:''}</small>{row.issues.length?<p className="small">{row.issues.join(' ')}</p>:null}</li>))}</ol></details>:<p className="small muted">Une seule feuille par journée.{sheets.some(s=>!s.rows.length)?` ${sheets.filter(s=>!s.rows.length).length} feuilles sans tableau reconnu, ignorées.`:''}</p>}
   <div className="planner-sheet-confirm"><label className="check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>{/\.pdf$/i.test(source.name)?'J’ai vérifié la date, les titres et les horaires du conducteur PDF':'J’ai vérifié les onglets et les dates sélectionnés'}</label><div className="row"><button className="primary" disabled={!checked.length||!confirmed} onClick={acceptSheets}>Préparer ma liste <ArrowRight size={17} aria-hidden="true"/></button><button className="quiet" onClick={()=>setSheets([])}>Annuler l’import</button></div></div>
  </section>:null}
  {plan&&!sheets.length?<>
   <fieldset disabled={!!busy} className="planner-review">
    <div className="planner-toolbar"><label><span className="sr-only">Nom de la préparation</span><input name="name" maxLength={120} value={plan.name} onChange={e=>setPlan({...plan,name:e.target.value})}/></label><button disabled={!dirty} onClick={()=>void run('Enregistrement de la liste pour l’équipe',async()=>{await save();setNotice('Liste enregistrée et partagée. Le classeur et les médias restent sur votre poste.');})}><Save size={17} aria-hidden="true"/>{record?'Enregistrer les modifications':'Enregistrer pour l’équipe'}</button>{record?<button className="icon-button" aria-label="Recharger la version partagée" title="Recharger la version partagée" onClick={()=>safely(()=>void load(record.id))}><RefreshCw size={17} aria-hidden="true"/></button>:null}{logoUndo&&logoUndo.context===logoContext?<button type="button" className="quiet planner-logo-undo" onClick={undoLogo}>Annuler le dernier choix de logo</button>:null}</div>
    <div className="planner-save-line"><p className={`planner-save-state${dirty?' is-unsaved':''}`}>{dirty?<Clock3 size={14} aria-hidden="true"/>:<Check size={14} aria-hidden="true"/>}{record?`Révision ${record.revision}`:'Préparation locale'} · {dirty?'modifications non enregistrées':'partagée avec l’équipe'}</p>
    {dirty||local.writeError||local.cleanupError?<PlannerLocalStatus local={local}/>:null}{logoNotice?<span className="planner-logo-result" role="status">{logoNotice}</span>:null}</div>
    <div className="planner-filters"><label>Journée de grille<select value={day} onChange={e=>{setDay(e.target.value);setPage(0);}}><option value="">Toutes les journées</option>{dayKeys.map(d=><option key={d} value={d}>{fullDate.format(asDate(d))}</option>)}</select></label><label>Programme<span className="search-control"><Search size={17} aria-hidden="true"/><input type="search" value={filter} onChange={e=>{setFilter(e.target.value);setPage(0);}} placeholder="Rechercher un programme…"/></span></label><label className="check"><input type="checkbox" checked={excluded} onChange={e=>{setExcluded(e.target.checked);setPage(0);}}/>Voir aussi les lignes écartées</label></div>
    <div className="planner-counts" aria-label="État de la préparation"><span><ListChecks size={20} strokeWidth={1.6} aria-hidden="true"/><strong>{selected.length}</strong><span>programmes retenus</span></span><span className={mediaToPrepare?'needs-attention':''}><ImagePlus size={20} strokeWidth={1.6} aria-hidden="true"/><strong>{mediaToPrepare}</strong><span>médias à préparer{reconnectMedia?<small>{reconnectMedia} à reconnecter</small>:null}</span></span><span className={missingTime?'needs-attention':''}><Clock3 size={20} strokeWidth={1.6} aria-hidden="true"/><strong>{missingTime}</strong><span>horaires à compléter</span></span><span><Layers3 size={20} strokeWidth={1.6} aria-hidden="true"/><strong>{tasks.length}</strong><span>projets liés</span></span></div>
    <div className="planner-shared-tools"><PlannerTeamBoard record={record} member={member} initiallyOpen={false} disabled={!!busy} hasUnsavedChanges={dirty} onOpenTask={choice=>{if(!plan)return;if(choice.kind==='weekly'){const panel=section.current?.querySelector<HTMLDetailsElement>('.planner-weekly');if(panel){panel.open=true;panel.querySelector('summary')?.focus({preventScroll:true});panel.scrollIntoView({block:'start'});}return;}try{const location=plannerEntryLocation(plan,choice.rowIds[0]);setDay(location.day);setPage(location.page);setExcluded(location.excluded);setFilter('');setInspecting(choice.rowIds[0]);}catch(cause){showError(cause);}}}/><details className="planner-preparation-tools"><summary><Settings2 size={16} aria-hidden="true"/><span>Médias, formats & habitudes</span><ChevronDown size={16} aria-hidden="true"/></summary>{dayKeys.length>1?<nav className="planner-day-strip" aria-label="Journées de la préparation">{dayKeys.map(d=><button key={d} aria-pressed={day===d} aria-label={fullDate.format(asDate(d))} onClick={()=>{setDay(d);setPage(0);}}><span>{dayName.format(asDate(d))}</span><strong>{shortDate.format(asDate(d))}</strong></button>)}<button aria-pressed={!day} onClick={()=>{setDay('');setPage(0);}}><CalendarDays size={18} aria-hidden="true"/><strong>Tous les jours</strong></button></nav>:null}<div className="planner-assistant-bar" aria-label="Aides à la préparation"><button disabled={!missingMedia&&!reconnectMedia} onClick={()=>setBatchMedia(true)}><FolderSearch size={19} aria-hidden="true"/><span><strong>Retrouver les médias</strong><small>{reconnectMedia?`${reconnectMedia} à reconnecter sur ce poste`:'Pour les programmes de cette vue'}</small></span></button><button disabled={!selected.length} onClick={()=>setPlan(p=>p?{...p,rows:p.rows.map(r=>selected.some(s=>s.id===r.id)?{...r,formats:['tv','portrait','vertical']}:r)}:p)}><Smartphone size={19} aria-hidden="true"/><span><strong>Ajouter les formats sociaux</strong><small>TV, portrait et vertical</small></span></button></div>
    <PlannerRecipes key={draftId} plan={plan} rows={selected} member={member} onChange={setPlan} onAdapt={rowId=>setRecipeEdit({rowId})}/><PlannerHabits record={record} member={member} hasUnsavedChanges={dirty} plan={plan} onAdapt={observation=>{const row=plan.rows.find(item=>item.included&&!item.sourceRemoved&&normalized(item.title)===observation.programme);if(row)setRecipeEdit({rowId:row.id,observation});}}/><div className="planner-week-proposal"><button type="button" onClick={()=>setWeeklyProposalOpen(true)}><CalendarDays size={18} aria-hidden="true"/>Proposer une semaine pour le semainier</button><small>Choisissez les sept jours, puis relisez avant d’appliquer.</small></div></details></div>
    <div className="planner-action-bar"><div><h2>{day?fullDate.format(asDate(day)):'Toutes les journées'}</h2><span className="small muted">{choiceCount} habillages dans cette vue</span></div><button onClick={()=>setProgrammeReview(true)}><Tv size={17} aria-hidden="true"/>Fiches émission</button><details className="planner-selection-tools"><summary><Settings2 size={16} aria-hidden="true"/>Sélection<ChevronDown size={14} aria-hidden="true"/></summary><div><button onClick={()=>setPlan(p=>p?setPlannerIncluded(p,visible.map(row=>row.id),true):p)}>Retenir cette vue</button><button onClick={()=>setPlan(p=>p?setPlannerIncluded(p,visible.map(row=>row.id),false):p)}>Écarter cette vue</button></div></details><button className="primary" disabled={!choiceCount} aria-label="Préparer les habillages de cette vue" onClick={()=>propose(selected.flatMap(r=>r.kinds.flatMap(kind=>r.formats.map(format=>({rowIds:[r.id],kind,format})))))}><Layers3 size={17} aria-hidden="true"/>Préparer les habillages<ArrowRight size={17} aria-hidden="true"/></button></div>
    {choiceCount>MAX_PLANNER_TASKS?<p className="notice warning" role="status">{choiceCount} habillages sélectionnés. Une liste permet de préparer jusqu’à 2 000 projets par personne.</p>:null}
    {missingTime?<p className="notice warning" role="status">{missingTime} horaire{missingTime>1?'s':''} à compléter avant de créer les habillages.</p>:null}
    <div className="planner-rows">{pageRows.map(row=>{
      const linked=linkedTasksForRow(row.id,tasks),mediaState=plannerMediaState(row.media,connectedLocal),reconnect=mediaState==='reconnect';
      const needsProduction=row.kinds.length>0||weekly.includes(row.id),recurring=recurringProgramme(row.raw);
      return <article key={row.id} ref={node=>{if(node)rowElements.current.set(row.id,node);else rowElements.current.delete(row.id);}} className={`planner-row${row.included?'':' is-excluded'}`}>
       <div className="planner-item">
        <label className="planner-item-select"><input aria-label={`Retenir ${row.title}`} type="checkbox" checked={row.included} onChange={e=>changeRow(row.id,{included:e.target.checked})}/></label>
        <span className={`planner-item-time${row.time?'':' is-missing'}`} title={dateSchema.safeParse(row.airDate).success?fullDate.format(asDate(row.airDate)):'Date à préciser'}>{row.time.slice(0,5)||'— : —'}</span>
        <button className="planner-item-open" aria-label={`Préparer ${row.title}`} aria-haspopup="dialog" onClick={()=>setInspecting(row.id)}><span><strong>{row.title}</strong><small>{row.subtitle||row.category||'Programme'}{!row.included?' · Écarté':''}</small></span><ChevronRight size={16} aria-hidden="true"/></button>
        <span className="planner-item-deliverables" title={row.kinds.map(kind=>plannerLabels[kind]).join(', ')}>{row.kinds.map(kind=>shortKinds[kind]).join(' · ')||'À réutiliser'}<small>{row.formats.map(format=>format==='tv'?'16:9':format==='portrait'?'4:5':'9:16').join(' · ')}</small></span>
        <button className={`planner-item-media${reconnect?' needs-reconnect':''}`} aria-label={reconnect?'Reconnecter le média':row.media?'Changer / vérifier le média':'Choisir le média'} title={`${row.title} · ${plannerMediaLabels[mediaState]}`} onClick={()=>setMediaRow(row.id)}>{reconnect?<Link2 size={18} aria-hidden="true"/>:row.media?<CheckCheck size={18} aria-hidden="true"/>:<ImagePlus size={18} aria-hidden="true"/>}<span>{needsProduction?plannerMediaLabels[mediaState]:recurring?'À réutiliser':'Sans création'}</span></button>
        <span className="planner-item-linked" title="Projets liés">{linked.length?<><Layers3 size={14} aria-hidden="true"/>{linked.length}</>:<span aria-label="Aucun projet lié">—</span>}</span>
       </div>
       {inspecting===row.id?<NewProjectDialog busy={!!busy} labelledBy="planner-inspector-title" onClose={closeInspector}><div className="planner-inspector-heading"><div className="planner-programme-category"><ProgrammeIcon row={row}/><span>{row.category||'Programme'} · {row.time.slice(0,5)||'Heure à préciser'}</span></div><h2 id="planner-inspector-title">{row.title}</h2><p className="small muted">Les réglages restent dans cette préparation jusqu’à son enregistrement.</p></div><fieldset disabled={!!busy}>
       <div className="planner-row-body">
        <button className="planner-inspector-media" onClick={()=>setMediaRow(row.id)}><ImagePlus size={18} aria-hidden="true"/>{reconnect?'Reconnecter le média':row.media?'Changer / vérifier le média':'Choisir le média'}</button>
        <button className="planner-inspector-logo" onClick={()=>setLogoRow(row.id)} aria-label={`Logo de l’émission : ${row.title}`}><ImagePlus size={17} aria-hidden="true"/><span><strong>Logo de l’émission · facultatif</strong><small>{row.logo?row.logo.name:'À choisir ou proposer depuis la fiche'}</small></span><ChevronRight size={16} aria-hidden="true"/></button>
        <p className="planner-media-caption">{!needsProduction?'Aucun nouvel habillage demandé. Vous pouvez choisir les types à créer dans les réglages ci-dessous.':row.media?`${reconnect?'Référence enregistrée · accès à reconnecter sur ce poste':'Média lié'} : ${row.media.name}`:'Média manquant · à compléter avant export.'}</p>
        {row.media?.mimeType.startsWith('video/')?<div className="planner-excerpt-summary"><Scissors size={17} aria-hidden="true"/><span>{row.excerpt?`${timeLabel(row.excerpt.start)} → ${timeLabel(row.excerpt.end)} · ${timeLabel(row.excerpt.end-row.excerpt.start)}`:'Depuis le début du fichier'}</span><button onClick={()=>connectedLocal(row.media!.url)?setExcerptRow(row.id):setMediaRow(row.id)}>{connectedLocal(row.media.url)?row.excerpt?'Ajuster l’extrait':'Choisir l’extrait':'Reconnecter pour choisir l’extrait'}</button></div>:null}
        {row.kinds.length?<div className="planner-row-voices" role="group" aria-label={`Voix et calage pour ${row.title}`}><p><Mic2 size={16} aria-hidden="true"/>Voix & calage · par habillage</p><div className="planner-voice-choices">{row.kinds.map(kind=>{const voice=row.voices?.[kind],description=plannerVoiceDescription(kind,voice,row.airDate);return <button type="button" key={kind} className={`planner-voice-choice${description.error?' needs-review':voice?' is-confirmed':''}`} aria-label={`${plannerLabels[kind]} : ${description.label}. ${description.detail}`} title={description.error||voice?.source.name} onClick={()=>setVoiceTarget({rowId:row.id,kind})}><span><strong>{shortKinds[kind]} · {description.label}</strong><small>{description.detail}</small></span>{description.error?<TriangleAlert size={17} aria-hidden="true"/>:voice?<Check size={17} aria-hidden="true"/>:<Mic2 size={17} aria-hidden="true"/>}</button>;})}</div></div>:null}
        {row.issues.length?<p className="planner-import-warning"><TriangleAlert size={15} aria-hidden="true"/><span>À vérifier : {row.issues.join(' ')}</span></p>:null}
        <details className="planner-row-settings" open><summary><Settings2 size={16} aria-hidden="true"/><span>Textes, horaire et habillages à préparer</span><ChevronDown size={15} aria-hidden="true"/></summary><div className="planner-fields"><label>Titre<input name="title" maxLength={200} value={row.title} onChange={e=>changeRow(row.id,{title:e.target.value})}/></label><label>Épisode / sous-titre<input name="subtitle" maxLength={400} value={row.subtitle} onChange={e=>changeRow(row.id,{subtitle:e.target.value})}/></label><label>Type de programme<input name="category" maxLength={80} value={row.category} onChange={e=>changeRow(row.id,{category:e.target.value})}/></label><label>Date réelle de diffusion<input name="airDate" type="date" value={row.airDate} onChange={e=>changeRow(row.id,{airDate:e.target.value})}/></label><label>Heure de diffusion<input name="time" type="time" step="1" value={row.time} onChange={e=>changeRow(row.id,{time:e.target.value})}/></label></div>
         <fieldset className="planner-checks planner-kind-checks"><legend>Habillages proposés · modèles BTV</legend>{plannerKinds.map(k=><label className="check" key={k}><span className="planner-kind-preview" aria-hidden="true">{k==='popup'?<img src="/thumbnails/btv-popup.png" alt="" width="160" height="90" loading="lazy"/>:k==='tds'?<img src="/library/v1.7.0/BTV_BA_TDS/lib/frames/frame_0070.png" alt="" width="160" height="90" loading="lazy"/>:k==='event'?<CalendarDays size={27} strokeWidth={1.3}/>:k==='renvoi'?<ArrowRight size={27} strokeWidth={1.3}/>:<Clapperboard size={27} strokeWidth={1.3}/>}</span><span><input type="checkbox" checked={row.kinds.includes(k)} onChange={e=>changeRow(row.id,{kinds:e.target.checked?[...row.kinds,k]:row.kinds.filter(v=>v!==k)})}/>{plannerLabels[k]}</span></label>)}</fieldset>
         <fieldset className="planner-checks planner-format-checks"><legend>Formats</legend>{plannerFormats.map(f=><label className="check" key={f}><input name="formats" type="checkbox" checked={row.formats.includes(f)} disabled={row.formats.length===1&&row.formats.includes(f)} onChange={e=>changeRow(row.id,{formats:e.target.checked?[...row.formats,f]:row.formats.filter(v=>v!==f)})}/>{f==='tv'?<Monitor size={16} aria-hidden="true"/>:<Smartphone size={16} aria-hidden="true"/>}{formatLabels[f]}</label>)}</fieldset>
         <p className="small muted">Source {row.sheet} · {row.cell} : {row.raw}{row.duration!==null?` · durée programme ${Math.round(row.duration/60)} min (distincte de l’habillage)`:''}</p>
         {row.media?<button className="quiet" onClick={()=>changeRow(row.id,{media:null,location:null})}>Délier le média (sans supprimer le fichier)</button>:null}
        </details>
        <label className="check planner-weekly-check"><input type="checkbox" checked={weekly.includes(row.id)} disabled={!row.included||(!weekly.includes(row.id)&&weekly.length>=7)} onChange={e=>changeWeekly({rowIds:e.target.checked?[...weekly,row.id]:weekly.filter(id=>id!==row.id)})}/><CalendarDays size={15} aria-hidden="true"/>Inclure dans le semainier{weekly.includes(row.id)?<span className="planner-weekly-number">{weekly.indexOf(row.id)+1}</span>:null}</label>
       </div>
       <ProductionDossier row={row} tasks={tasks} sourceRevision={record?.revision} hasUnsavedChanges={dirty} disabled={!!busy} onPrepare={()=>propose(row.kinds.flatMap(kind=>row.formats.map(format=>({rowIds:[row.id],kind,format}))))} onOpenProject={(id,target)=>safely(()=>void openLinkedProject(id,target))} onOpenProgramme={DERIVATIONS_ENABLED&&record&&record.data.rows.some(item=>item.id===row.id)?()=>setProductionDossier({planId:record.id,revision:record.revision,rowId:row.id}):undefined}/>
       <div className="planner-inspector-footer"><button onClick={closeInspector}>Revenir à la liste</button></div></fieldset></NewProjectDialog>:null}
      </article>;
    })}</div>
    {!visible.length?<div className="planner-empty"><Search size={26} strokeWidth={1.5} aria-hidden="true"/><p>Aucun programme dans cette vue.</p></div>:null}<nav className="planner-pagination" aria-label="Pages de programmes"><button disabled={page===0} onClick={()=>setPage(p=>p-1)}><ChevronLeft size={17} aria-hidden="true"/>Précédent</button><span>{Math.min(page*20+1,visible.length)}–{Math.min((page+1)*20,visible.length)} / {visible.length}</span><button disabled={(page+1)*20>=visible.length} onClick={()=>setPage(p=>p+1)}>Suivant<ChevronRight size={17} aria-hidden="true"/></button></nav>
    <PlannerWeekly plan={plan} tasks={tasks} sourceRevision={record?.revision} hasUnsavedChanges={dirty} onChange={changeWeekly} onPropose={()=>setWeeklyProposalOpen(true)} onMedia={setMediaRow} onExcerpt={setExcerptRow} onVoice={()=>setVoiceTarget({kind:'weekly'})} onCreate={()=>{try{propose(weeklyChoices(plan));}catch(cause){setError(cause instanceof Error?cause.message:String(cause));}}} onOpen={id=>safely(()=>void openLinkedProject(id))}/>
    <details className="planner-help"><summary><ShieldCheck size={16} aria-hidden="true"/>Les règles de préparation<ChevronDown size={15} aria-hidden="true"/></summary><p>BA et pop-up sont proposés pour les programmes. Les JT, bulletins et météos reconnus restent visibles, sans nouvel habillage demandé : vérifiez l’existant ou choisissez les types à créer. Publicité et annonces techniques sont écartées par défaut. Tout reste modifiable. Choisissez, écoutez et calez les voix par habillage avant de créer les nouveaux brouillons. Sans choix confirmé, aucune voix n’est ajoutée.</p><p>Les projets sont créés en brouillon. Aucun ordre n’est envoyé à la diffusion.</p></details>
   </fieldset>
  </>:null}
  {!plan&&!sheets.length?<div className="planner-welcome"><div><CalendarDays size={24} strokeWidth={1.4} aria-hidden="true"/><span><strong>Les bons jours</strong><small>Vérifiez les dates de la grille.</small></span></div><div><FolderSearch size={24} strokeWidth={1.4} aria-hidden="true"/><span><strong>Les bons médias</strong><small>Choisissez les fichiers sur votre poste.</small></span></div><div><Monitor size={24} strokeWidth={1.4} aria-hidden="true"/><span><strong>Prêts à ajuster</strong><small>Ouvrez vos brouillons TV et sociaux.</small></span></div></div>:null}
  {conductorDiff&&<ConductorReview diff={conductorDiff} onClose={()=>{setConductorDiff(null);setSheets([]);setComparing(false);}} onApply={()=>{setPlan(conductorDiff.plan);setConductorDiff(null);setSheets([]);setComparing(false);setNotice('Conducteur comparé. Enregistrez la liste ; les projets existants restent inchangés.');}}/>}
  {programmeReview&&plan?<PlannerProgrammeReview key={`${draftId}:${plan.sourceHash}`} plan={plan} onClose={()=>setProgrammeReview(false)} onApply={(next,changed)=>{setPlan(next);setProgrammeReview(false);setNotice(changed?`${changed} entrée${changed>1?'s':''} rapprochée${changed>1?'s':''} des fiches émission. Enregistrez la préparation pour conserver ces choix. Les projets existants restent inchangés.`:'Aucune modification appliquée. Les entrées sont déjà à jour ou ont changé depuis l’ouverture.');}}/>:null}
  {confirmTasks?<NewProjectDialog labelledBy="planner-create-title" busy={false} onClose={()=>setConfirmTasks(null)}>
   <h2 id="planner-create-title">Préparer {confirmTasks.length} habillage{confirmTasks.length>1?'s':''} ?</h2>
   <p>{newChoices.length} {newChoices.length===1?'nouveau brouillon':'nouveaux brouillons'} ; {confirmTasks.length-newChoices.length} {confirmTasks.length-newChoices.length===1?'projet existant conservé':'projets existants conservés'}.</p>
   <PlannerVoiceProblems problems={voiceProblems} plan={plan!} onFix={target=>{setConfirmTasks(null);setVoiceTarget(target);}}/>
   <p>La liste sera enregistrée pour l’équipe, sans envoyer les fichiers. Seuls les nouveaux brouillons reprennent les textes, horaires, médias et voix de cette liste.</p>
   {confirmTasks.length>newChoices.length||staleEditions.length?<div className="planner-existing-review" role="status"><div><ShieldCheck size={21} aria-hidden="true"/><p><strong>Vos projets existants restent intacts.</strong><span>Leurs textes, horaires, médias, voix et retouches ne changent pas.</span></p></div>{staleEditions.length?<p>La préparation interrompue vise une ancienne révision. Pour les brouillons restants, choisissez explicitement la liste actuelle r{currentPreparationRevision}.</p>:null}{refreshedChoices.changed>0?<><p>Vous pouvez repartir des réglages de la liste actuelle. Les versions déjà créées seront retrouvées ; les autres seront de nouveaux brouillons. Les retouches faites dans les anciens projets ne seront pas recopiées.</p><button type="button" onClick={()=>propose(refreshedChoices.choices)}><RefreshCw size={17} aria-hidden="true"/>{staleEditions.length?`Repartir de la liste r${currentPreparationRevision}`:'Préparer des versions actualisées'}</button></>:null}</div>:null}
   {newChoices.some(choice=>choice.edition!==undefined)?<p className="planner-edition-notice" role="status"><Layers3 size={18} aria-hidden="true"/>Versions demandées : {[...new Set(newChoices.filter(choice=>choice.edition!==undefined).map(choice=>`r${choice.edition}`))].join(', ')}. Les anciens projets restent disponibles.</p>:null}
   {newChoices.length?<div className="planner-confirm-voices"><Mic2 size={18} aria-hidden="true"/><p><strong>{voicedChoices} avec voix confirmée</strong> · {newChoices.length-voicedChoices} sans voix off.<br/><span className="small muted">Les passages et calages choisis seront repris dans chaque nouveau format. Les projets existants gardent leur propre son.</span></p></div>:null}
   {signatureCount>0?<div className="planner-sound-choice">
    <label className="check"><input type="checkbox" checked={includeSignature} onChange={e=>setIncludeSignature(e.target.checked)}/><span>Ajouter la signature sonore du modèle</span></label>
    <p>{signatureCount===1?'1 nouvel habillage compatible':`${signatureCount} nouveaux habillages compatibles`}. Chaque modèle garde son propre jingle, indépendant des voix confirmées. Aucun ancien projet ne sera modifié.</p>
   </div>:null}
   <p className="small muted">Création progressive. Vous pouvez arrêter puis reprendre sans recréer les projets existants.</p>
   <ul className="planner-confirm-list">{confirmTasks.slice(0,confirmLimit).map(c=>{const voice=selectedPlannerVoice(plan!,c),existing=generated.get(taskKey(c));return <li key={taskKey(c)}>{existing?existing.title:<>{c.kind==='weekly'?'Semainier':plannerLabels[c.kind]} · {plan!.rows.find(r=>r.id===c.rowIds[0])?.title} · {formatLabels[c.format]}</>}<span className="planner-confirm-voice">{existing?`Projet conservé · ${plannerTaskReview(existing,record?.revision,dirty)}`:voice?`Voix : « ${voice.cue} » · ${voice.source.name}`:'Sans voix off'}</span></li>;})}</ul>
   {confirmLimit<confirmTasks.length?<button className="quiet" onClick={()=>setConfirmLimit(n=>n+20)}>Voir les 20 suivants · {confirmLimit} / {confirmTasks.length}</button>:null}
   <div className="row"><button className="primary" disabled={staleEditions.length>0} onClick={()=>void create()}>{newChoices.length?'Créer les brouillons':'Conserver ces projets'}</button><button onClick={()=>setConfirmTasks(null)}>Revenir aux choix</button></div>
  </NewProjectDialog>:null}
  {weeklyProposalOpen&&plan?<PlannerWeeklyProposalDialog key={draftId} plan={plan} onApply={selection=>{
    changeWeekly(selection);setNotice(`${selection.rowIds.length}/7 ${selection.rowIds.length===1?'programme retenu':'programmes retenus'}. Vous pouvez ajuster la sélection dans « Le semainier » avant de créer les brouillons.`);
    requestAnimationFrame(()=>{const panel=section.current?.querySelector<HTMLDetailsElement>('.planner-weekly');if(panel){panel.open=true;panel.querySelector('summary')?.focus({preventScroll:true});panel.scrollIntoView({block:'start'});}});
  }} onClose={()=>setWeeklyProposalOpen(false)}/>:null}
  {voiceTarget&&plan&&(voiceTarget.kind==='weekly'||voiceRow)?<Suspense fallback={<NewProjectDialog labelledBy="planner-voice-loading-title" busy={false} onClose={()=>setVoiceTarget(null)}><h2 id="planner-voice-loading-title">Voix & calage</h2><Activity label="Ouverture du choix de voix…"/></NewProjectDialog>}><PlannerVoiceDialog key={`${draftId}:${voiceTarget.rowId??'weekly'}:${voiceTarget.kind}`} kind={voiceTarget.kind} airDate={voiceRow?.airDate} programmeId={voiceRow?.programmeId} programmeRevision={voiceRow?.programmeRevision} title={voiceTarget.kind==='weekly'?`Le semainier · ${plan.name}`:voiceRow!.title} value={voiceTarget.kind==='weekly'?plan.weekly?.voice:voiceRow?.voices?.[voiceTarget.kind]} onChange={value=>changeVoice(voiceTarget,value)} onClose={()=>setVoiceTarget(null)}/></Suspense>:null}
  {mediaRow&&plan?.rows.some(r=>r.id===mediaRow)?<PlannerMediaDialog key={mediaRow} row={plan.rows.find(r=>r.id===mediaRow)!} member={member} onClose={()=>setMediaRow(null)} onSelect={(media,location,warning)=>{changeRow(mediaRow,{media,location});setMediaRow(null);if(warning)setNotice(warning);if(media.mimeType.startsWith('video/'))setExcerptRow(mediaRow);}}/>:null}
  {excerptRow&&plan?.rows.some(r=>r.id===excerptRow&&r.media)?<PlannerExcerptDialog key={`${excerptRow}:${plan.rows.find(r=>r.id===excerptRow)!.media!.url}`} row={plan.rows.find(r=>r.id===excerptRow)!} onClose={()=>setExcerptRow(null)} onSelect={excerpt=>{changeRow(excerptRow,{excerpt});setExcerptRow(null);}}/>:null}
  {logoRow&&plan?.rows.some(row=>row.id===logoRow)?<PlannerLogoDialog key={logoRow} row={plan.rows.find(row=>row.id===logoRow)!} reuse={{plan,context:logoContext,onApply:applyLogo}} onClose={()=>setLogoRow(null)} onChange={logo=>{changeRow(logoRow,{logo});setLogoRow(null);}}/>:null}
  {batchMedia?<PlannerBatchMedia rows={productionSelected} member={member} onApply={(id,media,location)=>changeRow(id,{media,location})} onClose={()=>setBatchMedia(false)}/>:null}
  {recipeEdit&&plan?<PlannerRecipeEditor key={`${draftId}:${plan.sourceHash}:${recipeEdit.rowId}`} plan={plan} rows={plan.rows} initialRowId={recipeEdit.rowId} member={member} observation={recipeEdit.observation} onChange={setPlan} onApplied={change=>{setRecipeUndo(change);setNotice(change?'Types adaptés dans cette préparation uniquement. Vous pouvez annuler la dernière adaptation.':'Adaptation annulée ; les autres retouches restent conservées.');}} onClose={()=>setRecipeEdit(null)}/>:null}
  {ProgrammeProductionDossier&&productionDossier&&record&&record.id===productionDossier.planId&&record.revision===productionDossier.revision&&plan?<Suspense fallback={<NewProjectDialog labelledBy="production-dossier-loading" busy={false} onClose={()=>setProductionDossier(null)}><h2 id="production-dossier-loading">Dossier de l’émission</h2><Activity label="Ouverture du dossier…"/></NewProjectDialog>}><ProgrammeProductionDossier key={`${record.id}:${record.revision}:${productionDossier.rowId}`} {...productionDossier} member={member} hasUnsavedChanges={dirty} onClose={()=>setProductionDossier(null)} onOpenRow={rowId=>{try{const location=plannerEntryLocation(plan,rowId);setProductionDossier(null);setDay(location.day);setPage(location.page);setExcluded(location.excluded);setFilter('');setInspecting(rowId);}catch(cause){setProductionDossier(null);showError(cause);}}} onOpenProject={id=>{setProductionDossier(null);safely(()=>void openLinkedProject(id));}}/></Suspense>:null}
  {leave?<NewProjectDialog labelledBy="planner-leave-title" busy={!!busy} onClose={()=>setLeave(null)}><h2 id="planner-leave-title">Conserver votre préparation ?</h2><p>Continuer sans enregistrer conserve les retouches de votre préparation sur ce poste, pour votre compte et cette chaîne, sans les partager. Un import dont les feuilles ne sont pas encore confirmées n’est pas conservé. Les projets existants restent intacts.</p>{error?<p className="notice error" role="alert">{error}</p>:null}<div className="row">{plan&&dirty?<button className="primary" onClick={()=>void saveThenContinue()}>Enregistrer puis continuer</button>:null}<button disabled={!!busy} onClick={()=>void keepLocalThenContinue()}>Continuer sans enregistrer</button><button onClick={()=>setLeave(null)}>Rester ici</button></div></NewProjectDialog>:null}
 </section>;
}
