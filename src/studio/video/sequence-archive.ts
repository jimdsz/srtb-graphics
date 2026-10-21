import {Zip,ZipPassThrough,strToU8} from 'fflate';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';

export interface SequenceSink {
  write(data:Uint8Array<ArrayBuffer>):Promise<void>;finish():Promise<Blob>;dispose():Promise<void>;
}
export const SEQUENCE_BYTE_LIMIT=3*1024**3; // fflate does not produce ZIP64.
export async function sequenceDestination(signal:AbortSignal):Promise<SequenceSink>{
  let directory:FileSystemDirectoryHandle|undefined,name:string|undefined;
  try{
    directory=await(await navigator.storage.getDirectory()).getDirectoryHandle('srtb-temporary-exports',{create:true});
    name=crypto.randomUUID()+'.partial';const handle=await directory.getFileHandle(name,{create:true}),stream=await handle.createWritable();
    const root=directory,key=name;let closed=false;
    return {
      async write(data){signal.throwIfAborted();await stream.write(data);},
      async finish(){signal.throwIfAborted();await stream.close();closed=true;return new Blob([await handle.getFile()],{type:'application/zip'});},
      async dispose(){if(!closed)await stream.abort().catch(()=>{});await root.removeEntry(key).catch(()=>{});},
    };
  }catch{if(directory&&name)await directory.removeEntry(name).catch(()=>{});}
  // A bounded fallback for private browsing / unavailable OPFS. Never retain an
  // unbounded HD sequence in RAM, and never silently truncate it.
  let chunks:Uint8Array<ArrayBuffer>[]=[],size=0;
  return {
    async write(chunk){signal.throwIfAborted();size+=chunk.length;if(size>128*1024**2)throw Error('Stockage temporaire indisponible : cette séquence dépasse 128 Mo. Utilisez Chrome ou Edge en mode normal avec de l’espace disque, ou réduisez la durée.');chunks.push(chunk);},
    async finish(){signal.throwIfAborted();const blob=new Blob(chunks,{type:'application/zip'});chunks=[];return blob;},
    async dispose(){chunks=[];},
  };
}
export function sequenceArchive(sink:SequenceSink,signal:AbortSignal,limit=SEQUENCE_BYTE_LIMIT){
  let pending:Uint8Array<ArrayBuffer>[]=[],error:Error|undefined,finished=false,bytes=0,closed=false;
  const files:{path:string;bytes:number;sha256:string;offset:number}[]=[],paths=new Set<string>();
  const zip=new Zip((cause,chunk,final)=>{if(cause){error=cause;return;}pending.push(new Uint8Array(chunk));finished=final;});
  async function flush(){
    if(error)throw error;
    for(const chunk of pending){signal.throwIfAborted();if(bytes+chunk.length>limit)throw Error('Cette séquence PNG dépasse la limite du ZIP (3 Gio). Réduisez la durée de l’export.');await sink.write(chunk);bytes+=chunk.length;}
    pending=[];
  }
  async function add(path:string,chunks:Iterable<Uint8Array<ArrayBuffer>>){
    signal.throwIfAborted();
    if(closed||!/^([a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+$/.test(path)||path.includes('..')||paths.has(path)||files.length>=15003)throw Error('Inventaire de séquence invalide.');
    paths.add(path);const entry=new ZipPassThrough(path),hash=sha256.create(),offset=bytes;let size=0;zip.add(entry);
    for(const chunk of chunks){signal.throwIfAborted();size+=chunk.length;hash.update(chunk);entry.push(chunk,false);await flush();}
    entry.push(new Uint8Array(),true);await flush();files.push({path,bytes:size,sha256:bytesToHex(hash.digest()),offset});
  }
  return {
    add,
    text:(path:string,value:string)=>add(path,[strToU8(value)]),
    inventory:()=>files.map(({offset:_,...file})=>file),
    bytes:()=>bytes,
    async finish(progress:(fraction:number)=>void){
      closed=true;zip.end();await flush();if(!finished)throw Error('ZIP non finalisé.');
      const blob=await sink.finish();signal.throwIfAborted();if(blob.size!==bytes)throw Error('ZIP incomplet.');
      // Re-read the stored ZIP, not the source buffers: verify every entry's
      // header, length and SHA-256 with bounded reads before offering download.
      const tail=new DataView(await blob.slice(-22).arrayBuffer());
      if(tail.getUint32(0,true)!==0x06054b50||tail.getUint16(10,true)!==files.length||tail.getUint32(12,true)+tail.getUint32(16,true)+22!==blob.size)throw Error('Index ZIP invalide.');
      let checked=0;
      for(const file of files){
        signal.throwIfAborted();const h=new DataView(await blob.slice(file.offset,file.offset+30).arrayBuffer());
        if(h.getUint32(0,true)!==0x04034b50||h.getUint16(8,true)!==0)throw Error('Entrée ZIP invalide.');
        const name=await blob.slice(file.offset+30,file.offset+30+h.getUint16(26,true)).text();
        if(name!==file.path)throw Error(`Contrôle d’intégrité échoué : nom ${file.path}`);
        const start=file.offset+30+h.getUint16(26,true)+h.getUint16(28,true),hash=sha256.create();
        for(let at=0;at<file.bytes;at+=1024**2){signal.throwIfAborted();hash.update(new Uint8Array(await blob.slice(start+at,start+Math.min(file.bytes,at+1024**2)).arrayBuffer()));}
        if(bytesToHex(hash.digest())!==file.sha256)throw Error(`Contrôle d’intégrité échoué : ${file.path}`);
        progress(++checked/files.length);
      }
      signal.throwIfAborted();return blob;
    },
    async dispose(){zip.terminate();pending=[];await sink.dispose();},
  };
}
