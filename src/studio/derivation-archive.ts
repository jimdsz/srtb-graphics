import {Zip,ZipPassThrough,strToU8} from 'fflate';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import type {ArchiveSink} from './delivery-zip';
import type {DerivationExportState} from './derivation-export-queue';

export const DERIVATION_ZIP_LIMIT=3*1024**3;
export const DERIVATION_MEMORY_LIMIT=128*1024**2;
const METADATA_BUDGET=128*1024,CHUNK_LIMIT=1024**2;
const manifestName='INVENTAIRE.json';
export interface DerivationArchiveFile {key:string;projectId:string;revision:number;format:string;filename:string;originalFilename:string;blob:Blob}
export interface DerivationArchivePlan {files:readonly DerivationArchiveFile[];omitted:readonly {key:string;status:string}[];requestedCount:number;sourceBytes:number;maxBytes:number;complete:boolean}
export interface DerivationArchiveProgress {phase:'copying'|'finalizing'|'committing'|'complete';sourceBytes:number;copiedBytes:number;writtenBytes:number;fileIndex:number;fileCount:number;filename:string}
export interface DerivationArchiveOutcome {mode:'disk'|'memory';blob?:Blob;bytes:number;count:number;requestedCount:number;complete:boolean}
export interface DerivationArchiveDownloadLink {url:string;filename:string;count:number;requestedCount:number;complete:boolean}
export interface DerivationArchiveDestination {mode:'disk'|'memory';sink:ArchiveSink;result:()=>Blob|undefined}
export interface DerivationArchiveState {running:boolean;phase:'idle'|'choosing'|DerivationArchiveProgress['phase']|'cancelled'|'failed';progress:DerivationArchiveProgress|null;message:string;error:string}
export const initialDerivationArchiveState:DerivationArchiveState={running:false,phase:'idle',progress:null,message:'',error:''};

/** Flat portable names only. Reject dangerous paths rather than silently turn
 * them into a different filename. Normal collisions receive a visible suffix. */
export function archiveFilename(value:string){
  const name=value.normalize('NFC');
  if(!/^[\p{L}\p{N}][\p{L}\p{N}._ -]*$/u.test(name)||name.includes('..')||/[. ]$/.test(name)||/^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]) *(?:\.|$)/i.test(name)||strToU8(name).length>200)throw Error('Un nom de fichier de cette file ne peut pas être archivé en sécurité. Les téléchargements individuels restent disponibles.');
  return name;
}
export function planDerivationArchive(state:DerivationExportState):DerivationArchivePlan{
  if(state.running||state.phase!=='idle')throw Error('Attendez la fin ou l’annulation complète du calcul avant de télécharger l’ensemble.');
  if(!state.items.length||state.items.length>8)throw Error('Choisissez une file de un à huit résultats.');
  const used=new Set([manifestName.toLowerCase()]),keys=new Set<string>(),files:DerivationArchiveFile[]=[],omitted:{key:string;status:string}[]=[];let sourceBytes=0;
  for(const item of state.items){
    if(keys.has(item.key))throw Error('La file contient un résultat en double.');keys.add(item.key);
    if(item.status!=='completed'){omitted.push({key:item.key,status:item.status});continue;}
    const result=item.result;
    if(!result||!Number.isSafeInteger(result.blob.size)||result.blob.size<=0||typeof result.blob.stream!=='function')throw Error('Un fichier terminé est absent ou vide. Ses autres résultats sont conservés.');
    const originalFilename=archiveFilename(result.filename);if(strToU8(originalFilename).length>180)throw Error('Nom trop long pour l’archive groupée. Utilisez les liens individuels.');
    const dot=originalFilename.lastIndexOf('.'),stem=dot>0?originalFilename.slice(0,dot):originalFilename,extension=dot>0?originalFilename.slice(dot):'';
    let filename=originalFilename,serial=2;while(used.has(filename.toLowerCase()))filename=`${stem}__${serial++}${extension}`;
    used.add(filename.toLowerCase());sourceBytes+=result.blob.size;
    files.push(Object.freeze({key:item.key,projectId:item.project.id,revision:item.project.revision,format:item.options.format,filename,originalFilename,blob:result.blob}));
  }
  if(!files.length)throw Error('Aucun fichier terminé à réunir. Les éléments en échec ne sont pas recalculés par cette action.');
  // Conservative allowance for names, JSON, headers, descriptors and index.
  // The writer also enforces the actual emitted-byte limit, including metadata.
  const maxBytes=sourceBytes+METADATA_BUDGET;
  if(!Number.isSafeInteger(maxBytes)||maxBytes>DERIVATION_ZIP_LIMIT)throw Error('Cet ensemble dépasse la limite ZIP de 3 Gio. Téléchargez les fichiers individuellement ; aucun résultat n’est supprimé.');
  return Object.freeze({files:Object.freeze(files),omitted:Object.freeze(omitted.map(item=>Object.freeze(item))),requestedCount:state.items.length,sourceBytes,maxBytes,complete:omitted.length===0});
}

