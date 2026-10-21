import {fingerprintStream} from './local-fingerprint-stream';
let paused=false,resume:(()=>void)|undefined,started=false;
const waitUntilRunnable=async()=>{while(paused)await new Promise<void>(resolve=>{resume=resolve;});};
self.onmessage=async(event:MessageEvent<{type:'hash';file:File}|{type:'pause'|'resume'}>)=>{
  if(event.data.type==='pause'){paused=true;return;}
  if(event.data.type==='resume'){paused=false;resume?.();resume=undefined;return;}
  if(event.data.type!=='hash'||started)return;started=true;
  try{self.postMessage({hash:await fingerprintStream(event.data.file,progress=>self.postMessage({progress}),undefined,waitUntilRunnable)});}
  catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
};
