// PNG is lossless RGBA; the optional sound is a separate, sample-aligned PCM file.
export function frameFilename(index:number){
  if(!Number.isInteger(index)||index<0||index>=15000)throw Error('Numéro d’image invalide.');
  return `images/image_${String(index+1).padStart(6,'0')}.png`;
}
export interface PcmBuffer {length:number;sampleRate:number;numberOfChannels:number;getChannelData(channel:number):Float32Array}
export function* pcm24Wav(buffer:PcmBuffer):Generator<Uint8Array<ArrayBuffer>>{
  const {length,sampleRate,numberOfChannels}=buffer;
  if(sampleRate!==48000||numberOfChannels!==2||!Number.isInteger(length)||length<=0||length>600*48000)throw Error('Format du mixage WAV invalide.');
  const header=new Uint8Array(44),v=new DataView(header.buffer),bytes=length*6;
  const text=(at:number,value:string)=>{for(let i=0;i<value.length;i++)header[at+i]=value.charCodeAt(i);};
  text(0,'RIFF');v.setUint32(4,36+bytes,true);text(8,'WAVE');text(12,'fmt ');v.setUint32(16,16,true);
  v.setUint16(20,1,true);v.setUint16(22,2,true);v.setUint32(24,48000,true);v.setUint32(28,288000,true);
  v.setUint16(32,6,true);v.setUint16(34,24,true);text(36,'data');v.setUint32(40,bytes,true);yield header;
  const channels=[buffer.getChannelData(0),buffer.getChannelData(1)];
  for(let at=0;at<length;at+=16384){
    const count=Math.min(16384,length-at),chunk=new Uint8Array(count*6);let offset=0;
    for(let i=0;i<count;i++)for(const channel of channels){
      const value=channel[at+i];if(!Number.isFinite(value))throw Error('Échantillon audio invalide.');
      const integer=Math.max(-8388608,Math.min(8388607,Math.round(value*8388608)));
      chunk[offset++]=integer&255;chunk[offset++]=(integer>>8)&255;chunk[offset++]=(integer>>16)&255;
    }
    yield chunk;
  }
}
