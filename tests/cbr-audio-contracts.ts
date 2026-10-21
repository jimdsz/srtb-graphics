import {ALL_FORMATS,AudioBufferSink,BlobSource,EncodedPacketSink,Input} from 'mediabunny';
import {getTemplate,templateDefaults} from '../src/studio/domain';
import {enforceOpaqueCbr} from '../src/studio/video/cbr-fallback';
import {exportBroadcastVideo} from '../src/studio/video/export';

type Save=(name:string,body:Blob|string)=>Promise<void>;
type PacketRecord={timestamp:number;duration:number;bytes:number;sha256:string};
type Probe={label:string;seconds:number;rms:number;peak:number;samples:number};
type AudioProof={codec:string|null;sampleRate:number;channels:number;duration:number;packetCount:number;packetChainSha256:string;packets:PacketRecord[];rms:number;peak:number;probes:Probe[]};

const hex=(bytes:ArrayBuffer)=>[...new Uint8Array(bytes)].map(value=>value.toString(16).padStart(2,'0')).join('');
const sha256=async(bytes:BufferSource)=>hex(await crypto.subtle.digest('SHA-256',bytes));
const close=(a:number,b:number,tolerance=1e-6)=>Math.abs(a-b)<=tolerance;
function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}

async function audioProof(blob:Blob,positions:{label:string;seconds:number}[],signal:AbortSignal):Promise<AudioProof>{
  signal.throwIfAborted();const input=new Input({formats:ALL_FORMATS,source:new BlobSource(blob)}),track=await input.getPrimaryAudioTrack();
  if(!track){input.dispose();throw Error('Qualification CBR audio : piste absente.');}
  try{
    const [codec,sampleRate,channels,duration]=await Promise.all([track.getCodec(),track.getSampleRate(),track.getNumberOfChannels(),track.computeDuration()]),packets:PacketRecord[]=[];
    for await(const packet of new EncodedPacketSink(track).packets()){
      signal.throwIfAborted();const data=packet.data.slice() as Uint8Array<ArrayBuffer>;
      packets.push({timestamp:packet.timestamp,duration:packet.duration,bytes:packet.byteLength,sha256:await sha256(data)});
    }
    const packetChainSha256=await sha256(new TextEncoder().encode(JSON.stringify(packets)) as Uint8Array<ArrayBuffer>),acc=positions.map(position=>({...position,sum:0,peak:0,samples:0}));let sum=0,peak=0,samples=0;
    for await(const {buffer,timestamp} of new AudioBufferSink(track).buffers()){
      signal.throwIfAborted();
      for(let channel=0;channel<buffer.numberOfChannels;channel++){
        const data=buffer.getChannelData(channel);for(const value of data){sum+=value*value;peak=Math.max(peak,Math.abs(value));samples++;}
        for(const item of acc){const from=Math.max(0,Math.floor((item.seconds-.1-timestamp)*buffer.sampleRate)),to=Math.min(data.length,Math.ceil((item.seconds+.1-timestamp)*buffer.sampleRate));for(let index=from;index<to;index++){const value=data[index];item.sum+=value*value;item.peak=Math.max(item.peak,Math.abs(value));item.samples++;}}
      }
    }
    return {codec,sampleRate,channels,duration,packetCount:packets.length,packetChainSha256,packets,rms:samples?Math.sqrt(sum/samples):0,peak,probes:acc.map(({label,seconds,sum:probeSum,peak:probePeak,samples:probeSamples})=>({label,seconds,rms:probeSamples?Math.sqrt(probeSum/probeSamples):0,peak:probePeak,samples:probeSamples}))};
  }finally{input.dispose();}
}

const proofSummary=(proof:AudioProof)=>({codec:proof.codec,sampleRate:proof.sampleRate,channels:proof.channels,duration:proof.duration,packetCount:proof.packetCount,packetChainSha256:proof.packetChainSha256,packetHashes:{first:proof.packets[0]?.sha256,middle:proof.packets[Math.floor(proof.packets.length/2)]?.sha256,last:proof.packets.at(-1)?.sha256},rms:proof.rms,peak:proof.peak,probes:proof.probes});

async function temporaryEntries(){
  const root=await navigator.storage.getDirectory();let directory:FileSystemDirectoryHandle;
  try{directory=await root.getDirectoryHandle('srtb-temporary-exports');}catch{return [] as string[];}
  const names:string[]=[];for await(const [name]of (directory as any).entries())names.push(name);return names.sort();
}

