import {createHash} from 'node:crypto';

export const RATE=48000,FREQUENCIES=[400,500,600,700,800],VOICE_DURATION=3.6;
export const CAMPAIGN_EXPORTS={
  'mardi-tv':{frequency:400,fixture:'mardi',width:1920,height:1080},
  'demain-tv':{frequency:500,fixture:'demain',width:1920,height:1080},
  'aujourdhui-tv':{frequency:600,fixture:'aujourdhui',width:1920,height:1080},
  'aujourdhui-portrait':{frequency:600,fixture:'aujourdhui',width:1080,height:1350},
  'aujourdhui-vertical':{frequency:600,fixture:'aujourdhui',width:1080,height:1920},
  'ce-soir-tv':{frequency:700,fixture:'ce-soir',width:1920,height:1080},
  'tout-de-suite-tv':{frequency:800,fixture:'tout-de-suite',width:1920,height:1080},
  'popup-alpha':{alpha:true,width:1920,height:1080},
};

export function readSyntheticFixture(bytes,frequency){
  if(bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw Error('Fixture WAV RIFF attendue.');
  let fmt,pcm;
  for(let offset=12;offset+8<=bytes.length;){
    const size=bytes.readUInt32LE(offset+4),start=offset+8,end=start+size;
    if(end>bytes.length)throw Error('Chunk WAV tronqué.');
    const id=bytes.toString('ascii',offset,offset+4);
    if(id==='fmt ')fmt=bytes.subarray(start,end);
    if(id==='data')pcm=bytes.subarray(start,end);
    offset=end+(size%2);
  }
  if(!fmt||fmt.length<16||!pcm||fmt.readUInt16LE(0)!==1||fmt.readUInt16LE(2)!==2||fmt.readUInt32LE(4)!==RATE||fmt.readUInt16LE(14)!==16||pcm.length!==RATE*VOICE_DURATION*4)throw Error('Fixture attendue : PCM16 stéréo48k, exactement3,6s.');
  const samples=new Float64Array(pcm.length/4);
  for(let frame=0;frame<samples.length;frame++){
    const time=frame/RATE,envelope=time<.04||time>VOICE_DURATION-.04?.4:.12;
    const expected=Math.round(envelope*Math.sin(2*Math.PI*frequency*time)*32767),left=pcm.readInt16LE(frame*4),right=pcm.readInt16LE(frame*4+2);
    if(left!==expected||right!==-expected)throw Error(`Fixture différente du signal synthétique attendu à l’échantillon${frame}.`);
    samples[frame]=left/32768;
  }
  return samples;
}

export function stereoFloat32(bytes){
  if(bytes.length%8)throw Error('PCM float32 stéréo incomplet.');
  const frames=bytes.length/8,left=new Float64Array(frames),right=new Float64Array(frames),side=new Float64Array(frames),mid=new Float64Array(frames);
  for(let n=0;n<frames;n++){
    const l=bytes.readFloatLE(n*8),r=bytes.readFloatLE(n*8+4);
    if(!Number.isFinite(l)||!Number.isFinite(r))throw Error('PCM non fini.');
    left[n]=l;right[n]=r;side[n]=(l-r)/2;mid[n]=(l+r)/2;
  }
  return {left,right,side,mid};
}

export function tone(samples,start,end,frequency,rate=RATE){
  const from=Math.round(start*rate),to=Math.round(end*rate),length=to-from;
  if(from<0||to>samples.length||length<=0)throw Error('Fenêtre PCM hors limites.');
  let sin=0,cos=0,squares=0;
  for(let n=0;n<length;n++){
    const value=samples[from+n],angle=2*Math.PI*frequency*n/rate;
    sin+=value*Math.sin(angle);cos+=value*Math.cos(angle);squares+=value*value;
  }
  sin*=2/length;cos*=2/length;
  return {amplitude:Math.hypot(sin,cos),phaseRadians:Math.atan2(cos,sin),rms:Math.sqrt(squares/length)};
}
const dbRatio=(a,b)=>20*Math.log10(Math.max(a,1e-12)/Math.max(b,1e-12));
const quantile=(values,fraction)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.floor(sorted.length*fraction))];};

export function voiceWindow(pcm,start,end,expectedFrequency){
  const spectrum=FREQUENCIES.map(frequency=>({frequency,...tone(pcm.side,start,end,frequency)}));
  const expected=spectrum.find(item=>item.frequency===expectedFrequency),ranked=[...spectrum].sort((a,b)=>b.amplitude-a.amplitude),other=spectrum.filter(item=>item!==expected).sort((a,b)=>b.amplitude-a.amplitude)[0];
  const left=tone(pcm.left,start,end,expectedFrequency),right=tone(pcm.right,start,end,expectedFrequency),mid=tone(pcm.mid,start,end,expectedFrequency);
  const phase=left.phaseRadians-right.phaseRadians;
  return {start,end,sideRms:expected.rms,midRms:mid.rms,expectedAmplitude:expected.amplitude,winnerHz:ranked[0].amplitude===0?null:ranked[0].frequency,strongestOtherHz:other.frequency,expectedVsOtherDb:dbRatio(expected.amplitude,other.amplitude),sideVsMidDb:dbRatio(expected.amplitude,mid.amplitude),leftAmplitude:left.amplitude,rightAmplitude:right.amplitude,leftRightPhaseDegrees:Math.atan2(Math.sin(phase),Math.cos(phase))*180/Math.PI,amplitudes:Object.fromEntries(spectrum.map(item=>[item.frequency,item.amplitude]))};
}

