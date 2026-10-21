import {ALL_FORMATS,BlobSource,BufferTarget,EncodedAudioPacketSource,EncodedPacketSink,EncodedVideoPacketSource,Input,Mp4OutputFormat,Output,StreamTarget} from 'mediabunny';
import type {EncodedPacket,InputAudioTrack,InputVideoTrack,VideoCodec} from 'mediabunny';
import {OPAQUE_BITRATE,assertOpaqueMeasuredBitrate} from './encoding-policy.ts';
import {measureVideoBitrates} from './video-bitrate';
import type {VideoBitrateMeasurement} from './video-bitrate';
export {minimumCompleteWindowBitrate,measureVideoBitrates,BITRATE_WINDOW_SECONDS,BITRATE_WINDOW_BOUNDARY_TOLERANCE_SECONDS} from './video-bitrate';

export const CBR_SEGMENT_TARGET_SECONDS=5;
export const CBR_SEGMENT_LIMIT_SECONDS=6.25;

export interface CbrFallbackProgress{segment:number;message:string}
export interface CbrFallbackResult{blob:Blob;dispose:()=>Promise<void>;segments:number;codec:string;bitrate:VideoBitrateMeasurement}

export function ffmpegCbrArguments(){
  return ['-c:v','libx264','-preset','ultrafast','-b:v','50M','-minrate','50M','-maxrate','50M','-bufsize','50M','-x264-params','nal-hrd=cbr:filler=1','-pix_fmt','yuv420p'] as const;
}
export function shouldStartCbrSegment(elapsed:number,isKey:boolean){return isKey&&elapsed>=CBR_SEGMENT_TARGET_SECONDS;}

async function opfsDestination(signal:AbortSignal){
  const root=await(await navigator.storage.getDirectory()).getDirectoryHandle('srtb-temporary-exports',{create:true});
  const name=`${crypto.randomUUID()}.cbr.partial`,handle=await root.getFileHandle(name,{create:true}),writable=await handle.createWritable();let closed=false;
  const target=new StreamTarget(new WritableStream({async write({position,data}){signal.throwIfAborted();await writable.write({type:'write',position,data});}}),{chunked:true,chunkSize:1024**2});
  return {target,async finish(){await writable.close();closed=true;return new Blob([await handle.getFile()],{type:'video/mp4'});},async dispose(){if(!closed)await writable.abort().catch(()=>{});await root.removeEntry(name).catch(()=>{});}};
}

function workerClient(signal:AbortSignal,onProgress:(phase:string)=>void){
  const worker=new Worker(new URL('./cbr-fallback.worker.ts',import.meta.url),{type:'module'});let nextId=0,ended=false;
  const abort=()=>{ended=true;worker.terminate();};signal.addEventListener('abort',abort,{once:true});
  return {
    async encode(buffer:ArrayBuffer){
      signal.throwIfAborted();const id=++nextId;
      return new Promise<Uint8Array<ArrayBuffer>>((resolve,reject)=>{
        const cleanup=()=>{worker.removeEventListener('message',message);worker.removeEventListener('error',error);signal.removeEventListener('abort',cancel);};
        const cancel=()=>{cleanup();reject(signal.reason instanceof Error?signal.reason:new DOMException('Rendu annulé.','AbortError'));};
        const message=({data}:{data:{id:number;bytes?:ArrayBuffer;error?:string;progress?:string}})=>{
          if(data.id!==id)return;if(data.progress){onProgress(data.progress);return;}cleanup();
          if(data.error)reject(Error(data.error));else if(data.bytes)resolve(new Uint8Array(data.bytes));else reject(Error('Réponse FFmpeg locale incomplète.'));
        };
        const error=(event:ErrorEvent)=>{cleanup();reject(Error(event.message||'Worker FFmpeg local interrompu.'));};
        worker.addEventListener('message',message);worker.addEventListener('error',error,{once:true});signal.addEventListener('abort',cancel,{once:true});
        if(ended){cleanup();reject(signal.reason);return;}worker.postMessage({id,bytes:buffer},[buffer]);
      });
    },
    close(){signal.removeEventListener('abort',abort);worker.terminate();},
  };
}

async function segmentBuffer(packets:EncodedPacket[],track:InputVideoTrack,codec:VideoCodec,decoderConfig:VideoDecoderConfig){
  if(!packets.length||packets[0].type!=='key')throw Error('Découpage CBR impossible : le segment ne commence pas sur une image clé.');
  const target=new BufferTarget(),output=new Output({format:new Mp4OutputFormat({fastStart:false}),target}),source=new EncodedVideoPacketSource(codec),base=packets[0].timestamp;
  output.addVideoTrack(source,{frameRate:25,decoderConfig,rotation:await track.getRotation()});await output.start();
  try{
    for(let index=0;index<packets.length;index++)await source.add(packets[index].clone({timestamp:packets[index].timestamp-base,sequenceNumber:index}),index?undefined:{decoderConfig});
    source.close();await output.finalize();if(!target.buffer)throw Error('Segment MP4 natif non finalisé.');return target.buffer;
  }finally{source.close();if(output.state!=='finalized')await output.cancel().catch(()=>{});}
}

