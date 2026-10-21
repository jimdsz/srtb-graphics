import type {BroadcastTemplate,ProjectData} from '../domain';
import type {VideoOptions,VideoProgress,VideoReport} from './export';
import {prepareGraphic} from './engine';
import {audioEvents,mixAudio} from './audio';
import {frameFilename,pcm24Wav} from './sequence-format';
import {sequenceArchive,sequenceDestination,SEQUENCE_BYTE_LIMIT} from './sequence-archive';
import {sampleProof} from './frame-proof';
import type {SampleProof} from './frame-proof';
import {dimensions} from '../presentation';

async function encodePng(canvas:HTMLCanvasElement,frame:number,check:boolean){
  const proof=check?sampleProof(canvas,frame):undefined;
  // Compare lossless PNG pixels at native resolution. Downsampling a canvas and
  // an ImageBitmap can use different browser interpolation at translucent edges.
  const original=check?canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data:undefined;
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('Impossible de créer une image PNG.')),'image/png'));
  const bytes=new Uint8Array(await blob.arrayBuffer()),view=new DataView(bytes.buffer);
  if(bytes.length<33||view.getUint32(0)!==0x89504e47||view.getUint32(4)!==0x0d0a1a0a||view.getUint32(12)!==0x49484452||view.getUint32(16)!==canvas.width||view.getUint32(20)!==canvas.height||bytes[24]!==8||bytes[25]!==6)throw Error('PNG invalide : dimensions ou canal RGBA incorrects.');
  if(proof){
    const bitmap=await createImageBitmap(blob);
    try{
      if(bitmap.width!==canvas.width||bitmap.height!==canvas.height)throw Error('Dimensions PNG incorrectes.');
      const readback=document.createElement('canvas');readback.width=bitmap.width;readback.height=bitmap.height;
      try{
        const context=readback.getContext('2d',{willReadFrequently:true})!;context.drawImage(bitmap,0,0);
        const decoded=context.getImageData(0,0,bitmap.width,bitmap.height).data;
        for(let i=0;i<original!.length;i+=4){
          if(decoded[i+3]!==original![i+3])throw Error(`La transparence PNG diffère du rendu (image ${frame+1}).`);
          if(original![i+3]===255)for(let c=0;c<3;c++)if(Math.abs(decoded[i+c]-original![i+c])>1)throw Error('Les couleurs PNG diffèrent du rendu.');
        }
      }finally{readback.width=readback.height=0;}
    }finally{bitmap.close();}
  }
  return {bytes,proof};
}
export async function exportPngSequence(template:BroadcastTemplate,data:ProjectData,options:VideoOptions,signal:AbortSignal,progress:(p:VideoProgress)=>void,inspect?:(blob:Blob,proofs:SampleProof[])=>Promise<void>){
  signal.throwIfAborted();progress({percent:0,message:'Préparation des images PNG transparentes…'});
  const prepared=await prepareGraphic(template,data,options.manualOut,options.removeBackground,signal);
  let archive:ReturnType<typeof sequenceArchive>|undefined,handedOff=false;
  try{
    const {timeline}=prepared,{width,height}=dimensions(data);
    const mixed=options.audio?await mixAudio(audioEvents(prepared,template.id,options.removeBackground),timeline.duration,signal,message=>progress({percent:3,message})):undefined;
    archive=sequenceArchive(await sequenceDestination(signal),signal);
    const checkFrames=[...new Set([0,Math.min(timeline.frames-1,Math.ceil(timeline.timing.entry*25)+10),Math.round(timeline.outAt*25),timeline.frames-1])];
    const proofs:SampleProof[]=[],started=performance.now();
    for(let frame=0;frame<timeline.frames;frame++){
      signal.throwIfAborted();
      const canvas=await prepared.frame(frame,null),png=await encodePng(canvas,frame,checkFrames.includes(frame));
      signal.throwIfAborted();if(png.proof)proofs.push(png.proof);await archive.add(frameFilename(frame),[png.bytes]);
      if(frame===24&&archive.bytes()/25*timeline.frames>SEQUENCE_BYTE_LIMIT*.98)throw Error('La séquence PNG estimée dépasse 3 Gio. Réduisez la durée avant de relancer l’export.');
      if(frame%5===0||frame===timeline.frames-1){
        const remaining=(performance.now()-started)/1000/(frame+1)*(timeline.frames-frame-1);
        progress({percent:Math.round(5+(frame+1)/timeline.frames*83),message:`PNG ${frame+1} / ${timeline.frames}${frame>=25?` · environ ${Math.max(1,Math.ceil(remaining))} s restantes`:''}`});
        await new Promise(resolve=>setTimeout(resolve,0));
      }
    }
    if(mixed){progress({percent:89,message:'Écriture du son WAV 48 kHz / 24 bits…'});await archive.add('audio.wav',pcm24Wav(mixed.buffer));}
    const manifest={format:'srtb-png-sequence',version:1,template:{id:template.id,version:template.version,library:template.libraryVersion},width,height,fps:25,frames:timeline.frames,duration:timeline.duration,outAt:timeline.outAt,firstFrame:1,pattern:'images/image_%06d.png',pixelFormat:'RGBA8',alpha:'straight',colourSpace:'sRGB',audio:mixed?{path:'audio.wav',sampleRate:48000,channels:2,bitsPerSample:24,samples:mixed.buffer.length,startSeconds:0}:null,files:archive.inventory()};
    await archive.text('SEQUENCE.json',JSON.stringify(manifest,null,2));
    await archive.text('LIRE-MOI.txt',`SRTB Graphics — séquence PNG avec canal alpha\r\n\r\n1. Décompressez entièrement ce ZIP.\r\n2. Dans votre logiciel de montage ou de diffusion, importez images/image_000001.png comme SÉQUENCE D’IMAGES (pas comme une image fixe).\r\n3. Réglez la cadence sur 25 images/seconde et l’alpha sur DROIT / NON PRÉMULTIPLIÉ (straight).\r\n4. ${mixed?'Ajoutez audio.wav au début de la séquence, sans décalage. Son PCM stéréo 48 kHz / 24 bits.':'Cet export ne contient pas de son.'}\r\n\r\n${width} × ${height} — ${timeline.frames} images — ${timeline.duration.toFixed(2)} secondes, animation OUT complète incluse.\r\nLes zones transparentes restent transparentes ; les aplats et médias conservés dans le modèle restent visibles.\r\nSEQUENCE.json contient la cadence, les durées et les empreintes SHA-256.\r\nCe ZIP contient des PNG, pas une vidéo MOV. Un logiciel acceptant les séquences PNG est nécessaire.\r\n`);
    let last=-1;
    const blob=await archive.finish(fraction=>{const percent=92+Math.floor(fraction*7);if(percent!==last){last=percent;progress({percent,message:'Relecture du ZIP et contrôle de chaque fichier…'});}});
    const report:VideoReport={format:'png',width,height,fps:25,frames:timeline.frames,duration:timeline.duration,audio:!!mixed,audioPeak:mixed?.peak??0,alpha:true,bytes:blob.size,checkedFrames:checkFrames};
    if(inspect)await inspect(blob,proofs);signal.throwIfAborted();
    progress({percent:100,message:'Séquence PNG calculée et contrôlée.'});handedOff=true;
    return {blob,report,dispose:archive.dispose};
  }finally{try{await prepared.dispose();}finally{if(!handedOff)await archive?.dispose();}}
}