export function analyzeVoice(pcm,fixture,frequency){
  const insertions=[.76,15.68].map(start=>{
    const bins=Array.from({length:360},(_,index)=>{
      const at=start+index*.01,measure=voiceWindow(pcm,at,at+.01,frequency),reference=tone(fixture,index*.01,(index+1)*.01,frequency).amplitude;
      return {...measure,sourceAmplitude:reference,sourceGain:measure.expectedAmplitude/reference};
    });
    const stableWindows=[[.08,.28],[1.7,1.9],[3.32,3.52]].map(([from,to])=>voiceWindow(pcm,start+from,start+to,frequency));
    const preTerminal=voiceWindow(pcm,start+3.5,start+3.54,frequency),terminal=voiceWindow(pcm,start+3.57,start+3.59,frequency);
    return {start,end:start+VOICE_DURATION,head10ms:bins.slice(0,8),tail10ms:bins.slice(-4),stableWindows,
      terminalMarker:{preTerminal,terminal,amplitudeIncreaseDb:dbRatio(terminal.expectedAmplitude,preTerminal.expectedAmplitude),fixtureIdealIncreaseDb:20*Math.log10(.4/.12)},
      guardBefore:voiceWindow(pcm,start-.04,start-.02,frequency),guardAfter:voiceWindow(pcm,start+VOICE_DURATION+.02,start+VOICE_DURATION+.04,frequency),
      wholePassage:{bins10ms:bins.length,expectedWins:bins.filter(bin=>bin.winnerHz===frequency).length,winnerHistogram:Object.fromEntries(FREQUENCIES.map(hz=>[hz,bins.filter(bin=>bin.winnerHz===hz).length])),gainMin:Math.min(...bins.map(bin=>bin.sourceGain)),gainMedian:quantile(bins.map(bin=>bin.sourceGain),.5),expectedVsOtherDbP05:quantile(bins.map(bin=>bin.expectedVsOtherDb),.05),lowestExpectedBins:[...bins].sort((a,b)=>a.sourceGain-b.sourceGain).slice(0,8)}};
  });
  const nonVoiceWindows=[[.1,.3],[5,6],[10.5,11.5],[19.7,20]].map(([start,end])=>voiceWindow(pcm,start,end,frequency));
  return {expectedFrequency:frequency,insertions,nonVoiceWindows,note:'Mesures spectrales, pas un PASS automatique. Le fondu voix natif −191→0 dB sur 40 ms rend la tête très faible : aucun minimum de gain n’est exigé. Fenêtres de 10 ms : ne prouvent pas la conservation de chaque échantillon sous AAC. Le canal side annule seulement le contenu strictement commun aux deux canaux. Aucun recalage des insertions.'};
}

export function parseFrameHashes(text){
  const frames=[];
  for(const line of text.split(/\r?\n/)){
    if(!line.trim()||line.startsWith('#'))continue;
    const parts=line.split(',').map(value=>value.trim());
    if(parts.length!==6||!/^\d+$/.test(parts[0])||![1,2,3,4].every(index=>/^-?\d+$/.test(parts[index]))||Number(parts[3])<=0||Number(parts[4])<=0||! /^[a-f0-9]{64}$/i.test(parts[5]))throw Error('Sortie FFmpeg framehash inattendue.');
    frames.push({stream:Number(parts[0]),dts:Number(parts[1]),pts:Number(parts[2]),duration:Number(parts[3]),bytes:Number(parts[4]),sha256:parts[5].toLowerCase()});
  }
  if(!frames.length)throw Error('Aucune image décodée.');
  return frames;
}

export function analyzeAlphaHashes(frames,width,height){
  const expectedBytes=width*height*2,zeroHash=createHash('sha256').update(Buffer.alloc(expectedBytes)).digest('hex'),opaqueHash=createHash('sha256').update(Buffer.alloc(expectedBytes,255)).digest('hex');
  if(frames.some(frame=>frame.bytes!==expectedBytes))throw Error('Plan alpha gray16le de taille inattendue.');
  let transparentTail=0;
  for(let index=frames.length-1;index>=0&&frames[index].sha256===zeroHash;index--)transparentTail++;
  return {format:'gray16le',bytesPerFrame:expectedBytes,zeroHash,frames:frames.length,fullyTransparentFrames:frames.filter(frame=>frame.sha256===zeroHash).length,fullyOpaqueFrames:frames.filter(frame=>frame.sha256===opaqueHash).length,framesWithSomeAlpha:frames.filter(frame=>frame.sha256!==zeroHash).length,consecutiveTransparentTailFrames:transparentTail,lastFrameCompletelyTransparent:frames.at(-1).sha256===zeroHash,lastFiveFrames:frames.slice(-5)};
}
