import {Stretch} from '@soundtouchjs/core';
// Independent of DOM/Web Audio: deterministic stereo WSOLA with bounded chunks.
export function stretchStereo(left:Float32Array,right:Float32Array,sampleRate:number,tempo:number,frames:number){
  if(!(tempo>=.0625&&tempo<=4)||!Number.isSafeInteger(frames)||frames<=0||left.length!==right.length)throw Error('Paramètres de vitesse audio invalides.');
  const processor=new Stretch({createBuffers:true,sampleRate});processor.tempo=tempo;
  const output=[new Float32Array(frames),new Float32Array(frames)],chunk=new Float32Array(8192*2);let read=0,written=0;
  const padding=Math.max(sampleRate,processor.sampleReq*8);
  while(written<frames){
    if(read>left.length+padding)throw Error('Le traitement de vitesse audio n’a pas produit la durée attendue.');
    const count=Math.min(8192,Math.max(8192,left.length-read));chunk.fill(0);
    for(let i=0;i<count&&read+i<left.length;i++){chunk[i*2]=left[read+i];chunk[i*2+1]=right[read+i];}
    processor.inputBuffer!.putSamples(chunk,0,count);read+=count;processor.process();
    while(processor.outputBuffer!.frameCount&&written<frames){const n=Math.min(8192,processor.outputBuffer!.frameCount,frames-written);processor.outputBuffer!.extract(chunk,0,n);processor.outputBuffer!.receive(n);for(let i=0;i<n;i++){output[0][written+i]=chunk[i*2];output[1][written+i]=chunk[i*2+1];}written+=n;}
  }
  processor.clear();return output;
}