/** Copy already-rendered bytes, never fetch media or re-enter an encoder. */
export async function writeDerivationArchive(plan:DerivationArchivePlan,sink:ArchiveSink,signal:AbortSignal,progress:(value:DerivationArchiveProgress)=>void=()=>{},limit=DERIVATION_ZIP_LIMIT){
  let pending:Uint8Array<ArrayBuffer>[]=[],zipError:Error|undefined,finished=false,writtenBytes=0,copiedBytes=0,fileIndex=0,filename='',nextReport=0,nextYield=4*CHUNK_LIMIT;
  const verified:{key:string;projectId:string;revision:number;format:string;filename:string;originalFilename:string;bytes:number;sha256:string}[]=[];
  const zip=new Zip((error,chunk,final)=>{if(error){zipError=error;return;}pending.push(new Uint8Array(chunk));finished=final;});
  const report=(phase:DerivationArchiveProgress['phase'])=>{try{progress({phase,sourceBytes:plan.sourceBytes,copiedBytes,writtenBytes,fileIndex,fileCount:plan.files.length,filename});}catch{/* An observer cannot strand the sink. */}};
  async function flush(){
    if(zipError)throw zipError;
    for(const chunk of pending){signal.throwIfAborted();if(writtenBytes+chunk.length>limit)throw Error('Le ZIP dépasse la limite de stockage autorisée. Téléchargez les fichiers individuellement.');await sink.write(chunk);writtenBytes+=chunk.length;signal.throwIfAborted();}
    pending=[];
  }
  try{
    signal.throwIfAborted();
    if(!Number.isSafeInteger(limit)||limit<=0||limit>DERIVATION_ZIP_LIMIT||!plan.files.length||plan.files.length>8||plan.sourceBytes>limit)throw Error('Taille d’archive non prise en charge.');
    const names=new Set<string>();
    for(const file of plan.files){archiveFilename(file.originalFilename);if(file.filename!==archiveFilename(file.filename)||names.has(file.filename.toLowerCase())||file.filename.toLowerCase()===manifestName.toLowerCase())throw Error('Inventaire de fichiers invalide.');names.add(file.filename.toLowerCase());}
    report('copying');
    for(const source of plan.files){
      signal.throwIfAborted();filename=source.filename;fileIndex++;const reader=source.blob.stream().getReader(),hash=sha256.create(),entry=new ZipPassThrough(source.filename);let readBytes=0,cancelling:Promise<void>|undefined;
      const cancelReader=(reason:unknown)=>cancelling??=reader.cancel(reason).catch(()=>undefined);
      const cancelRead=()=>{void cancelReader(signal.reason);};signal.addEventListener('abort',cancelRead,{once:true});
      try{
        zip.add(entry);await flush();
        while(true){
          signal.throwIfAborted();const item=await reader.read();signal.throwIfAborted();if(item.done)break;
          for(let offset=0;offset<item.value.length;offset+=CHUNK_LIMIT){
            const chunk=item.value.subarray(offset,Math.min(item.value.length,offset+CHUNK_LIMIT));readBytes+=chunk.length;
            if(readBytes>source.blob.size)throw Error('Taille inattendue dans un fichier calculé.');
            hash.update(chunk);entry.push(chunk,false);await flush();copiedBytes+=chunk.length;
            if(copiedBytes>=nextReport){report('copying');nextReport=copiedBytes+CHUNK_LIMIT;}
            // Let cancellation and measured UI progress run even for RAM blobs.
            if(copiedBytes>=nextYield){await new Promise<void>(resolve=>setTimeout(resolve,0));nextYield=copiedBytes+4*CHUNK_LIMIT;signal.throwIfAborted();}
          }
        }
        if(readBytes!==source.blob.size)throw Error('Un fichier calculé est incomplet.');
        entry.push(new Uint8Array(),true);await flush();
        const {blob:_,...metadata}=source;verified.push({...metadata,bytes:readBytes,sha256:bytesToHex(hash.digest())});report('copying');
      }catch(cause){await cancelReader(cause);throw cause;}
      finally{signal.removeEventListener('abort',cancelRead);await cancelling;reader.releaseLock();}
    }
    if(copiedBytes!==plan.sourceBytes)throw Error('La taille totale des résultats a changé.');
    report('finalizing');
    const manifest=strToU8(JSON.stringify({format:'srtb-derivation-files',version:1,complete:plan.complete,requestedCount:plan.requestedCount,includedCount:verified.length,files:verified,omitted:plan.omitted},null,2));
    if(manifest.length>METADATA_BUDGET/2)throw Error('Inventaire de fichiers trop volumineux.');
    const index=new ZipPassThrough(manifestName);zip.add(index);index.push(manifest,true);await flush();zip.end();await flush();
    if(!finished)throw Error('Le ZIP n’a pas pu être finalisé.');
    signal.throwIfAborted();report('committing');signal.throwIfAborted();
    // Atomic commit boundary. A successful close has saved the destination even
    // if cancellation arrives during close; never report that result as deleted.
    await sink.close();report('complete');return {bytes:writtenBytes,files:verified};
  }catch(cause){zip.terminate();pending=[];await sink.abort().catch(()=>undefined);throw cause;}
}

