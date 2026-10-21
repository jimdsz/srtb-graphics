/// <reference lib="webworker" />
// Qualification fixture only, not part of the product build.
onmessage=async()=>{
 let module:any;const logs:string[]=[];
 try{
  const url='/.tools/ffmpeg-study/package/dist/esm/ffmpeg-core.js';
  const {default:create}=await import(/* @vite-ignore */url);
  module=await create({locateFile:()=>new URL('/.tools/ffmpeg-study/package/dist/esm/ffmpeg-core.wasm',location.origin).href});
  module.setLogger(({message}:{message:string})=>{logs.push(message);if(logs.length>35)logs.shift();});
  for(const pattern of ['color=c=black','testsrc2=size=1920x1080'] as const){
   const started=performance.now();
   const code=module.exec('-f','lavfi','-i',pattern+':size=1920x1080:rate=25:duration=2','-an','-c:v','libx264','-preset','ultrafast','-b:v','50M','-minrate','50M','-maxrate','50M','-bufsize','50M','-x264-params','nal-hrd=cbr:filler=1','-pix_fmt','yuv420p','-y','out.mp4');
   if(code!==0)throw Error('FFmpeg '+code+' '+logs.join('\n'));
   const bytes=module.FS.readFile('out.mp4') as Uint8Array;module.FS.unlink('out.mp4');module.reset();
   postMessage({pattern,seconds:(performance.now()-started)/1000,bytes,logs:[...logs]},[bytes.buffer]);
  }
  postMessage({done:true});
 }catch(error){postMessage({error:error instanceof Error?error.stack:String(error),logs});}
};
