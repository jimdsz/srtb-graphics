import {ALL_FORMATS,BlobSource,CanvasSink,Input} from 'mediabunny';
export async function ffmpegCbrContracts(save:(name:string,body:Blob|string)=>Promise<void>,status:(s:string)=>void,signal:AbortSignal){
 const worker=new Worker(new URL('./ffmpeg-cbr.worker.ts',import.meta.url),{type:'module'}),records:unknown[]=[],stamp=Date.now();let queue=Promise.resolve();
 status('Qualification FFmpeg locale · aucune modification du moteur de production');
 try{
  await new Promise<void>((resolve,reject)=>{
   const abort=()=>reject(signal.reason),timer=setTimeout(()=>reject(Error('Essai limité à 90 secondes')),90000);
   const finish=(error?:unknown)=>{clearTimeout(timer);signal.removeEventListener('abort',abort);error?reject(error):resolve();};signal.addEventListener('abort',abort,{once:true});
   worker.onerror=event=>finish(Error(event.message));
   worker.onmessage=event=>{const data=event.data;if(data.error){finish(Error(data.error));return;}if(data.done){queue.then(()=>finish(),finish);return;}
    queue=queue.then(async()=>{const blob=new Blob([data.bytes],{type:'video/mp4'}),input=new Input({formats:ALL_FORMATS,source:new BlobSource(blob)});try{const track=await input.getPrimaryVideoTrack();if(!track||!await new CanvasSink(track).getCanvas(1))throw Error('Décodage de l’essai impossible');const stats=await track.computePacketStats();records.push({pattern:data.pattern,seconds:data.seconds,stats,bytes:blob.size,logs:data.logs});status(data.pattern+' · '+data.seconds.toFixed(1)+' s · '+(stats.averageBitrate/1e6).toFixed(2)+' Mb/s');await save(`ffmpeg-cbr-${records.length}-${stamp}.mp4`,blob);}finally{input.dispose();}});void queue.catch(finish);
   };worker.postMessage({});
  });
  await save('ffmpeg-cbr-'+stamp+'.json',JSON.stringify(records,null,2));return records;
 }finally{worker.terminate();}
}
