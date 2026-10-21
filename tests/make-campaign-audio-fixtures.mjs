// Synthetic local-only integration fixtures, not editorially validated voices.
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

const directory=resolve('.tools/campaign-qualification');
await mkdir(directory,{recursive:true});
const rate=48000,duration=3.6,frames=rate*duration;
const manifest=[];
for(const [index,cue]of ['mardi','demain','aujourdhui','ce-soir','tout-de-suite'].entries()){
  const pcm=Buffer.alloc(44+frames*4);
  pcm.write('RIFF');pcm.writeUInt32LE(pcm.length-8,4);pcm.write('WAVEfmt ',8);
  pcm.writeUInt32LE(16,16);pcm.writeUInt16LE(1,20);pcm.writeUInt16LE(2,22);
  pcm.writeUInt32LE(rate,24);pcm.writeUInt32LE(rate*4,28);pcm.writeUInt16LE(4,32);
  pcm.writeUInt16LE(16,34);pcm.write('data',36);pcm.writeUInt32LE(frames*4,40);
  const frequency=400+index*100;
  for(let frame=0;frame<frames;frame++){
    const time=frame/rate;
    const envelope=time<.04||time>duration-.04?.4:.12;
    const signal=Math.round(envelope*Math.sin(2*Math.PI*frequency*time)*32767);
    pcm.writeInt16LE(signal,44+frame*4);pcm.writeInt16LE(-signal,46+frame*4);
  }
  const name=`TEST-SYNTHETIQUE-${cue}.wav`,path=resolve(directory,name);
  await writeFile(path,pcm);
  manifest.push({name,path,cue,frequency,duration,rate,channels:2,sha256:createHash('sha256').update(pcm).digest('hex')});
}
await writeFile(resolve(directory,'manifest.json'),JSON.stringify({notice:'Synthetic tones only. No speech, no user media, no editorial attestation.',files:manifest},null,2));
console.log(JSON.stringify({directory,files:manifest},null,2));
