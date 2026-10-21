/// <reference lib="webworker" />
import createFFmpegCore from '../../../vendor/ffmpeg-core-0.12.10/ffmpeg-core.js';

interface FfmpegModule{
  FS:{writeFile:(name:string,data:Uint8Array)=>void;readFile:(name:string)=>Uint8Array;unlink:(name:string)=>void};
  exec:(...args:string[])=>number;
  reset:()=>void;
  setLogger:(logger:(event:{message:string})=>void)=>void;
}
interface RequestMessage{id:number;bytes:ArrayBuffer}

const CORE_WASM_GZIP='/ffmpeg/ffmpeg-core.wasm.gz';
let corePromise:Promise<FfmpegModule>|undefined;

async function loadCore(){
  if(corePromise)return corePromise;
  corePromise=(async()=>{
    if(typeof DecompressionStream==='undefined')throw Error('Décompression locale du moteur FFmpeg indisponible dans ce navigateur.');
    const wasmUrl=new URL(CORE_WASM_GZIP,self.location.origin).href;let stage='téléchargement';
    try{
      const response=await fetch(wasmUrl,{credentials:'same-origin'});
      if(!response.ok)throw Error(`HTTP ${response.status}`);
      stage='lecture du moteur';const received=new Uint8Array(await response.arrayBuffer()),isWasm=received.length>=4&&received[0]===0&&received[1]===0x61&&received[2]===0x73&&received[3]===0x6d;
      let wasmBinary:Uint8Array<ArrayBuffer>;
      if(isWasm)wasmBinary=received;
      else{
        if(received.length<2||received[0]!==0x1f||received[1]!==0x8b)throw Error(`en-tête ni WASM ni gzip (${received[0]?.toString(16)??'vide'} ${received[1]?.toString(16)??'vide'})`);
        stage='décompression gzip';wasmBinary=new Uint8Array(await new Response(new Blob([received]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
      }
      if(wasmBinary.length<8||wasmBinary[0]!==0||wasmBinary[1]!==0x61||wasmBinary[2]!==0x73||wasmBinary[3]!==0x6d)throw Error('signature WebAssembly absente');
      stage='initialisation WebAssembly';return await createFFmpegCore({wasmBinary}) as FfmpegModule;
    }catch(error){throw Error(`Moteur CBR local — ${stage} échoué (${wasmUrl}) : ${error instanceof Error?error.message:String(error)}`);}
  })();
  return corePromise;
}

self.onmessage=async({data}:{data:RequestMessage})=>{
  const {id}=data,logs:string[]=[];
  let module:FfmpegModule|undefined,inputName='',outputName='';
  try{
    self.postMessage({id,progress:'loading'});
    module=await loadCore();
    module.setLogger(({message})=>{logs.push(message);if(logs.length>30)logs.shift();});
    inputName=`segment-${id}.mp4`;outputName=`segment-${id}-cbr.mp4`;
    module.FS.writeFile(inputName,new Uint8Array(data.bytes));
    self.postMessage({id,progress:'encoding'});
    const code=module.exec(
      '-hide_banner','-loglevel','warning','-i',inputName,'-map','0:v:0','-an',
      '-c:v','libx264','-preset','ultrafast','-b:v','50M','-minrate','50M','-maxrate','50M','-bufsize','50M',
      '-x264-params','nal-hrd=cbr:filler=1','-pix_fmt','yuv420p','-fps_mode','passthrough','-movflags','+faststart','-y',outputName,
    );
    if(code!==0)throw Error(`FFmpeg a interrompu le segment (${code}). ${logs.slice(-4).join(' | ')}`);
    const encoded=module.FS.readFile(outputName).slice();
    self.postMessage({id,bytes:encoded.buffer,logs},[encoded.buffer]);
  }catch(error){
    self.postMessage({id,error:error instanceof Error?error.message:String(error),logs});
  }finally{
    if(module){for(const name of [inputName,outputName])if(name)try{module.FS.unlink(name);}catch{}module.reset();}
  }
};