/** The operation owns neither result blobs nor their dispose/revoke callbacks.
 * Its caller must await dispose() before disposing the queue that owns them. */
export function createDerivationArchiveTask({onChange,bindSession=()=>()=>{}}:{onChange?:(state:DerivationArchiveState)=>void;bindSession?:(task:AbortController)=>()=>void}={}){
  let state={...initialDerivationArchiveState},controller:AbortController|undefined,active:Promise<DerivationArchiveOutcome|null>|undefined,disposed=false,disposing:Promise<void>|undefined;
  function emit(next:DerivationArchiveState){state=next;try{onChange?.({...state});}catch{/* Cleanup must not depend on the view. */}}
  function cancel(){controller?.abort(new DOMException('Préparation du ZIP annulée. Les fichiers calculés sont conservés.','AbortError'));}
  function run(plan:DerivationArchivePlan,open:(signal:AbortSignal)=>Promise<DerivationArchiveDestination>):Promise<DerivationArchiveOutcome|null>{
    if(disposed)return Promise.reject(Error('La récupération de cet ensemble est fermée.'));
    if(active)return active;
    const task=new AbortController();controller=task;
    let resolve!:(value:DerivationArchiveOutcome|null)=>void;active=new Promise(done=>{resolve=done;});const promise=active;
    emit({running:true,phase:'choosing',progress:null,error:'',message:'Choisissez où enregistrer le ZIP…'});
    // Invoke open synchronously from the click, before any asynchronous work.
    void (async()=>{
      let destination:DerivationArchiveDestination|undefined,stop=()=>{};
      try{
        stop=bindSession(task);task.signal.throwIfAborted();destination=await open(task.signal);task.signal.throwIfAborted();
        const result=await writeDerivationArchive(plan,destination.sink,task.signal,value=>emit({running:true,phase:value.phase,progress:value,error:'',message:value.phase==='committing'?'Finalisation du fichier sur le poste…':'Copie locale des fichiers calculés…'}),destination.mode==='memory'?DERIVATION_MEMORY_LIMIT:DERIVATION_ZIP_LIMIT);
        const outcome={mode:destination.mode,blob:destination.result(),bytes:result.bytes,count:plan.files.length,requestedCount:plan.requestedCount,complete:plan.complete};
        emit({...state,running:false,phase:'complete',error:'',message:`ZIP ${plan.complete?'complet':'partiel'} prêt : ${plan.files.length}/${plan.requestedCount} fichiers.`});return outcome;
      }catch(cause){
        // writeDerivationArchive already aborts on copy errors; destinations make
        // abort idempotent, also covering cancellation while opening a picker.
        await destination?.sink.abort().catch(()=>undefined);
        const cancelled=task.signal.aborted||cause instanceof DOMException&&cause.name==='AbortError';
        emit({...state,running:false,phase:cancelled?'cancelled':'failed',error:cancelled?'':cause instanceof Error?cause.message:String(cause),message:cancelled?'ZIP annulé. Tous les fichiers calculés et leurs liens sont conservés.':''});return null;
      }finally{try{stop();}finally{controller=undefined;}}
    })().then(result=>{active=undefined;resolve(result);},cause=>{active=undefined;emit({...state,running:false,phase:'failed',error:cause instanceof Error?cause.message:String(cause),message:''});resolve(null);});
    return promise;
  }
  function dispose(){if(disposing)return disposing;disposed=true;cancel();return disposing=Promise.resolve(active).then(()=>undefined);}
  return {run,cancel,dispose,snapshot:()=>({...state}),running:()=>!!active};
}
export type DerivationArchiveTask=ReturnType<typeof createDerivationArchiveTask>;
