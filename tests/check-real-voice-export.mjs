import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isAbsolute,resolve} from 'node:path';

// Read-only, independent of Graphics' audio/render code. Both paths are explicit.
// Correlation demonstrates source presence, not editorial/loudness compliance.
const [exportPath,voicePath,...startArgs]=process.argv.slice(2);
if(!exportPath||!voicePath||!startArgs.length||![exportPath,voicePath].every(p=>isAbsolute(p)&&!p.startsWith('\\\\')))
  throw Error('Usage: check-real-voice-export.mjs <absolute export> <absolute voice> <cue seconds>...');
const starts=startArgs.map(Number);
if(starts.some(s=>!Number.isFinite(s)||s<0))throw Error('Invalid explicit cue.');
const ffmpeg='C:/Program Files/PlayoutPilot/Components/casparcg/current/ffmpeg.exe';
const ffprobe='C:/Program Files/PlayoutPilot/Components/casparcg/current/ffprobe.exe';
const rate=48000;
function decode(path){
  const probe=spawnSync(ffprobe,['-v','error','-select_streams','a:0','-show_entries','stream=codec_name,sample_rate,channels','-of','json',path],{encoding:'utf8',windowsHide:true});
  if(probe.status!==0)throw Error(probe.stderr);
  const stream=JSON.parse(probe.stdout).streams[0];
  if(!stream||stream.channels!==2)throw Error('Expected stereo source and export.');
  const result=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-threads','2','-i',path,'-map','0:a:0','-vn','-ar',String(rate),'-ac','2','-f','f32le','pipe:1'],{windowsHide:true,maxBuffer:256*1024*1024});
  if(result.status!==0||result.stdout.length%8)throw Error(result.stderr?.toString()||'Decode failed');
  const mid=new Float64Array(result.stdout.length/8);
  for(let n=0;n<mid.length;n++)mid[n]=(result.stdout.readFloatLE(n*8)+result.stdout.readFloatLE(n*8+4))/2;
  return {mid,stream,decodedSeconds:mid.length/rate};
}
const source=decode(voicePath),output=decode(exportPath);
function compare(start,from,to,lag,stride=1){
  const begin=Math.round(from*rate),end=Math.min(source.mid.length,Math.round(to*rate));
  const offset=Math.round(start*rate)+lag;
  if(begin>=end||offset+begin<0||offset+end>output.mid.length)throw Error('Range outside decoded PCM.');
  let xx=0,yy=0,xy=0,n=0;
  for(let i=begin;i<end;i+=stride){const x=source.mid[i],y=output.mid[offset+i];xx+=x*x;yy+=y*y;xy+=x*y;n++;}
  const gain=xx?xy/xx:0,correlation=xx&&yy?xy/Math.sqrt(xx*yy):0;
  return {correlation,gain,sourceRms:Math.sqrt(xx/n),outputRms:Math.sqrt(yy/n)};
}
const insertions=starts.map(start=>{
  // One AAC frame maximum search, reported explicitly, never used to hide a cut.
  let best={lag:0,correlation:-Infinity};
  for(let lag=-1024;lag<=1024;lag+=16){const m=compare(start,.08,source.decodedSeconds-.02,lag,8);if(m.correlation>best.correlation)best={lag,...m};}
  const coarse=best.lag;
  for(let lag=coarse-15;lag<=coarse+15;lag++){
    if(Math.abs(lag)>1024)continue;
    const m=compare(start,.08,source.decodedSeconds-.02,lag,4);if(m.correlation>best.correlation)best={lag,...m};
  }
  return {expectedStart:start,expectedEnd:start+source.decodedSeconds,lagSamples:best.lag,lagSeconds:best.lag/rate,
    exactCue:compare(start,.08,source.decodedSeconds-.02,0),aligned:compare(start,.08,source.decodedSeconds-.02,best.lag),
    windows:Array.from({length:Math.ceil(source.decodedSeconds/.25)},(_,index)=>{
      const from=index*.25,to=Math.min(source.decodedSeconds,from+.25);
      return {from,to,...compare(start,from,to,best.lag)};
    })};
});
console.log(JSON.stringify({exportPath:resolve(exportPath),voicePath:resolve(voicePath),voiceSha256:createHash('sha256').update(await readFile(voicePath)).digest('hex'),
  source:{stream:source.stream,duration:source.decodedSeconds},output:{stream:output.stream,duration:output.decodedSeconds},insertions,
  scope:'Read-only local decode and waveform comparison. No upload, re-encoding, editorial attestation, EBU compliance verdict or global PASS.'},null,2));
