// Synthetic fixture only. Never run against an operator's source media.
import {spawnSync} from 'node:child_process';
import {mkdir,open,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve('reports/reliability');await mkdir(root,{recursive:true});
const short=resolve(root,'synthetic-10s.mp4'),long=resolve(root,'synthetic-1h-4gib.mp4');
const ffmpeg='C:/Program Files/PlayoutPilot/Components/casparcg/current/ffmpeg.exe';
function run(args){const r=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-n',...args],{stdio:'inherit'});if(r.status)throw Error('Fixture generation failed');}
run(['-f','lavfi','-i','testsrc2=size=320x180:rate=25','-t','10','-c:v','libx264','-preset','ultrafast','-crf','28','-pix_fmt','yuv420p','-movflags','+faststart',short]);
run(['-stream_loop','359','-i',short,'-t','3600','-c','copy','-movflags','+faststart',long]);
// An ISO BMFF free box tests large offsets without a multi-gigabyte video encode.
// This is explicitly not a high-bitrate decoding benchmark.
const bytes=(await stat(long)).size,target=4*1024**3,box=Buffer.alloc(16);
box.writeUInt32BE(1);box.write('free',4);box.writeBigUInt64BE(BigInt(target-bytes),8);
const handle=await open(long,'r+');try{await handle.write(box,0,16,bytes);await handle.truncate(target);}finally{await handle.close();}
console.log(JSON.stringify({path:long,bytes:target,seconds:3600,synthetic:true}));
