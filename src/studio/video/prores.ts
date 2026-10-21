// Loaded only for a MOV export; no remote codec service or media upload.
import {VideoSample,VideoSampleSource,canEncodeVideo} from 'mediabunny';
import {registerProResEncoder} from 'prores-wasm-encoder/mediabunny';
import {registerProresDecoder} from '@mediabunny/prores';

let registered=false;
export async function proresSource(canvas:HTMLCanvasElement|OffscreenCanvas){
  if(!isSecureContext||typeof WebAssembly==='undefined'||typeof Worker==='undefined'||typeof VideoFrame==='undefined')throw Error('Le MOV nécessite Chrome ou Edge récent sur ordinateur. La séquence PNG reste disponible.');
  if(!registered){
    const memory=(navigator as Navigator&{deviceMemory?:number}).deviceMemory;
    registerProResEncoder({workers:Math.max(1,Math.min(memory&&memory<=4?2:4,Math.floor((navigator.hardwareConcurrency||2)/2)))});
    registerProresDecoder();registered=true;
  }
  if(!await canEncodeVideo('prores',{width:canvas.width,height:canvas.height,frameRate:25,fullCodecString:'ap4h',alpha:'keep'}))throw Error('Encodage MOV indisponible sur ce navigateur. Choisissez la séquence PNG.');
  const context=canvas.getContext('2d',{willReadFrequently:true}) as CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D|null;
  if(!context)throw Error('Lecture du rendu RGBA indisponible.');
  const source=new VideoSampleSource({codec:'prores',fullCodecString:'ap4h',alpha:'keep',bitrate:300_000_000});
  return {source,async add(frame:number){
    // CanvasSource/VideoFrame.copyTo can return premultiplied RGB in Chromium.
    // Explicit straight RGBA prevents dark fringes and faded brand colours.
    const sample=new VideoSample(context.getImageData(0,0,canvas.width,canvas.height).data,{format:'RGBA',codedWidth:canvas.width,codedHeight:canvas.height,timestamp:frame/25,duration:1/25});
    try{await source.add(sample);}finally{sample.close();}
  }};
}
