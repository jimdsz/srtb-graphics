import type {plannerAPI} from './day-planner-api';
import {plannerRuleQuery,programmeRules,resolveProgrammeRule} from './planner-rules';
import type {DirectoryIndex,PlannerRecord,PlannerRow,ProgrammeRule} from './day-planner-model';
import {searchRead,teamDirectoryCatalog} from './planner-team-search';
import type {MediaAsset} from './domain';
import type {Programme} from './channel-model';
import {readProgrammeResources} from './planner-programme-resources';

type MediaAPI=Pick<typeof plannerAPI,'list'|'rules'|'get'|'save'>;
export const plannerAccessFailure=(error:unknown)=>[401,403].includes(Number((error as {status?:number})?.status));

/** Catalogue metadata only. A stalled read must neither lock local file choice
 * nor allow a late reply to replace the result of a newer user request. */
export async function loadPlannerSharedMedia(api:{media:(signal?:AbortSignal)=>Promise<MediaAsset[]>},signal:AbortSignal,timeoutMs=20000){
 const media=await searchRead(s=>api.media(s),signal,timeoutMs,'La médiathèque ne répond pas. Choisissez un fichier local ou réessayez.');
 signal.throwIfAborted();
 return media.filter(m=>/^(image|video)\//.test(m.mime_type)&&m.status==='ready');
}

/** Metadata only. The full catalogue is needed on another team member's post,
 * not just the first API page. Never request a filesystem permission here. */
export async function loadPlannerMediaCatalog(row:PlannerRow,api:MediaAPI,signal:AbortSignal,getProgramme?:(id:string,signal:AbortSignal)=>Promise<Programme>){
 const query=plannerRuleQuery([row]);
 const [directories,{rules},resources]=await Promise.all([
  teamDirectoryCatalog((offset,s)=>api.list('directory',offset,undefined,s),signal,()=>{}),
  searchRead(s=>api.rules(query.programmes,s,query.families),signal),
  getProgramme?readProgrammeResources(row,getProgramme,signal):Promise.resolve({programme:null,warning:''}),
 ]);
 signal.throwIfAborted();
 const resolved=resolveProgrammeRule(row,programmeRules(rules)),rule=resolved.exact||null;
 const preferred=new Set(resources.programme?.data.directoryIds??[]);
 const preferredDirectories=directories.filter(d=>preferred.has(d.id));
 const proposed=!resolved.conflict&&preferredDirectories.length===1?preferredDirectories[0].id:undefined;
 const id=row.location?.directoryId||resolved.data?.directoryId||proposed;
 let directory=null,warning=resolved.conflict?'Plusieurs associations existent pour ce programme. Choisissez le dossier à utiliser.':resolved.inherited?'Dossier proposé depuis la recette de cette émission. Choisissez le fichier correspondant à cet épisode.':'';
 if(id)try{
  const found=await searchRead(s=>api.get<DirectoryIndex>(id,s),signal);
  signal.throwIfAborted();
  if(found.id!==id||found.archived||found.data.kind!=='directory')throw Error('Index retiré.');
  directory=found;
 }catch(error){
  signal.throwIfAborted();if(plannerAccessFailure(error))throw error;
  warning='Le dossier mémorisé n’est pas disponible. Choisissez un autre dossier ou un fichier sur ce poste.';
 }
 if(proposed&&!row.location&&!resolved.data?.directoryId&&directory?.id===proposed)warning='Dossier proposé par la fiche émission. Vérifiez l’épisode ; l’accès reste à autoriser sur ce poste.';
 if(preferredDirectories.length>1)warning=[warning,'Plusieurs dossiers habituels sont disponibles : choisissez celui de cet épisode.'].filter(Boolean).join(' ');
 if(resources.warning)warning=[warning,resources.warning].filter(Boolean).join(' ');
 return {directories:[...preferredDirectories,...directories.filter(d=>!preferred.has(d.id))],rule,recommendation:resolved.data,directory,warning,preferredDirectoryIds:[...preferred]};
}

/** Remembering a preference is optional; it must not discard a verified local
 * file on conflict/offline failure. A failed response is NOT proof of no commit:
 * never retry this write automatically. Auth failures and cancellation propagate. */
const memoryWarning='Média lié à cette préparation. La mémorisation pour l’équipe n’est pas confirmée ; actualisez les associations avant de réessayer.';
type MemoryResult={saved:PlannerRecord<ProgrammeRule>|null;warning:string};

/** A bounded single write, including transports that settle after cancellation.
 * Aborting a request is never evidence that the server did not commit it. */
async function saveMediaDocument<T extends DirectoryIndex|ProgrammeRule>(api:Pick<MediaAPI,'save'>,id:string,revision:number,data:T,signal:AbortSignal,timeoutMs:number,timeoutMessage:string):Promise<PlannerRecord<T>>{
 signal.throwIfAborted();
 const saved=await new Promise<PlannerRecord<T>>((resolve,reject)=>{
  const controller=new AbortController();let settled=false;
  const finish=(error:unknown,value?:PlannerRecord<T>)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);error?reject(error):resolve(value!);};
  const abort=()=>{const reason=signal.reason||new DOMException('Action arrêtée.','AbortError');controller.abort(reason);finish(reason);};
  const timer=setTimeout(()=>{const reason=Error(timeoutMessage);controller.abort(reason);finish(reason);},timeoutMs);
  signal.addEventListener('abort',abort,{once:true});
  Promise.resolve().then(()=>{controller.signal.throwIfAborted();return api.save(id,revision,data,controller.signal);}).then(value=>finish(null,value),error=>finish(error));
 });
 signal.throwIfAborted();return saved;
}

