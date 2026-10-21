import {stretchStereo} from './stretch';
self.onmessage=({data}:{data:{left:Float32Array;right:Float32Array;sampleRate:number;tempo:number;frames:number}})=>{
  try{const channels=stretchStereo(data.left,data.right,data.sampleRate,data.tempo,data.frames);self.postMessage({channels}, {transfer:channels.map(c=>c.buffer)});}
  catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
};
