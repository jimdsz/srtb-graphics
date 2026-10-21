import type {ArchiveSink} from './delivery-zip';
import {DERIVATION_MEMORY_LIMIT} from './derivation-archive';
import type {DerivationArchiveDestination,DerivationArchivePlan} from './derivation-archive';

interface SaveHandle {createWritable(options?:{mode:'exclusive'}):Promise<ArchiveSink>}
export interface ArchivePickerWindow {showSaveFilePicker?:(options:{suggestedName:string;types:{description:string;accept:Record<string,string[]>}[]})=>Promise<SaveHandle>}
export const hasDerivationArchivePicker=()=>typeof window!=='undefined'&&typeof (window as ArchivePickerWindow).showSaveFilePicker==='function';

/** Explicitly bounded fallback, including ZIP metadata, not just input sizes. */
export function memoryDerivationArchive(signal:AbortSignal,limit=DERIVATION_MEMORY_LIMIT):DerivationArchiveDestination{
  if(!Number.isSafeInteger(limit)||limit<=0||limit>DERIVATION_MEMORY_LIMIT)throw Error('Limite mémoire invalide.');
  let chunks:Uint8Array<ArrayBuffer>[]=[],size=0,closed=false,aborted=false,blob:Blob|undefined;
  return {mode:'memory',result:()=>blob,sink:{
    async write(bytes){signal.throwIfAborted();if(closed||aborted)throw Error('Destination fermée.');if(size+bytes.length>limit)throw Error('Le ZIP dépasse 128 Mio en mémoire. Utilisez l’écriture directe sur disque de Chrome/Edge ou les téléchargements individuels ; vos résultats sont conservés.');chunks.push(bytes);size+=bytes.length;},
    async close(){signal.throwIfAborted();if(aborted)throw Error('Destination annulée.');if(closed)return;blob=new Blob(chunks,{type:'application/zip'});chunks=[];closed=true;},
    async abort(){if(closed||aborted)return;aborted=true;chunks=[];size=0;},
  }};
}

/** Picker is invoked before the first await, preserving the user gesture. */
export async function openDerivationArchive(plan:DerivationArchivePlan,filename:string,signal:AbortSignal,host:ArchivePickerWindow=window as ArchivePickerWindow):Promise<DerivationArchiveDestination>{
  signal.throwIfAborted();
  if(!host.showSaveFilePicker){
    if(plan.maxBytes>DERIVATION_MEMORY_LIMIT)throw Error('Cet ensemble dépasse 128 Mio, limite du ZIP en mémoire. Utilisez Chrome/Edge avec l’écriture directe sur disque, ou téléchargez chaque fichier avec son lien individuel. Aucun résultat n’est supprimé.');
    return memoryDerivationArchive(signal);
  }
  const handle=await host.showSaveFilePicker({suggestedName:filename,types:[{description:'Ensemble de vidéos SRTB · ZIP',accept:{'application/zip':['.zip']}}]});
  signal.throwIfAborted();const writable=await handle.createWritable({mode:'exclusive'});
  if(signal.aborted){await writable.abort().catch(()=>undefined);signal.throwIfAborted();}
  let closed=false,aborting:Promise<void>|undefined;
  return {mode:'disk',result:()=>undefined,sink:{
    async write(bytes){signal.throwIfAborted();if(closed||aborting)throw Error('Destination fermée.');await writable.write(bytes);},
    async close(){signal.throwIfAborted();if(aborting)throw Error('Destination annulée.');if(closed)return;await writable.close();closed=true;},
    abort(){if(closed)return Promise.resolve();return aborting??=writable.abort();},
  }};
}
