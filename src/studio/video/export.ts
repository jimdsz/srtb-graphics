import {ALL_FORMATS,AudioBufferSink,AudioBufferSource,BlobSource,BufferTarget,CanvasSink,CanvasSource,Input,MovOutputFormat,Mp4OutputFormat,Output,Quality,StreamTarget,WebMOutputFormat,canEncodeAudio,canEncodeVideo} from 'mediabunny';
import type {VideoSampleSource} from 'mediabunny';
import type {BroadcastTemplate,ProjectData} from '../domain';
import {prepareGraphic} from './engine';
import {audioEvents,mixAudio} from './audio';
import {sampleProof} from './frame-proof';
import type {SampleProof} from './frame-proof';
import {dimensions} from '../presentation';
import {opaqueEncoding,assertOpaqueConfig,assertOpaqueMeasuredBitrate,needsOpaqueCbrFallback,opaqueMeasuredFloor,OPAQUE_BITRATE,OPAQUE_MINIMUM_MEASURED_BITRATE} from './encoding-policy';
import {enforceOpaqueCbr} from './cbr-fallback';
import {measureVideoBitrates} from './video-bitrate';
import {NATIVE_ONLY_EXPORT} from './release-profile';
import type {ExportProfile} from './export-profile';
export type VideoFormat='mp4'|'alpha'|'png'|'mov';
export const videoExtension=(format:VideoFormat)=>format==='png'?'_PNG.zip':format==='mp4'?'.mp4':format==='mov'?'.mov':'.webm';
export interface VideoOptions {format:VideoFormat;manualOut:number;removeBackground:boolean;audio:boolean;background:string}
export interface VideoProgress {percent:number;message:string}
export interface VideoReport {format:VideoFormat;width:number;height:number;fps:number;frames:number;duration:number;audio:boolean;audioPeak:number;alpha:boolean;bytes:number;checkedFrames:number[];videoBitrate?:number;minimumOneSecondVideoBitrate?:number;bitrateMeasurementWindows?:number;nativeVideoBitrate?:number;nativeMinimumOneSecondVideoBitrate?:number;targetVideoBitrate?:number;minimumVideoBitrate?:number;bitrateMode?:'constant';encoderCodec?:string;bitrateFallback?:'ffmpeg-x264-cbr';cbrSegments?:number;exportProfile?:'native-only';bitrateWarning?:string}
export async function videoSupport(width=1920,height=1080){
  if(!isSecureContext||typeof VideoEncoder==='undefined')return {mp4:false,alpha:false,aac:false,opus:false};
  const [mp4,alpha,aac,opus]=await Promise.all([
    canEncodeVideo('avc',{...opaqueEncoding(),width,height,frameRate:25}),canEncodeVideo('vp9',{width,height,frameRate:25,alpha:'keep'}),
    canEncodeAudio('aac',{sampleRate:48000,numberOfChannels:2}),canEncodeAudio('opus',{sampleRate:48000,numberOfChannels:2}),
  ].map(p=>p.catch(()=>false)));
  return {mp4,alpha,aac,opus};
}
async function destination(signal:AbortSignal){
  let root:FileSystemDirectoryHandle|undefined,name:string|undefined,file:FileSystemFileHandle|undefined,writable:FileSystemWritableFileStream|undefined;
  try{
    root=await(await navigator.storage.getDirectory()).getDirectoryHandle('srtb-temporary-exports',{create:true});
    name=crypto.randomUUID()+'.partial';file=await root.getFileHandle(name,{create:true});writable=await file.createWritable();
  }catch{if(root&&name)await root.removeEntry(name).catch(()=>{});root=undefined;name=undefined;file=undefined;}
  if(root&&name&&file&&writable){
    const stream=writable,handle=file,directory=root,key=name;let closed=false;
    const target=new StreamTarget(new WritableStream({async write({position,data}){signal.throwIfAborted();await stream.write({type:'write',position,data});}}),{chunked:true,chunkSize:1024**2});
    return {target,async finish(type:string){await stream.close();closed=true;const blob=await handle.getFile();return new Blob([blob],{type});},async dispose(){if(!closed)await stream.abort().catch(()=>{});await directory.removeEntry(key).catch(()=>{});}};
  }
  const target=new BufferTarget();
  target.on('write',({end})=>{signal.throwIfAborted();if(end>256*1024**2)throw Error('Stockage temporaire indisponible et limite mémoire atteinte. Utilisez Chrome/Edge en mode normal avec de l’espace disque.');});
  return {target,async finish(type:string){if(!target.buffer)throw Error('Fichier vidéo non finalisé.');return new Blob([target.buffer],{type});},async dispose(){target.buffer=null;}};
}
async function verify(blob:Blob,report:VideoReport,proofs:SampleProof[],signal:AbortSignal,expectedAudio?:AudioBuffer){
  const input=new Input({formats:ALL_FORMATS,source:new BlobSource(blob)}),abort=()=>input.dispose();signal.addEventListener('abort',abort,{once:true});
  try{
    const video=await input.getPrimaryVideoTrack();if(!video)throw Error('Contrôle final : piste vidéo absente.');
    const [w,h,seconds,stats]=await Promise.all([video.getDisplayWidth(),video.getDisplayHeight(),video.computeDuration(),video.computePacketStats()]);
    report.videoBitrate=stats.averageBitrate;
    if(w!==report.width||h!==report.height||Math.abs(seconds-report.duration)>.021||stats.packetCount!==report.frames)throw Error('Contrôle final : dimensions, durée ou nombre d’images incorrects.');
    if(report.alpha&&!await video.canBeTransparent())throw Error('Contrôle final : canal alpha perdu.');
    const sink=new CanvasSink(video,{alpha:true,poolSize:1});
    for(const proof of proofs){
      signal.throwIfAborted();const decoded=await sink.getCanvas(proof.frame/25);if(!decoded)throw Error('Contrôle final : une image est indécodable.');
      // Use exactly the same downsampling on both sides, not the decoder's
      // independently configured scaling/filtering path (especially at alpha edges).
      const pixels=sampleProof(decoded.canvas,proof.frame).rgb;let alphaError=0,rgbError=0,colours=0;
      for(let i=0;i<proof.alpha.length;i++){
        alphaError+=Math.abs(pixels[i*4+3]-proof.alpha[i]);
        if(proof.alpha[i]>(report.format==='mov'?50:240)){for(let c=0;c<3;c++){rgbError+=Math.abs(pixels[i*4+c]-proof.rgb[i*4+c]);colours++;}}
      }
      if(report.alpha&&alphaError/proof.alpha.length>6)throw Error('Contrôle final : transparence décodée différente du rendu.');
      if(colours&&rgbError/colours>22)throw Error(`Contrôle final : image ${proof.frame} différente du rendu (écart couleur ${(rgbError/colours).toFixed(2)}, alpha ${(alphaError/proof.alpha.length).toFixed(2)}).`);
    }
    if(report.audio){
      const audio=await input.getPrimaryAudioTrack();if(!audio||!await audio.canDecode())throw Error('Contrôle final : piste audio absente ou indécodable.');
      if(Math.abs(await audio.computeDuration()-report.duration)>.1)throw Error('Contrôle final : durée audio désynchronisée.');
      let decodedEnergy=0,decodedCount=0;
      for await(const {buffer} of new AudioBufferSink(audio).buffers()){
        signal.throwIfAborted();for(let c=0;c<buffer.numberOfChannels;c++){const samples=buffer.getChannelData(c);for(const value of samples)decodedEnergy+=value*value;decodedCount+=samples.length;}
      }
      if(!decodedCount)throw Error('Contrôle final : aucun échantillon sonore décodé.');
      if(expectedAudio){let expectedEnergy=0;for(let c=0;c<expectedAudio.numberOfChannels;c++)for(const value of expectedAudio.getChannelData(c))expectedEnergy+=value*value;
        const expectedRms=Math.sqrt(expectedEnergy/(expectedAudio.length*expectedAudio.numberOfChannels)),actualRms=Math.sqrt(decodedEnergy/decodedCount);
        if(Math.abs(expectedRms-actualRms)>Math.max(.003,expectedRms*.2))throw Error('Contrôle final : niveau sonore décodé différent du mixage.');
      }
    }
  }finally{signal.removeEventListener('abort',abort);input.dispose();}
}
export async function exportBroadcastVideo(template:BroadcastTemplate,data:ProjectData,options:VideoOptions,signal:AbortSignal,progress:(p:VideoProgress)=>void,inspect?:(blob:Blob,proofs:SampleProof[])=>Promise<void>,inspectNative?:(blob:Blob)=>Promise<void>,profile?:ExportProfile){
  if(options.format==='png')return (await import('./png-sequence')).exportPngSequence(template,data,options,signal,progress,inspect);
  if(options.format!=='mov'){
    const {width,height}=dimensions(data),support=await videoSupport(width,height);
    if(!support[options.format])throw Error('Encodage vidéo indisponible dans ce navigateur. Utilisez Chrome ou Edge récent sur ordinateur.');
    if(options.audio&&!(options.format==='mp4'?support.aac:support.opus))throw Error('Encodeur audio indisponible dans ce navigateur. Utilisez Chrome ou Edge récent sur ordinateur.');
  }
  signal.throwIfAborted();
  if(!/^#[\da-f]{6}$/i.test(options.background))throw Error('Couleur de fond invalide.');
  progress({percent:0,message:'Préparation des moteurs, médias et polices…'});
  const prepareStarted=profile?.now(),prepared=await prepareGraphic(template,data,options.manualOut,options.removeBackground,signal,profile);
  if(prepareStarted!==undefined)profile?.record('prepare',prepareStarted);
  let dest:Awaited<ReturnType<typeof destination>>|undefined,output:Output|undefined,video:CanvasSource|VideoSampleSource|undefined,audio:AudioBufferSource|undefined,fallbackDispose:(()=>Promise<void>)|undefined,handedOff=false;
  const cancel=()=>{if(output?.state==='started')void output.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
  try{
    const {timeline}=prepared;
    const mixStarted=profile?.now(),mixed=options.audio?await mixAudio(audioEvents(prepared,template.id,options.removeBackground),timeline.duration,signal,message=>progress({percent:3,message})):undefined;
    if(mixStarted!==undefined&&options.audio)profile?.record('audio.mix',mixStarted);
    const canvas=await prepared.frame(0,options.format==='mp4'?options.background:null);
    const destinationStarted=profile?.now();dest=await destination(signal);if(destinationStarted!==undefined)profile?.record('destination.open',destinationStarted);
    output=new Output({format:options.format==='mov'?new MovOutputFormat({fastStart:false}):options.format==='mp4'?new Mp4OutputFormat({fastStart:false}):new WebMOutputFormat(),target:dest.target});
    let addFrame:(frame:number)=>Promise<void>,encoderConfig:VideoEncoderConfig|undefined;
    if(options.format==='mov'){
      progress({percent:4,message:'Préparation de l’encodeur MOV sur votre ordinateur…'});
      const prores=await (await import('./prores')).proresSource(canvas);video=prores.source;addFrame=prores.add;
    }else{
      const source=new CanvasSource(canvas,options.format==='mp4'?opaqueEncoding(config=>{assertOpaqueConfig(config);encoderConfig=config;}):{codec:'vp9',quality:new Quality({bitrate:20_000_000}),alpha:'keep',keyFrameInterval:1});video=source;addFrame=frame=>source.add(frame/25,1/25);
    }
    signal.throwIfAborted();
    output.addVideoTrack(video,{frameRate:25});
    if(mixed){audio=new AudioBufferSource(options.format==='mov'?{codec:'pcm-s24'}:{codec:options.format==='mp4'?'aac':'opus',quality:new Quality({bitrate:192_000})});output.addAudioTrack(audio);}
    const encoderStarted=profile?.now();await output.start();if(encoderStarted!==undefined)profile?.record('encoder.start',encoderStarted);
    // Audio is small compared with video; adding it first bounds muxer buffering.
    if(audio&&mixed){const started=profile?.now();await audio.add(mixed.buffer);audio.close();if(started!==undefined)profile?.record('encoder.audio',started);}
    const checkFrames=[...new Set([0,Math.min(timeline.frames-1,Math.ceil(timeline.timing.entry*25)+10),Math.min(timeline.frames-1,Math.round(timeline.outAt*25)),timeline.frames-1])],proofs:SampleProof[]=[];
    const frameStarted=performance.now();
    for(let frame=0;frame<timeline.frames;frame++){
      signal.throwIfAborted();if(frame)await prepared.frame(frame,options.format==='mp4'?options.background:null);
      if(checkFrames.includes(frame)){const started=profile?.now();proofs.push(sampleProof(canvas,frame));if(started!==undefined)profile?.record('proof.sample',started);}
      const addStarted=profile?.now();await addFrame(frame);if(addStarted!==undefined)profile?.record('encoder.add',addStarted);
      if(frame%5===0){const elapsed=(performance.now()-frameStarted)/1000,remaining=elapsed/(frame+1)*(timeline.frames-frame-1),eta=frame>=25?` · environ ${Math.max(1,Math.ceil(remaining))} s restantes`:'';progress({percent:Math.round(5+frame/timeline.frames*87),message:`Image ${frame+1} / ${timeline.frames}${eta}`});const yielded=profile?.now();await new Promise(resolve=>setTimeout(resolve,0));if(yielded!==undefined)profile?.record('yield',yielded);}
    }
    profile?.endFrame();const finalizeStarted=profile?.now();video.close();await output.finalize();if(finalizeStarted!==undefined)profile?.record('encoder.finalize',finalizeStarted);signal.throwIfAborted();
    const finishStarted=profile?.now();let blob=await dest.finish(options.format==='mov'?'video/quicktime':options.format==='mp4'?'video/mp4':'video/webm');if(finishStarted!==undefined)profile?.record('destination.finish',finishStarted);
    const report:VideoReport={format:options.format,width:canvas.width,height:canvas.height,fps:25,frames:timeline.frames,duration:timeline.duration,audio:!!mixed,audioPeak:mixed?.peak??0,alpha:options.format!=='mp4',bytes:blob.size,checkedFrames:checkFrames};
    if(options.format==='mp4'){
      if(!encoderConfig)throw Error('Le profil de l’encodeur H.264 n’a pas pu être contrôlé.');
      report.targetVideoBitrate=OPAQUE_BITRATE;report.minimumVideoBitrate=OPAQUE_MINIMUM_MEASURED_BITRATE;report.bitrateMode='constant';report.encoderCodec=encoderConfig.codec;
      progress({percent:93,message:'Mesure du débit vidéo réellement produit…'});const bitrateStarted=profile?.now(),nativeBitrate=await measureVideoBitrates(blob,signal);if(bitrateStarted!==undefined)profile?.record('bitrate.native',bitrateStarted);report.nativeVideoBitrate=nativeBitrate.averageBitrate;report.nativeMinimumOneSecondVideoBitrate=nativeBitrate.minimumOneSecondBitrate;
      if(inspectNative)await inspectNative(blob);const nativeFloor=opaqueMeasuredFloor(nativeBitrate.averageBitrate,nativeBitrate.minimumOneSecondBitrate);
      if(!NATIVE_ONLY_EXPORT&&needsOpaqueCbrFallback(nativeFloor)){
        progress({percent:94,message:`Débit natif minimal ${(nativeFloor/1e6).toFixed(2)} Mb/s : renforcement CBR local…`});
        const hardened=await enforceOpaqueCbr(blob,signal,event=>progress({percent:Math.min(98,94+event.segment*.25),message:event.message}));fallbackDispose=hardened.dispose;
        await dest.dispose();dest=undefined;blob=hardened.blob;report.bytes=blob.size;report.videoBitrate=hardened.bitrate.averageBitrate;report.minimumOneSecondVideoBitrate=hardened.bitrate.minimumOneSecondBitrate;report.bitrateMeasurementWindows=hardened.bitrate.oneSecondWindowCount;report.encoderCodec=hardened.codec;report.bitrateFallback='ffmpeg-x264-cbr';report.cbrSegments=hardened.segments;
      }
    }
    if(inspect)await inspect(blob,proofs);
    progress({percent:99,message:'Relecture du fichier : images, durée, son et transparence…'});const verifyStarted=profile?.now();await verify(blob,report,proofs,signal,mixed?.buffer);if(verifyStarted!==undefined)profile?.record('verify',verifyStarted);
    if(options.format==='mp4'){
      const bitrateStarted=profile?.now(),finalBitrate=await measureVideoBitrates(blob,signal),floor=opaqueMeasuredFloor(finalBitrate.averageBitrate,finalBitrate.minimumOneSecondBitrate);if(bitrateStarted!==undefined)profile?.record('bitrate.final',bitrateStarted);
      report.videoBitrate=finalBitrate.averageBitrate;report.minimumOneSecondVideoBitrate=finalBitrate.minimumOneSecondBitrate;report.bitrateMeasurementWindows=finalBitrate.oneSecondWindowCount;
      if(NATIVE_ONLY_EXPORT){
        report.exportProfile='native-only';
        if(needsOpaqueCbrFallback(floor))report.bitrateWarning='Débit mesuré inférieur à 30 Mb/s. Cette édition native ne garantit pas ce plancher ; vérifiez les exigences de votre destination avant diffusion.';
      }else assertOpaqueMeasuredBitrate(floor);
    }
    signal.throwIfAborted();
    progress({percent:100,message:'Fichier calculé et contrôlé.'});handedOff=true;
    return {blob,report,dispose:fallbackDispose??dest!.dispose};
  }catch(error){if(output?.state!=='finalized')await output?.cancel().catch(()=>{});if(error instanceof DOMException&&error.name==='QuotaExceededError')throw Error('Espace disque insuffisant pour cet export. Libérez de l’espace ou raccourcissez le rendu. Aucun média source n’a été modifié.');throw error;}
  finally{signal.removeEventListener('abort',cancel);video?.close();audio?.close();try{await prepared.dispose();}finally{if(!handedOff){await dest?.dispose();await fallbackDispose?.();}}}
}
