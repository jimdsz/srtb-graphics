import {spawnSync} from 'node:child_process';
import {mkdir,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
const executable='C:/Program Files/PlayoutPilot/Components/casparcg/current/ffmpeg.exe';
const folder=resolve('tests/fixtures/weekly-witnesses-v2');
await mkdir(folder,{recursive:true});
const colours=['bb2933','188042','2464bb','992eaf','bc701d','167e94','969b23'];
for(let i=0;i<7;i++){
  const output=resolve(folder,`media-${i+1}.mp4`);
  try{await stat(output);console.log(`Existing witness ${i+1}: preserved`);continue;}catch{}
  // A full-width moving band stays visible after any centred social crop.
  // The old horizontal witness could move entirely outside the 9:16 frame.
  const filter=`[0:v][1:v]overlay=x=0:y='60+mod(t*90,80)':shortest=1,drawtext=fontfile='C\\:/Windows/Fonts/arialbd.ttf':text='MEDIA ${i+1}':fontsize=32:fontcolor=white:x=(w-tw)/2:y=20,drawtext=fontfile='C\\:/Windows/Fonts/arialbd.ttf':text='FRAME %{n}':fontsize=24:fontcolor=white:x=(w-tw)/2:y=170`;
  const result=spawnSync(executable,['-nostdin','-hide_banner','-loglevel','error','-n','-f','lavfi','-i',`color=c=0x${colours[i]}:s=640x360:r=25:d=8`,'-f','lavfi','-i','color=c=white:s=640x32:r=25:d=8','-filter_complex',filter,'-an','-c:v','libx264','-threads','2','-preset','fast','-crf','18','-pix_fmt','yuv420p','-g','25','-movflags','+faststart',output],{encoding:'utf8',windowsHide:true});
  if(result.status!==0)throw Error(result.stderr||`Witness ${i+1} failed`);
  console.log(`Created witness ${i+1}: ${(await stat(output)).size} bytes`);
}
