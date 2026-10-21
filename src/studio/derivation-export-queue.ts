import type {BroadcastTemplate,Project,ProjectData} from './domain';
import {presentation} from './presentation';
import {bindVideoSession,videoSnapshot} from './video-snapshot';
import type {VideoSnapshot} from './video-snapshot';
import type {VideoOptions,VideoProgress,VideoReport} from './video/export';
import {withRenderSlot} from './render-slot';

export interface DerivationExportEntry {
  key:string;project:Project;options:VideoOptions;
  /** The caller chooses r1 explicitly, or supplies the current project revision. */
  revisionSource?:'initial'|'current';
}
export interface DerivationExportResult {blob:Blob;report:VideoReport;filename:string;dispose:()=>Promise<void>}
export type DerivationExportStatus='pending'|'preflight'|'ready'|'rendering'|'completed'|'failed'|'cancelled';
export interface DerivationExportItem {
  key:string;project:Readonly<Project>;options:Readonly<VideoOptions>;revisionSource:'initial'|'current';
  status:DerivationExportStatus;progress:VideoProgress;error?:string;result?:DerivationExportResult;
}
export interface DerivationExportState {
  running:boolean;phase:'idle'|'preflight'|'rendering'|'disposing';currentKey:string|null;
  selectedKeys:readonly string[];items:readonly DerivationExportItem[];
}
type RenderResult={blob:Blob;report:VideoReport;dispose:()=>Promise<void>};
export interface DerivationExportDependencies {
  snapshot:(project:Project,signal:AbortSignal)=>Promise<VideoSnapshot>;
  render:(template:BroadcastTemplate,data:ProjectData,options:VideoOptions,signal:AbortSignal,progress:(value:VideoProgress)=>void)=>Promise<RenderResult>;
  bindSession:(controller:AbortController)=>()=>void;
  events:(name:'srtb-render-start'|'srtb-render-end')=>void;
}
const defaults:DerivationExportDependencies={
  snapshot:(project,signal)=>videoSnapshot(project,signal,{rejectArchived:true}),bindSession:bindVideoSession,
  render:async(...args)=>withRenderSlot(args[3],async()=>(await import('./video/export')).exportBroadcastVideo(...args)),
  events:()=>{},
};
function freeze<T>(value:T):T{
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const child of Object.values(value))freeze(child);}
  return value;
}
function once(dispose:()=>Promise<void>){let pending:Promise<void>|undefined;return()=>pending??=Promise.resolve().then(dispose);}
const message=(cause:unknown)=>cause instanceof Error?cause.message:String(cause);
const extension:Record<VideoOptions['format'],string>={mp4:'.mp4',mov:'.mov',png:'_PNG.zip',alpha:'.webm'};

/** One local, immutable job per selected project. No saving, upload, approval,
 * download click, automatic retry or alternate encoder lives in this module. */
