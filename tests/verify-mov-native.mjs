// Independent read-only decode of browser-created artifacts; no rendering helper.
import {readdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
const directory=resolve('reports/mov-integration');
const bin='C:/Program Files/PlayoutPilot/Components/casparcg/current';
function run(name,args){return new Promise((yes,no)=>{
  const child=spawn(resolve(bin,name),args,{windowsHide:true});let out='',err='';
  child.stdout.on('data',data=>out+=data);child.stderr.on('data',data=>err+=data);
  child.on('error',no);child.on('exit',code=>code===0?yes({out,err}):no(Error(name+': '+err)));
});}
const results=[];
for(const name of (await readdir(directory)).filter(n=>/^integrated-.*\.json$/.test(n)).sort()){
  const expected=JSON.parse(await readFile(resolve(directory,name),'utf8')),file=resolve(directory,name.replace(/\.json$/,'.mov'));
  const {out}=await run('ffprobe.exe',['-v','error','-show_streams','-show_format','-of','json',file]);
  const info=JSON.parse(out),video=info.streams.find(s=>s.codec_type==='video'),audio=info.streams.find(s=>s.codec_type==='audio');
  if(video?.codec_name!=='prores'||video.profile!=='4444'||video.codec_tag_string!=='ap4h'||!video.pix_fmt.startsWith('yuva444')||video.width!==1920||video.height!==1080||video.avg_frame_rate!=='25/1'||Number(video.nb_frames)!==expected.frames||Math.abs(Number(video.duration)-expected.duration)>.001)throw Error(name+': video metadata mismatch');
  if(expected.audio&&(audio?.codec_name!=='pcm_s24le'||audio.sample_rate!=='48000'||audio.channels!==2||Math.abs(Number(audio.duration)-expected.duration)>.001))throw Error(name+': audio metadata mismatch');
  const decoded=await run('ffmpeg.exe',['-v','error','-xerror','-threads','2','-i',file,'-map','0','-f','null','-']);
  if(decoded.err.trim())throw Error(name+': '+decoded.err);
  results.push({file:name.replace(/\.json$/,'.mov'),template:expected.template,mode:expected.mode,frames:expected.frames,duration:expected.duration,seconds:expected.seconds,bytes:expected.bytes,codec:video.codec_name,profile:video.profile,pixelFormat:video.pix_fmt,audio:audio?.codec_name,fullDecode:'PASS'});
  console.log('PASS',expected.template,expected.mode,expected.frames,'frames',expected.duration,'seconds');
}
if(!results.length)throw Error('No browser MOV artifacts');
await writeFile(resolve(directory,'native-verification.json'),JSON.stringify({checkedAt:new Date().toISOString(),results},null,2)+'\n');