async function* nativeSegments(track:InputVideoTrack,signal:AbortSignal){
  const sink=new EncodedPacketSink(track);let packets:EncodedPacket[]=[],start=0,index=0;
  for await(const packet of sink.packets(undefined,undefined,{verifyKeyPackets:true})){
    signal.throwIfAborted();
    if(!packets.length){if(packet.type!=='key')throw Error('Le MP4 natif ne commence pas sur une image clé.');start=packet.timestamp;}
    const elapsed=packet.timestamp-start;
    if(shouldStartCbrSegment(elapsed,packet.type==='key')){yield {index:index++,packets};packets=[];start=packet.timestamp;}
    else if(elapsed>CBR_SEGMENT_LIMIT_SECONDS)throw Error('Le navigateur n’a pas produit d’image clé assez souvent pour le repli CBR borné en mémoire.');
    packets.push(packet);
  }
  if(packets.length)yield {index,packets};
}

async function copyAudio(track:InputAudioTrack,source:EncodedAudioPacketSource,signal:AbortSignal){
  const sink=new EncodedPacketSink(track),decoderConfig=await track.getDecoderConfig();let first=true;
  for await(const packet of sink.packets()){signal.throwIfAborted();await source.add(packet,first?{decoderConfig:decoderConfig??undefined}:undefined);first=false;}
  source.close();
}


export async function enforceOpaqueCbr(blob:Blob,signal:AbortSignal,progress:(event:CbrFallbackProgress)=>void):Promise<CbrFallbackResult>{
  signal.throwIfAborted();
  const input=new Input({formats:ALL_FORMATS,source:new BlobSource(blob)}),video=await input.getPrimaryVideoTrack(),audio=await input.getPrimaryAudioTrack();
  if(!video){input.dispose();throw Error('Repli CBR impossible : piste vidéo absente.');}
  const [codec,decoderConfig]=await Promise.all([video.getCodec(),video.getDecoderConfig()]);
  if(!codec||!decoderConfig){input.dispose();throw Error('Repli CBR impossible : configuration H.264 native absente.');}
  const worker=workerClient(signal,phase=>progress({segment:0,message:phase==='loading'?'Chargement du moteur CBR local…':'Encodage CBR local…'}));
  let destination:Awaited<ReturnType<typeof opfsDestination>>|undefined,output:Output|undefined,videoSource:EncodedVideoPacketSource|undefined,audioSource:EncodedAudioPacketSource|undefined,outputCodec:VideoCodec|undefined,segments=0,frameOffset=0,handedOff=false;
  try{
    for await(const segment of nativeSegments(video,signal)){
      const native=await segmentBuffer(segment.packets,video,codec,decoderConfig);progress({segment:segment.index+1,message:`Renforcement CBR du segment ${segment.index+1}…`});
      const encoded=await worker.encode(native),segmentInput=new Input({formats:ALL_FORMATS,source:new BlobSource(new Blob([encoded],{type:'video/mp4'}))});
      try{
        const segmentTrack=await segmentInput.getPrimaryVideoTrack();if(!segmentTrack)throw Error('Segment CBR sans piste vidéo.');
        const [segmentCodec,segmentConfig]=await Promise.all([segmentTrack.getCodec(),segmentTrack.getDecoderConfig()]);if(!segmentCodec||!segmentConfig)throw Error('Segment CBR sans configuration de décodage.');
        if(!output){
          destination=await opfsDestination(signal);output=new Output({format:new Mp4OutputFormat({fastStart:false}),target:destination.target});outputCodec=segmentCodec;videoSource=new EncodedVideoPacketSource(segmentCodec);
          output.addVideoTrack(videoSource,{frameRate:25,decoderConfig:segmentConfig,bitrate:OPAQUE_BITRATE,averageBitrate:OPAQUE_BITRATE});
          if(audio){const audioCodec=await audio.getCodec(),audioConfig=await audio.getDecoderConfig();if(!audioCodec||!audioConfig)throw Error('Copie de la piste audio impossible.');audioSource=new EncodedAudioPacketSource(audioCodec);output.addAudioTrack(audioSource,{decoderConfig:audioConfig});}
          await output.start();if(audio&&audioSource)await copyAudio(audio,audioSource,signal);
        }else if(videoSource&&segmentCodec!==outputCodec&&segments>0)throw Error('Le codec CBR a changé entre deux segments.');
        const sink=new EncodedPacketSink(segmentTrack);let firstTimestamp:number|undefined,localFrames=0;
        for await(const packet of sink.packets(undefined,undefined,{verifyKeyPackets:true})){
          signal.throwIfAborted();firstTimestamp??=packet.timestamp;await videoSource!.add(packet.clone({timestamp:frameOffset+packet.timestamp-firstTimestamp,sequenceNumber:Math.round(frameOffset*25)+localFrames}),localFrames?undefined:{decoderConfig:segmentConfig});localFrames++;
        }
        if(localFrames!==segment.packets.length)throw Error(`Le segment CBR ${segment.index+1} a changé de nombre d’images.`);
        frameOffset+=localFrames/25;segments++;
      }finally{segmentInput.dispose();}
    }
    if(!output||!videoSource||!destination)throw Error('Repli CBR vide.');
    videoSource.close();await output.finalize();signal.throwIfAborted();const resultBlob=await destination.finish(),bitrate=await measureVideoBitrates(resultBlob,signal);assertOpaqueMeasuredBitrate(bitrate.averageBitrate);if(bitrate.minimumOneSecondBitrate!==undefined)assertOpaqueMeasuredBitrate(bitrate.minimumOneSecondBitrate);handedOff=true;
    return {blob:resultBlob,dispose:destination.dispose,segments,codec:'avc/libx264',bitrate};
  }finally{
    worker.close();input.dispose();videoSource?.close();audioSource?.close();if(output&&output.state!=='finalized')await output.cancel().catch(()=>{});if(!handedOff)await destination?.dispose();
  }
}
