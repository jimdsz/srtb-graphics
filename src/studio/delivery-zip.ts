import { Zip,ZipPassThrough,strToU8 } from 'fflate';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { safePackagePath } from './delivery-plan';
import type { DeliveryPlan } from './delivery-plan';
import {localReference} from './local-reference';

export interface ArchiveSink { write(data:Uint8Array<ArrayBuffer>):Promise<void>;close():Promise<void>;abort():Promise<void> }
export async function writeDeliveryZip(plan:DeliveryPlan,documents:Record<string,string>,sink:ArchiveSink,signal:AbortSignal,progress:(bytes:number,file:string)=>void,fetcher:typeof fetch=fetch,beforeCommit?:()=>Promise<void>){
  // No ZIP64 in fflate. Bound the archive below 4 GiB and apply back-pressure per chunk.
  if(plan.files.length>4000||plan.totalBytes>3*1024**3)throw Error('Livraison trop volumineuse.');
  const paths=new Set<string>();
  for(const file of plan.files){
    if(!safePackagePath(file.path)||paths.has(file.path)||!Number.isSafeInteger(file.bytes)||file.bytes<0||
      (!localReference(file.url)&&!/^\/(?:library\/v[\d.]+\/BTV_[\w]+\/|api\/graphics\/media\/[a-f\d-]+\/content$)/.test(file.url))||/[?#\\]/.test(file.url))throw Error('Inventaire de livraison invalide.');
    paths.add(file.path);
  }
  for(const path of Object.keys(documents))if(!safePackagePath(path)||paths.has(path))throw Error('Nom de document en conflit.');
  let pending:Uint8Array<ArrayBuffer>[]=[];let zipError:Error|undefined;let finished=false;
  const zip=new Zip((error,chunk,final)=>{if(error){zipError=error;return;}pending.push(new Uint8Array(chunk));finished=final;});
  async function flush(){if(zipError)throw zipError;for(const chunk of pending){signal.throwIfAborted();await sink.write(chunk);}pending=[];}
  const verified:{path:string;bytes:number;sha256:string}[]=[];let loaded=0;
  async function addText(path:string,text:string){const bytes=strToU8(text),file=new ZipPassThrough(path);zip.add(file);file.push(bytes,true);await flush();verified.push({path,bytes:bytes.length,sha256:bytesToHex(sha256(bytes))});}
  try{
    for(const source of plan.files){
      signal.throwIfAborted();
      const response=await fetcher(source.url,{credentials:'same-origin',cache:'no-store',redirect:'error',signal});
      if(!response.ok||!response.body||response.headers.get('Content-Type')?.includes('text/html')&&!source.path.endsWith('.html'))throw Error(`Fichier indisponible : ${source.path}`);
      const reader=response.body.getReader(),hash=sha256.create(),file=new ZipPassThrough(source.path);let size=0;
      zip.add(file);
      try{
        while(true){signal.throwIfAborted();const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>source.bytes)throw Error(`Taille inattendue : ${source.path}`);hash.update(item.value);file.push(item.value,false);await flush();loaded+=item.value.length;progress(loaded,source.path);}
      }catch(error){await reader.cancel().catch(()=>undefined);throw error;}finally{reader.releaseLock();}
      const digest=bytesToHex(hash.digest());
      if(size!==source.bytes||source.sha256&&source.sha256!==digest)throw Error(`Contrôle d’intégrité échoué : ${source.path}`);
      file.push(new Uint8Array(),true);await flush();verified.push({path:source.path,bytes:size,sha256:digest});
    }
    for(const [path,text]of Object.entries(documents))await addText(path,text);
    await addText('INVENTAIRE.json',JSON.stringify({format:plan.format,version:1,project:plan.project,files:verified},null,2));
    zip.end();await flush();if(!finished)throw Error('Le ZIP n’a pas pu être finalisé.');
    // Keep the file uncommitted until the server confirms this is still the
    // approved revision, including after a long copy from a network disk.
    signal.throwIfAborted();await beforeCommit?.();signal.throwIfAborted();await sink.close();
  }catch(error){zip.terminate();await sink.abort().catch(()=>undefined);throw error;}
}
