import {ALL_FORMATS,BlobSource,BufferTarget,CanvasSink,CanvasSource,Input,Mp4OutputFormat,Output} from 'mediabunny';
import {opaqueEncoding,assertOpaqueConfig} from '../src/studio/video/encoding-policy';

export async function opaqueBitrateContracts(save:(name:string,body:Blob|string)=>Promise<void>,progress:(message:string)=>void,signal:AbortSignal){
  const records:unknown[]=[],stamp=Date.now();
  for(const [width,height,pattern]of [[1920,1080,'flat'],[1920,1080,'motion'],[1080,1920,'motion']] as const){
    signal.throwIfAborted();progress(`CBR · ${width} × ${height} · ${pattern}`);
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d')!;
    let config:VideoEncoderConfig|undefined;const target=new BufferTarget(),output=new Output({format:new Mp4OutputFormat(),target}),source=new CanvasSource(canvas,opaqueEncoding(c=>{assertOpaqueConfig(c);config=c;}));
    output.addVideoTrack(source,{frameRate:25});await output.start();
    try{
      for(let f=0;f<75;f++){
        signal.throwIfAborted();ctx.fillStyle='#111714';ctx.fillRect(0,0,width,height);
        if(pattern==='motion')for(let i=0;i<1800;i++){ctx.fillStyle=`hsl(${(i*113+f*11)%360} 60% 55%)`;ctx.fillRect((i*73+f*17)%width,(i*119+f*23)%height,29,29);}
        ctx.fillStyle='#f5c400';ctx.font='bold 72px sans-serif';ctx.fillText('SRTB · CONTRÔLE 50 Mb/s',50,150);await source.add(f/25,1/25);
      }
      source.close();await output.finalize();const blob=new Blob([target.buffer!],{type:'video/mp4'}),input=new Input({formats:ALL_FORMATS,source:new BlobSource(blob)});
      try{const track=await input.getPrimaryVideoTrack();if(!track)throw Error('Missing video');const stats=await track.computePacketStats();if(stats.packetCount!==75)throw Error('Dropped frames');
        const decoded=await new CanvasSink(track).getCanvas(1);if(!decoded)throw Error('Decode failed');
        const record={width,height,pattern,config,stats,bytes:blob.size};records.push(record);await save(`cbr-${width}-${pattern}-${stamp}.mp4`,blob);
      }finally{input.dispose();}
    }finally{source.close();if(output.state!=='finalized')await output.cancel();}
  }
  await save(`cbr-${stamp}.json`,JSON.stringify(records,null,2));return records;
}
