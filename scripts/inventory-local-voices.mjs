import {readdir,stat,readFile,writeFile} from 'node:fs/promises';
import {resolve,basename} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

// Read-only media inventory. No upload, transcription, cue validation or editing.
const directory=resolve(process.argv[2]||'C:/Users/SRTB_AD/Desktop/Voix off');
const ffprobe='C:/Program Files/PlayoutPilot/Components/casparcg/current/ffprobe.exe';
const ffmpeg='C:/Program Files/PlayoutPilot/Components/casparcg/current/ffmpeg.exe';
const reportPath=resolve('reports/local-voice-inventory-2026-09-23.json');
const files=(await readdir(directory,{withFileTypes:true})).filter(item=>item.isFile()&&/\.mp3$/i.test(item.name));
const rows=[];
for(const item of files){
  const path=resolve(directory,item.name),metadata=await stat(path);
  if(metadata.size>10*1024*1024)throw Error('Inventory expects only short voice files; refusing '+basename(path));
  const probe=spawnSync(ffprobe,['-v','error','-show_entries','format=duration,bit_rate:stream=codec_name,sample_rate,channels','-of','json',path],{encoding:'utf8',windowsHide:true});
  if(probe.status!==0)throw Error('ffprobe failed for '+item.name);
  const data=JSON.parse(probe.stdout),stream=data.streams[0];
  const silence=spawnSync(ffmpeg,['-hide_banner','-nostdin','-i',path,'-af','silencedetect=noise=-45dB:d=0.08','-f','f32le','-acodec','pcm_f32le','-ar','48000','-ac','2','pipe:1'],{windowsHide:true,maxBuffer:16*1024*1024});
  if(silence.status!==0)throw Error('Full audio decode failed for '+item.name);
  const silenceEvents=[...silence.stderr.toString('utf8').matchAll(/silence_(start|end|duration): ([0-9.]+)/g)].map(match=>({kind:match[1],seconds:Number(match[2])}));
  const decodedDurationSeconds=silence.stdout.length/(2*4*48000);
  rows.push({name:item.name,bytes:metadata.size,durationSeconds:Number(data.format.duration),codec:stream.codec_name,sampleRate:Number(stream.sample_rate),channels:stream.channels,
    sha256:createHash('sha256').update(await readFile(path)).digest('hex'),decode:'PASS',decodedDurationSeconds,silenceEvents,cueStatus:'Unverified — filename is only a hint, not a listened attestation.'});
}
const report={scope:'Local metadata and complete decode only. No network, upload, transcription or file modification.',directory,
  silenceThresholdDb:-45,silenceMinimumSeconds:.08,files:rows,count:rows.length,totalBytes:rows.reduce((sum,item)=>sum+item.bytes,0),
  oldInsertionWindowSeconds:2.44,exceedOldInsertionWindow:rows.filter(item=>item.durationSeconds>2.44).map(item=>item.name)};
await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({report:reportPath,count:report.count,totalBytes:report.totalBytes,exceedOldInsertionWindow:report.exceedOldInsertionWindow,files:rows.map(({name,durationSeconds,decodedDurationSeconds})=>({name,durationSeconds,decodedDurationSeconds}))},null,2));
