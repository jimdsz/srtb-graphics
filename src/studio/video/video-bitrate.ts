import {ALL_FORMATS,BlobSource,EncodedPacketSink,Input} from 'mediabunny';
import type {InputVideoTrack} from 'mediabunny';

export const BITRATE_WINDOW_SECONDS=1;
export const BITRATE_WINDOW_BOUNDARY_TOLERANCE_SECONDS=1/25+.001;
export interface VideoBitrateMeasurement{averageBitrate:number;minimumOneSecondBitrate?:number;oneSecondWindowCount:number}

export function minimumCompleteWindowBitrate(packets:Iterable<{timestamp:number;duration:number;byteLength:number}>,duration:number){
  const completeWindows=Math.floor(duration+BITRATE_WINDOW_BOUNDARY_TOLERANCE_SECONDS);
  if(completeWindows<1)return {minimumOneSecondBitrate:undefined,oneSecondWindowCount:0};
  const bytes=Array<number>(completeWindows).fill(0);
  for(const packet of packets){
    // Encoded packets are assigned by presentation timestamp. A one-frame tolerance
    // is used only to decide whether the final one-second interval is complete.
    const window=Math.floor(Math.max(0,packet.timestamp+1e-6)/BITRATE_WINDOW_SECONDS);
    if(window<completeWindows)bytes[window]+=packet.byteLength;
  }
  return {minimumOneSecondBitrate:Math.min(...bytes)*8/BITRATE_WINDOW_SECONDS,oneSecondWindowCount:completeWindows};
}

async function measureTrackVideoBitrates(track:InputVideoTrack,signal:AbortSignal):Promise<VideoBitrateMeasurement>{
  const [stats,duration]=await Promise.all([track.computePacketStats(),track.computeDuration()]),packets:{timestamp:number;duration:number;byteLength:number}[]=[];
  for await(const packet of new EncodedPacketSink(track).packets(undefined,undefined,{metadataOnly:true})){signal.throwIfAborted();packets.push(packet);}
  return {averageBitrate:stats.averageBitrate,...minimumCompleteWindowBitrate(packets,duration)};
}

export async function measureVideoBitrates(blob:Blob,signal:AbortSignal){
  signal.throwIfAborted();const input=new Input({formats:ALL_FORMATS,source:new BlobSource(blob)}),abort=()=>input.dispose();signal.addEventListener('abort',abort,{once:true});
  try{const track=await input.getPrimaryVideoTrack();if(!track)throw Error('Mesure du débit : piste vidéo absente.');return await measureTrackVideoBitrates(track,signal);}
  finally{signal.removeEventListener('abort',abort);input.dispose();}
}