export function createDerivationExportQueue({onChange,deps:overrides={}}:{onChange?:(state:DerivationExportState)=>void;deps?:Partial<DerivationExportDependencies>}={}){
  const deps={...defaults,...overrides};
  let items:DerivationExportItem[]=[],phase:DerivationExportState['phase']='idle',currentKey:string|null=null,selectedKeys:string[]=[];
  let controller:AbortController|undefined,active:Promise<DerivationExportState>|undefined,disposed=false,disposing:Promise<void>|undefined;
  function snapshot():DerivationExportState{
    // Project/options/report are already deeply frozen. Only cheap state wrappers
    // are copied on frame progress; never clone eight large projects per frame.
    return Object.freeze({running:!!controller,phase,currentKey,selectedKeys:Object.freeze([...selectedKeys]),items:Object.freeze(items.map(item=>Object.freeze({...item,progress:Object.freeze({...item.progress})})))});
  }
  function emit(){try{onChange?.(snapshot());}catch{/* View observers cannot strand a renderer or its cleanup. */}}
  function configure(entries:readonly DerivationExportEntry[]){
    if(disposed)throw Error('Cette file d’exports est fermée.');
    if(controller)throw Error('Attendez la fin ou l’annulation de la file avant de la modifier.');
    if(items.some(item=>item.result))throw Error('Les exports terminés sont conservés. Fermez cette file avant d’en préparer une autre.');
    if(entries.length>8)throw Error('Une file est limitée à huit exports.');
    const keys=new Set<string>();
    const next=entries.map(entry=>{
      if(typeof entry.key!=='string'||!entry.key.trim()||entry.key.length>200||keys.has(entry.key))throw Error('Chaque export doit avoir une clé unique non vide.');keys.add(entry.key);
      const revisionSource=entry.revisionSource??'current';
      if(!['initial','current'].includes(revisionSource)||!Number.isSafeInteger(entry.project.revision)||entry.project.revision<1||revisionSource==='initial'&&entry.project.revision!==1)throw Error('Choisissez explicitement la révision initiale r1 ou une révision courante valide.');
      const options=entry.options;
      if(!Object.hasOwn(extension,options.format)||!Number.isFinite(options.manualOut)||options.manualOut<0||options.manualOut>600||typeof options.audio!=='boolean'||typeof options.removeBackground!=='boolean'||!/^#[\da-f]{6}$/i.test(options.background))throw Error('Options d’export invalides.');
      return {key:entry.key,project:freeze(structuredClone(entry.project)),options:freeze(structuredClone(options)),revisionSource,status:'pending' as const,progress:{percent:0,message:'En attente.'}};
    });
    items=next;selectedKeys=[];currentKey=null;emit();
  }
  function cancel(){if(controller&&!controller.signal.aborted){controller.abort(new DOMException('File d’exports annulée.','AbortError'));emit();}}
  async function execute(chosen:DerivationExportItem[],task:AbortController){
    let stopSession:()=>void=()=>{},started=false;
    const snapshots=new Map<string,VideoSnapshot>();
    try{
      stopSession=deps.bindSession(task);task.signal.throwIfAborted();
      started=true;deps.events('srtb-render-start');
      let failed=false;
      for(const item of chosen){
        task.signal.throwIfAborted();currentKey=item.key;item.status='preflight';item.progress={percent:0,message:'Vérification des médias et de la session…'};delete item.error;emit();
        try{
          task.signal.throwIfAborted();
          const prepared=await deps.snapshot(structuredClone(item.project),task.signal);task.signal.throwIfAborted();
          snapshots.set(item.key,freeze(structuredClone(prepared)));item.status='ready';item.progress={percent:0,message:'Vérifié — attente des autres sorties.'};
        }catch(cause){task.signal.throwIfAborted();failed=true;item.status='failed';item.error=message(cause);item.progress={percent:0,message:'Vérification impossible.'};}
        emit();
      }
      task.signal.throwIfAborted();
      if(failed){for(const item of chosen)if(item.status==='ready'){item.status='pending';item.progress={percent:0,message:'Aucun rendu lancé : corrigez les sorties non vérifiées.'};}return;}
      phase='rendering';
      for(const item of chosen){
        task.signal.throwIfAborted();currentKey=item.key;item.status='rendering';item.progress={percent:0,message:'Démarrage du rendu local…'};emit();
        const prepared=snapshots.get(item.key)!;let result:RenderResult|undefined;
        try{
          task.signal.throwIfAborted();
          result=await deps.render(structuredClone(prepared.template),structuredClone(prepared.data),structuredClone(item.options),task.signal,progress=>{
            if(controller!==task||task.signal.aborted||item.status!=='rendering')return;
            if(!Number.isFinite(progress.percent))return;
            item.progress={percent:Math.max(0,Math.min(100,progress.percent)),message:progress.message};emit();
          });
          task.signal.throwIfAborted();
          item.result=Object.freeze({blob:result.blob,report:freeze(structuredClone(result.report)),filename:prepared.filename+'_'+presentation(prepared.data)+extension[item.options.format],dispose:once(result.dispose)});
          result=undefined;item.status='completed';item.progress={percent:100,message:'Fichier calculé et contrôlé.'};delete item.error;
        }catch(cause){task.signal.throwIfAborted();item.status='failed';item.error=message(cause);item.progress={...item.progress,message:'Export interrompu : réessayez cet élément.'};}
        finally{try{await result?.dispose();}catch{/* A failed transient result must not hide cancellation or other results. */}}
        emit();
      }
    }catch(cause){
      for(const item of chosen)if(item.status!=='completed'&&item.status!=='failed'){
        item.status=task.signal.aborted?'cancelled':'failed';item.error=message(task.signal.aborted?task.signal.reason:cause);item.progress={...item.progress,message:task.signal.aborted?'Export annulé.':'File interrompue.'};
      }
    }finally{
      snapshots.clear();
      try{stopSession();}finally{
        try{if(started)deps.events('srtb-render-end');}finally{controller=undefined;currentKey=null;phase=disposed?'disposing':'idle';emit();}
      }
    }
  }
  function run(keys?:readonly string[]):Promise<DerivationExportState>{
    if(disposed)return Promise.reject(Error('Cette file d’exports est fermée.'));
    if(active)return active;
    const selected=keys===undefined?items.map(item=>item.key):[...keys],known=new Set(items.map(item=>item.key));
    if(new Set(selected).size!==selected.length||selected.some(key=>!known.has(key)))return Promise.reject(Error('Sélection d’exports invalide.'));
    const selectedSet=new Set(selected),chosen=items.filter(item=>selectedSet.has(item.key)&&item.status!=='completed');
    if(!chosen.length)return Promise.resolve(snapshot());
    const task=new AbortController();controller=task;phase='preflight';selectedKeys=chosen.map(item=>item.key);
    // Defer work one microtask so observer reentrancy and double-clicks see the
    // same in-flight promise before the first callback/session event is emitted.
    active=Promise.resolve().then(()=>execute(chosen,task)).then(()=>snapshot()).finally(()=>{active=undefined;});emit();return active;
  }
  function dispose():Promise<void>{
    if(disposing)return disposing;
    disposed=true;cancel();phase='disposing';emit();
    disposing=Promise.resolve().then(async()=>{
      try{await active;}finally{
        const results=await Promise.allSettled(items.flatMap(item=>item.result?[item.result.dispose()]:[]));
        items=[];selectedKeys=[];currentKey=null;phase='idle';emit();
        const failures=results.filter((result):result is PromiseRejectedResult=>result.status==='rejected');
        if(failures.length)throw new AggregateError(failures.map(result=>result.reason),'Certains fichiers temporaires n’ont pas pu être libérés.');
      }
    });return disposing;
  }
  return {configure,snapshot,run,cancel,dispose};
}
export type DerivationExportQueue=ReturnType<typeof createDerivationExportQueue>;
