import type {Project} from './domain';
import type {VideoSnapshot} from './video-snapshot';
import type {VideoOptions,VideoProgress,VideoReport,VideoFormat} from './video/export';
import {activeChannelId} from './channel-context';
import {dimensions,presentation} from './presentation';
import {videoSnapshot} from './video-snapshot';
import {sessionState} from './session-state';
import {request} from './api';
import {withRenderSlot} from './render-slot';

type Result={blob:Blob;report:VideoReport;dispose:()=>Promise<void>};
export interface ExportJob {
  id:string;title:string;channelId:string;projectId:string;revision:number;composition:string;format:VideoFormat;unsaved:boolean;
  status:'pending'|'checking'|'rendering'|'completed'|'failed'|'cancelled';progress:VideoProgress;error?:string;
  result?:{url:string;filename:string;blob:Blob;report:VideoReport};
}
interface Task {view:ExportJob;project:Project;options:VideoOptions;controller:AbortController;prepared:Promise<VideoSnapshot>;dispose?:()=>Promise<void>}
interface QueueDependencies {
  snapshot:(project:Project,signal:AbortSignal,channelId:string)=>Promise<VideoSnapshot>;
  authorize:(project:Project,signal:AbortSignal,channelId:string)=>Promise<void>;
  render:(snapshot:VideoSnapshot,options:VideoOptions,signal:AbortSignal,progress:(value:VideoProgress)=>void)=>Promise<Result>;
  url:(blob:Blob)=>string;revoke:(url:string)=>void;permitted:()=>boolean;
}
const extension={mp4:'.mp4',mov:'.mov',png:'_PNG.zip',alpha:'.webm'};
const errorText=(cause:unknown)=>cause instanceof Error?cause.message:String(cause);
const pending=(job:ExportJob)=>['pending','checking','rendering'].includes(job.status);
const defaults:QueueDependencies={
  snapshot:(project,signal,channelId)=>videoSnapshot(project,signal,{rejectArchived:true,channelId}),
  authorize:async(project,signal,channelId)=>{const current=await request<Project>(`/projects/${project.id}`,{signal},{channelId});if(current.archived)throw Error('Ce projet a été archivé. Restaurez-le avant de l’exporter.');},
  render:async(snapshot,options,signal,progress)=>withRenderSlot(signal,async()=>{signal.throwIfAborted();const {exportBroadcastVideo}=await import('./video/export');return exportBroadcastVideo(snapshot.template,snapshot.data,options,signal,progress);}),
  url:blob=>URL.createObjectURL(blob),revoke:url=>URL.revokeObjectURL(url),permitted:()=>sessionState.permitted(sessionState.snapshot().epoch),
};
/** Tab-owned immutable snapshots. Navigation never disposes a queued job.
 * Nothing is uploaded/saved; closing the tab cannot resume local encoders. */
