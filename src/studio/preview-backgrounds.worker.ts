import {unzipSync} from 'fflate';
self.onmessage=(event:MessageEvent<ArrayBuffer>)=>{
  try{
    const entries=unzipSync(new Uint8Array(event.data));
    const transfer=Object.values(entries).map(bytes=>bytes.buffer as ArrayBuffer);
    self.postMessage({entries},{transfer});
  }catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
};