/** Metadata-only index sharing. Keep the pending UUID/revision on failure so a
 * user retry cannot silently create a second index or overwrite a colleague.
 * A cancelled/late reply must never connect a filesystem handle or start search. */
export function savePlannerDirectory(api:Pick<MediaAPI,'save'>,id:string,revision:number,data:DirectoryIndex,signal:AbortSignal,timeoutMs=20000){
 return saveMediaDocument(api,id,revision,data,signal,timeoutMs,'Le partage de l’index n’est pas confirmé. Les fichiers restent sur ce poste. Actualisez les dossiers d’équipe avant de réessayer.');
}

async function saveMediaPreference(api:Pick<MediaAPI,'save'>,id:string,revision:number,data:ProgrammeRule,signal:AbortSignal,timeoutMs:number):Promise<MemoryResult>{
 try{
  const saved=await saveMediaDocument(api,id,revision,data,signal,timeoutMs,'Mémorisation non confirmée.');
  return {saved,warning:''};
 }catch(error){
  signal.throwIfAborted();if(plannerAccessFailure(error))throw error;
  return {saved:null,warning:memoryWarning};
 }
}

export async function rememberPlannerMedia(api:MediaAPI,id:string,revision:number,data:ProgrammeRule,signal:AbortSignal){
 return (await saveMediaPreference(api,id,revision,data,signal,10000)).warning;
}

/** One unavailable service must not delay every media in a day/week batch.
 * Keep this guard across user retries; reset only after re-reading team rules. */
export function createPlannerBatchMemory(api:Pick<MediaAPI,'save'>,timeoutMs=10000){
 let needsRefresh=false;
 return {
  get needsRefresh(){return needsRefresh;},
  refreshed(){needsRefresh=false;},
  async remember(id:string,revision:number,data:ProgrammeRule,signal:AbortSignal):Promise<MemoryResult>{
   signal.throwIfAborted();
   if(needsRefresh)return {saved:null,warning:memoryWarning};
   needsRefresh=true;
   const result=await saveMediaPreference(api,id,revision,data,signal,timeoutMs);
   if(result.saved)needsRefresh=false;
   return result;
  },
 };
}