export function createExportQueue(overrides:Partial<QueueDependencies>={}){
  const deps={...defaults,...overrides},listeners=new Set<()=>void>();
  let tasks:Task[]=[],active:Task|undefined,pumping=false,generation=0;
  let state:{items:readonly ExportJob[];running:boolean}={items:[],running:false};
  function emit(){state={items:tasks.map(({view})=>({...view,progress:{...view.progress}})),running:tasks.some(task=>pending(task.view))};for(const listener of listeners){try{listener();}catch{/* A view cannot strand the queue. */}}}
  function startSnapshot(task:Task){
    // Resolve local File bindings synchronously, before a later edit/reconnection.
    try{task.prepared=deps.snapshot(structuredClone(task.project),task.controller.signal,task.view.channelId);}catch(error){task.prepared=Promise.reject(error);}
    void task.prepared.catch(()=>{});
  }
  async function dispose(task:Task){if(task.view.result){deps.revoke(task.view.result.url);delete task.view.result;}const release=task.dispose;task.dispose=undefined;await release?.().catch(()=>{});}
  async function pump(){
    if(pumping)return;pumping=true;
    try{while(true){
      const task=tasks.find(task=>task.view.status==='pending');if(!task)break;
      active=task;const epoch=generation,signal=task.controller.signal;let result:Result|undefined;
      const valid=()=>epoch===generation&&tasks.includes(task)&&!signal.aborted;
      try{
        signal.throwIfAborted();if(!deps.permitted())throw Error('Reconnectez-vous avant de lancer un export.');
        task.view.status='checking';task.view.progress={percent:0,message:'Vérification des médias et des accès…'};emit();
        const snapshot=await task.prepared;signal.throwIfAborted();
        await deps.authorize(task.project,signal,task.view.channelId);signal.throwIfAborted();
        task.view.status='rendering';task.view.progress={percent:0,message:'En attente du moteur de rendu…'};emit();
        result=await deps.render(structuredClone(snapshot),structuredClone(task.options),signal,progress=>{if(valid()){task.view.progress={percent:Math.min(100,Math.max(0,progress.percent||0)),message:progress.message};emit();}});
        signal.throwIfAborted();if(!valid()||!deps.permitted())throw Error('La session a été interrompue.');
        const filename=snapshot.filename+'_'+presentation(snapshot.data)+extension[task.options.format];
        task.view.result={url:deps.url(result.blob),filename,blob:result.blob,report:result.report};task.dispose=result.dispose;result=undefined;
        task.view.status='completed';task.view.progress={percent:100,message:'Fichier prêt à télécharger.'};delete task.view.error;
      }catch(error){if(tasks.includes(task)){task.view.status=signal.aborted?'cancelled':'failed';task.view.error=signal.aborted?undefined:errorText(error);task.view.progress={...task.view.progress,message:signal.aborted?'Export annulé.':'Export à reprendre.'};}}
      finally{await result?.dispose().catch(()=>{});active=undefined;emit();}
    }}finally{pumping=false;emit();}
  }
  function enqueue(project:Project,options:VideoOptions,meta:{channelId?:string;unsaved?:boolean}={}){
    if(!deps.permitted())throw Error('Vérifiez votre connexion avant d’ajouter un export.');
    if(tasks.length>=8)throw Error('La file contient huit exports. Téléchargez puis retirez les fichiers terminés pour libérer une place.');
    if(!Object.hasOwn(extension,options.format)||!Number.isFinite(options.manualOut)||options.manualOut<0||options.manualOut>600||typeof options.audio!=='boolean'||typeof options.removeBackground!=='boolean'||!/^#[\da-f]{6}$/i.test(options.background))throw Error('Options d’export invalides.');
    const id=crypto.randomUUID(),channelId=meta.channelId??activeChannelId();
    const copy=structuredClone(project),task:Task={view:{id,title:copy.title,channelId,projectId:copy.id,revision:copy.revision,composition:dimensions(copy.data).label,format:options.format,unsaved:!!meta.unsaved,status:'pending',progress:{percent:0,message:'En attente.'}},project:copy,options:structuredClone(options),controller:new AbortController(),prepared:undefined!};
    tasks.push(task);startSnapshot(task);emit();void pump();return id;
  }
  function cancel(id:string){const task=tasks.find(task=>task.view.id===id);if(!task||!pending(task.view))return;task.controller.abort();if(task!==active){task.view.status='cancelled';task.view.progress={percent:0,message:'Export annulé.'};}emit();}
  function retry(id:string){const task=tasks.find(task=>task.view.id===id);if(!task||pending(task.view)||task.view.result)return;if(!deps.permitted())throw Error('Reconnectez-vous avant de réessayer.');task.controller=new AbortController();task.view.status='pending';delete task.view.error;startSnapshot(task);emit();void pump();}
  async function remove(id:string){const task=tasks.find(task=>task.view.id===id);if(!task)return;cancel(id);tasks=tasks.filter(value=>value!==task);emit();await dispose(task);}
  async function clear(){generation++;const old=tasks;tasks=[];for(const task of old)task.controller.abort();emit();await Promise.all(old.map(dispose));}
  function cancelAll(){for(const task of tasks)cancel(task.view.id);}
  return {enqueue,cancel,retry,remove,clear,cancelAll,snapshot:()=>state,subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};},openPanel:()=>{if(typeof window!=='undefined')window.dispatchEvent(new Event('srtb-export-queue-open'));}};
}
export const exportQueue=createExportQueue();
if(typeof window!=='undefined'){
  let epoch=sessionState.snapshot().epoch;
  sessionState.subscribe(()=>{const session=sessionState.snapshot();if(session.ended||session.epoch!==epoch){epoch=session.epoch;void exportQueue.clear();}else if(session.suspended)exportQueue.cancelAll();});
  window.addEventListener('beforeunload',event=>{const state=exportQueue.snapshot();if(state.running||state.items.some(item=>item.result)){event.preventDefault();event.returnValue='';}});
  window.addEventListener('srtb-before-logout',event=>{const state=exportQueue.snapshot();if(!event.defaultPrevented&&(state.running||state.items.some(item=>item.result))&&!window.confirm('La déconnexion arrête les exports et ferme les fichiers prêts de cet onglet. Continuer ?'))event.preventDefault();});
}
