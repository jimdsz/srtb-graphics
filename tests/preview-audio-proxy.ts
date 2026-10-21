import {decodeBAAudio} from '../src/studio/ba-audio-clock';
import {previewAudio} from '../src/studio/preview-audio';
import {previewAudioProxyManifest as manifest,validatePreviewBedPCM} from '../src/studio/preview-audio-proxy';
import catalogue from '../src/studio/catalogue.generated.json';
const output=document.querySelector<HTMLPreElement>('#status')!,buttons=[...document.querySelectorAll<HTMLButtonElement>('button')];
async function run(fn:()=>Promise<unknown>){buttons.forEach(button=>button.disabled=true);output.textContent='Qualification en cours…';try{output.textContent=JSON.stringify(await fn(),null,2);}catch(error){output.textContent=JSON.stringify({pass:false,error:String(error)},null,2);}finally{buttons.forEach(button=>button.disabled=false);}}
async function read(path:string){const response=await fetch(path);if(!response.ok)throw Error('HTTP '+response.status);return decodeBAAudio(await response.arrayBuffer());}
document.querySelector('#compare')!.addEventListener('click',()=>void run(async()=>{
  const started=performance.now(),[original,proxy]=await Promise.all([read(manifest.sourcePath),read(manifest.proxyPath)]);validatePreviewBedPCM(proxy);
  let differences=0,maxError=0,sumAA=0,sumBB=0,sumAB=0;for(let channel=0;channel<2;channel++){const a=original.getChannelData(channel),b=proxy.getChannelData(channel);for(let i=0;i<a.length;i++){const error=Math.abs(a[i]-b[i]);if(error!==0)differences++;maxError=Math.max(maxError,error);sumAA+=a[i]*a[i];sumBB+=b[i]*b[i];sumAB+=a[i]*b[i];}}
  return {test:'PCM complet WAV/FLAC via decodeBAAudio navigateur',original:{frames:original.length,rate:original.sampleRate,channels:original.numberOfChannels,duration:original.duration,bytes:manifest.sourceBytes},proxy:{frames:proxy.length,rate:proxy.sampleRate,channels:proxy.numberOfChannels,duration:proxy.duration,bytes:manifest.proxyBytes},differences,maxError,correlation:sumAB/Math.sqrt(sumAA*sumBB),elapsedMs:Math.round(performance.now()-started),pass:original.length===proxy.length&&differences===0};
}));
document.querySelector('#integration')!.addEventListener('click',()=>void run(async()=>{
  // Match previewAudio's absolute module identity. Vite adds ?import to a
  // relative dynamic URL, creating a second class whose prototype is unadapted.
  const audioModuleURL=new URL('/studio-engines/ba-text-v2/audio.mjs',location.href).href;
  const template=catalogue.find(item=>item.id==='BTV_BA_1P')!,module=await import(/* @vite-ignore */audioModuleURL),baseUrl=new URL('/library/v1.7.0/BTV_BA_1P/graphic.mjs',location.href).href,rows=[];
  for(const scenario of ['aperçu','voix WAV explicite','moteur natif sans adaptateur']){
    performance.clearResourceTimings();let engine:any;
    const graphic:any={_update(data:any){engine=new module.AudioEngine({baseUrl});this.audio=engine;return engine.prepare(data);}};
    const adapter=scenario==='moteur natif sans adaptateur'?undefined:await previewAudio(graphic,template as any);
    const data={...module.AUDIO_DEFAULTS,_audio_voice_enabled:scenario==='voix WAV explicite',...(scenario==='voix WAV explicite'?{_audio_voice_url:manifest.sourcePath}:{})};
    try{await graphic._update(data);validatePreviewBedPCM(engine.buffers.bed.buffer);const paths=performance.getEntriesByType('resource').map(entry=>new URL(entry.name).pathname),proxyRequested=paths.includes(manifest.proxyPath),sourceRequested=paths.includes(manifest.sourcePath);
      const previewOwnsContext=adapter?engine.context===adapter.context:null;
      rows.push({scenario,proxyRequested,sourceRequested,previewOwnsContext,canonicalURL:engine.buffers.bed.url===new URL(manifest.sourcePath,location.href).href,frames:engine.buffers.bed.buffer.length,pass:(adapter?previewOwnsContext:true)&&(scenario==='aperçu'?proxyRequested&&!sourceRequested:!proxyRequested&&sourceRequested)});
    }finally{await engine?.dispose();adapter?.dispose();}
  }return {test:'Isolation du proxy audio',rows,pass:rows.every(row=>row.pass)};
}));
output.textContent='Prêt — contrôle audio public local.';
