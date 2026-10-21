import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';

// Runs in the hash worker. Kept separate to exercise slow network streams and
// reader cancellation without making tests depend on disk speed or file size.
export async function fingerprintStream(file:{size:number;stream:()=>ReadableStream<Uint8Array>},progress:(value:number)=>void,signal?:AbortSignal,waitUntilRunnable:()=>Promise<void>=async()=>{}){
  signal?.throwIfAborted();
  const reader=file.stream().getReader(),hash=sha256.create();let bytes=0,lastProgress=0,lastYield=performance.now(),complete=false;
  const abort=()=>{void reader.cancel(signal?.reason).catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
  try{
    while(true){
      signal?.throwIfAborted();await waitUntilRunnable();signal?.throwIfAborted();
      const part=await reader.read();signal?.throwIfAborted();if(part.done)break;
      hash.update(part.value);bytes+=part.value.length;
      const now=performance.now();if(now-lastProgress>=150){progress(Math.min(1,bytes/file.size));lastProgress=now;}
      // Allow pause/cancel messages to run even on cached, immediately available
      // File stream chunks. No timer is needed for every small chunk.
      if(now-lastYield>=8){await new Promise<void>(resolve=>setTimeout(resolve,0));lastYield=performance.now();}
    }
    if(bytes!==file.size)throw Error('Lecture locale incomplète. Reconnectez le fichier.');
    complete=true;progress(1);return bytesToHex(hash.digest());
  }finally{
    signal?.removeEventListener('abort',abort);if(!complete)await reader.cancel().catch(()=>{});reader.releaseLock();hash.destroy();
  }
}