async function cancelledFallback(nativeBlob:Blob,mode:'loading'|'segment',baseline:string[],status:(text:string)=>void){
  const controller=new AbortController();let observed='',result:Awaited<ReturnType<typeof enforceOpaqueCbr>>|undefined,rejected=false;
  try{
    result=await enforceOpaqueCbr(nativeBlob,controller.signal,event=>{
      observed=event.message;status(`Annulation CBR ${mode} · ${event.message}`);
      if(mode==='loading'&&/Chargement/.test(event.message)||mode==='segment'&&event.segment===2)controller.abort(new DOMException(`Qualification annulation ${mode}.`,'AbortError'));
    });
  }catch{rejected=controller.signal.aborted;}finally{await result?.dispose();}
  assert(rejected,`L’annulation CBR ${mode} n’a pas interrompu le traitement (${observed}).`);await new Promise(resolve=>setTimeout(resolve,0));
  const remaining=await temporaryEntries();assert(JSON.stringify(remaining)===JSON.stringify(baseline),`Fichier OPFS résiduel après annulation ${mode} : ${JSON.stringify({baseline,remaining})}`);
  return {mode,observed,temporaryEntries:remaining};
}

export async function cbrAudioContracts(save:Save,status:(text:string)=>void,signal:AbortSignal){
  const stamp=Date.now(),template=getTemplate('BTV_BA_1P'),manualOut=7.6,expectedDuration=manualOut+8.12,data={...templateDefaults(template),_studio_format:'tv',_out_mode:'duration',_out_duration_seconds:manualOut,_media_body_audio_enabled:false,_audio_bed_enabled:true,_audio_voice_enabled:true};
  let nativeBlob:Blob|undefined,nativeAudio:AudioProof|undefined,finalAudio:AudioProof|undefined,result:Awaited<ReturnType<typeof exportBroadcastVideo>>|undefined;
  const positions=[{label:'début réel',seconds:.5},{label:'voix intro',seconds:2.5},{label:'maintien réel',seconds:manualOut-.5},{label:'voix sortie',seconds:manualOut+4.2}],endPosition={label:'fin réelle',seconds:expectedDuration-.5};
  try{
    result=await exportBroadcastVideo(template,data,{format:'mp4',manualOut,removeBackground:false,audio:true,background:'#000000'},signal,p=>status(`CBR audio · ${p.percent}% · ${p.message}`),async blob=>{finalAudio=await audioProof(blob,[...positions,endPosition],signal);},async blob=>{
      nativeBlob=new Blob([await blob.arrayBuffer()],{type:'video/mp4'});nativeAudio=await audioProof(nativeBlob,[...positions,endPosition],signal);
    });
    assert(nativeBlob&&nativeAudio&&finalAudio,'Les preuves audio native et finale n’ont pas été produites.');assert(result.report.bitrateFallback==='ffmpeg-x264-cbr','Le repli CBR local n’a pas été exercé.');assert((result.report.cbrSegments??0)>=3,'Le fichier audio n’a pas traversé trois segments CBR.');
    assert(close(result.report.duration,expectedDuration,.001),'La timeline BA de qualification n’a pas la durée attendue.');assert(nativeAudio.sampleRate===48_000&&finalAudio.sampleRate===48_000,'Le son final n’est pas à 48 kHz.');assert(nativeAudio.channels===2&&finalAudio.channels===2,'Le son final n’est pas stéréo.');assert(close(nativeAudio.duration,finalAudio.duration,1/48_000),'La durée audio a changé pendant le repli.');assert(close(finalAudio.duration,result.report.duration,.1),'La durée audio finale est désynchronisée de la vidéo.');
    assert(nativeAudio.packetCount===finalAudio.packetCount,'Le nombre de paquets AAC a changé.');assert(nativeAudio.packetChainSha256===finalAudio.packetChainSha256,'Les paquets AAC ou leurs timestamps ont changé pendant le repli CBR.');
    assert(close(nativeAudio.rms,finalAudio.rms,1e-9),'Le RMS audio a changé malgré la copie bitstream.');for(const probe of finalAudio.probes)assert(probe.samples>0&&probe.rms>1e-6,`Signal audio absent à ${probe.label} (${probe.seconds.toFixed(2)} s).`);
    const filename=`cbr-audio-${stamp}.mp4`,videoReport=result.report;await save(filename,result.blob);await result.dispose();result=undefined;
    const baseline=await temporaryEntries(),cancellations=[await cancelledFallback(nativeBlob,'loading',baseline,status),await cancelledFallback(nativeBlob,'segment',baseline,status)];
    const report={result:'PASS',file:filename,video:videoReport,native:proofSummary(nativeAudio),final:proofSummary(finalAudio),bitstreamIdentical:true,cancellations,temporaryBaseline:baseline,shortClipPolicy:{underOneSecond:'moyenne globale contrôlée ; aucune fenêtre complète annoncée',partialTail:'queue partielle exclue du minimum ; fenêtres complètes seulement',perFramePromise:false}};
    await save(`cbr-audio-${stamp}.json`,JSON.stringify(report,null,2));return report;
  }finally{await result?.dispose();}
}
