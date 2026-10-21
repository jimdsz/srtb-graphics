import type {SubjectBox,TrackSample} from './subject-tracker';
import {subjectPoints} from './subject-tracker';
import type {CropMotion} from './crop-motion';

export function seekSubjectFrame(video:HTMLVideoElement,seconds:number,signal:AbortSignal):Promise<void>{
 signal.throwIfAborted();if(!video.seeking&&video.readyState>=2&&Math.abs(video.currentTime-seconds)<.015)return Promise.resolve();
 return new Promise((resolve,reject)=>{
  let settled=false;
  const done=(error?:unknown)=>{if(settled)return;settled=true;clearTimeout(timer);for(const event of ['seeked','loadeddata','canplay'])video.removeEventListener(event,ready);video.removeEventListener('error',fail);signal.removeEventListener('abort',abort);error?reject(error):resolve();};
  const ready=()=>{if(!video.seeking&&video.readyState>=2&&Math.abs(video.currentTime-seconds)<.04)done();},fail=()=>done(Error('Impossible de lire cet extrait.')),abort=()=>done(signal.reason??new DOMException('Annulé','AbortError'));
  const timer=setTimeout(()=>done(Error('Le média ne répond pas. Vérifiez le disque ou choisissez un extrait plus court.')),15000);
  for(const event of ['seeked','loadeddata','canplay'])video.addEventListener(event,ready);
  video.addEventListener('error',fail,{once:true});signal.addEventListener('abort',abort,{once:true});
  try{video.currentTime=seconds;ready();}catch{fail();}
 });
}
export async function analyzeSubject(video:HTMLVideoElement,box:SubjectBox,start:number,end:number,duration:number,ratio:number,signal:AbortSignal,onProgress:(percent:number)=>void):Promise<{motion:CropMotion;stoppedAt:number|null}>{
 if(!Number.isFinite(duration)||duration<=.04||duration>60)throw Error('Choisissez un extrait de plus d’une image et de 60 secondes maximum pour le suivi.');
 if(!Number.isFinite(start)||start<0||!Number.isFinite(end)||end<0||!Number.isFinite(ratio)||ratio<=0||!video.videoWidth||!video.videoHeight)throw Error('Le média ou les repères de cadrage ne sont pas prêts.');
 signal.throwIfAborted();video.pause();
 const worker=new Worker(new URL('./subject-tracker.worker.ts',import.meta.url),{type:'module'});
 const canvas=document.createElement('canvas');canvas.width=256;canvas.height=Math.max(1,Math.round(256*video.videoHeight/video.videoWidth));
 if(canvas.height>512){worker.terminate();throw Error('Format de source trop étroit pour ce suivi.');}
 const context=canvas.getContext('2d',{willReadFrequently:true})!;let id=0;
 const send=(pixels:Uint8Array,initial?:SubjectBox)=>new Promise<{box:SubjectBox;confidence:number;stopped:boolean}>((resolve,reject)=>{
  const current=++id,finish=(error?:unknown,value?:{box:SubjectBox;confidence:number;stopped:boolean})=>{clearTimeout(timer);worker.onmessage=null;worker.onerror=null;signal.removeEventListener('abort',abort);error?reject(error):resolve(value!);};
  const abort=()=>finish(signal.reason),timer=setTimeout(()=>finish(Error('Le calcul du suivi ne répond pas. Le cadrage manuel reste disponible.')),10000);
  signal.addEventListener('abort',abort,{once:true});worker.onerror=()=>finish(Error('Le suivi local n’est pas disponible dans ce navigateur.'));
  worker.onmessage=event=>{if(event.data.id===current)finish(event.data.error?Error(event.data.error):undefined,event.data);};
  worker.postMessage({id:current,frame:{width:canvas.width,height:canvas.height,pixels},box:initial},[pixels.buffer]);
 });
 const samples:TrackSample[]=[];let stoppedAt:number|null=null;
 try{
  const count=Math.max(1,Math.ceil(Math.max(0,duration-.04)*5));
  for(let i=0;i<=count;i++){
   signal.throwIfAborted();const at=Math.min(duration-.04,i/ count*Math.max(0,duration-.04));
   await seekSubjectFrame(video,start+Math.max(0,at),signal);signal.throwIfAborted();context.drawImage(video,0,0,canvas.width,canvas.height);
   const rgba=context.getImageData(0,0,canvas.width,canvas.height).data,pixels=new Uint8Array(canvas.width*canvas.height);
   for(let p=0;p<pixels.length;p++)pixels[p]=Math.round(rgba[p*4]*.299+rgba[p*4+1]*.587+rgba[p*4+2]*.114);
   const result=await send(pixels,i===0?{x:box.x*canvas.width,y:box.y*canvas.height,w:box.w*canvas.width,h:box.h*canvas.height}:undefined);signal.throwIfAborted();
   if(result.stopped){stoppedAt=at;break;}samples.push({at:Math.max(0,at),box:result.box,confidence:result.confidence});onProgress(Math.round((i+1)/(count+1)*100));
  }
  if(samples.length<2)throw Error('Le sujet n’a pas pu être suivi. Choisissez une zone plus contrastée ou utilisez les repères manuels.');
  return {motion:{start,end,duration,points:subjectPoints(samples,canvas.width,canvas.height,ratio)},stoppedAt};
 }finally{worker.terminate();canvas.width=canvas.height=1;}
}
