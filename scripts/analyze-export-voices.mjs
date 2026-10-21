import {spawnSync} from 'node:child_process';
import {readdirSync,statSync} from 'node:fs';
import {basename,extname,join} from 'node:path';

const [exportsDirectory,voicesDirectory,ffmpeg='C:/Program Files/PlayoutPilot/Components/casparcg/current/ffmpeg.exe']=process.argv.slice(2);
if(!exportsDirectory||!voicesDirectory)throw Error('Usage: node scripts/analyze-export-voices.mjs <exports> <voices> [ffmpeg]');

function decode(path,rate=8000){
  const result=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-i',path,'-map','0:a:0','-ac','1','-ar',String(rate),'-f','f32le','pipe:1'],{maxBuffer:64*1024*1024,windowsHide:true});
  if(result.status!==0)throw Error(`${basename(path)} : ${result.stderr.toString().trim()}`);
  return new Float32Array(result.stdout.buffer,result.stdout.byteOffset,result.stdout.byteLength/4).slice();
}

function envelope(samples,window=160){
  const out=new Float64Array(Math.ceil(samples.length/window));
  for(let i=0;i<out.length;i++){
    let energy=0;const end=Math.min(samples.length,(i+1)*window);
    for(let n=i*window;n<end;n++)energy+=samples[n]*samples[n];
    out[i]=Math.sqrt(energy/Math.max(1,end-i*window));
  }
  return out;
}

function centred(values){
  const mean=values.reduce((sum,value)=>sum+value,0)/Math.max(1,values.length);
  return Float64Array.from(values,value=>value-mean);
}

function bestCorrelation(haystack,needle){
  const pattern=centred(needle);let patternEnergy=0;for(const value of pattern)patternEnergy+=value*value;
  let best={score:-1,window:0};
  for(let offset=0;offset+pattern.length<=haystack.length;offset++){
    let mean=0;for(let n=0;n<pattern.length;n++)mean+=haystack[offset+n];mean/=pattern.length;
    let dot=0,energy=0;for(let n=0;n<pattern.length;n++){const value=haystack[offset+n]-mean;dot+=value*pattern[n];energy+=value*value;}
    const score=energy&&patternEnergy?dot/Math.sqrt(energy*patternEnergy):0;
    if(score>best.score)best={score,window:offset};
  }
  return {score:Number(best.score.toFixed(3)),seconds:Number((best.window*.02).toFixed(2))};
}

function edge(samples,rate=8000){
  const span=Math.min(samples.length,Math.round(rate*.5));
  const stats=(start,end)=>{
    let energy=0,peak=0,jump=0;
    for(let i=start;i<end;i++){const value=Math.abs(samples[i]);energy+=value*value;peak=Math.max(peak,value);if(i>start)jump=Math.max(jump,Math.abs(samples[i]-samples[i-1]));}
    return {rms:Number(Math.sqrt(energy/Math.max(1,end-start)).toFixed(5)),peak:Number(peak.toFixed(5)),maxJump:Number(jump.toFixed(5))};
  };
  return {start:stats(0,span),end:stats(samples.length-span,samples.length),first:Number((samples[0]||0).toFixed(6)),last:Number((samples.at(-1)||0).toFixed(6))};
}

const voiceFiles=readdirSync(voicesDirectory).map(name=>join(voicesDirectory,name)).filter(path=>statSync(path).isFile()&&['.mp3','.wav','.m4a','.aac'].includes(extname(path).toLowerCase()));
const voices=voiceFiles.map(path=>({name:basename(path),envelope:envelope(decode(path))}));
const exportFiles=readdirSync(exportsDirectory).map(name=>join(exportsDirectory,name)).filter(path=>statSync(path).isFile()&&extname(path).toLowerCase()==='.mp4');
const report=exportFiles.map(path=>{
  const samples=decode(path),shape=envelope(samples),matches=voices.map(voice=>({voice:voice.name,...bestCorrelation(shape,voice.envelope)})).sort((a,b)=>b.score-a.score).slice(0,4);
  return {file:basename(path),duration:Number((samples.length/8000).toFixed(3)),edge:edge(samples),matches};
});
console.log(JSON.stringify({generatedAt:new Date().toISOString(),windowMs:20,report},null,2));
