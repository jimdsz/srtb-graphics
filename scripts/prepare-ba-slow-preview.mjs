// Offline preparation of one already-authorized library example. This encoder
// is a local installed utility, not bundled into Graphics or its export engine.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

const root=resolve(import.meta.dirname,'..');
const binary='C:/Program Files/PlayoutPilot/Components/casparcg/current/';
const source=resolve(root,'public/library/v1.7.0/BTV_BA_1P/lib/media/prepared/native-v102/slow-25b341c2aeb35dc28530.mp4');
const output=resolve(root,'public/preview-media/v3/ba-prepared-slow-1280.mp4');
const digest=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
function run(name,args){const result=spawnSync(binary+name+'.exe',args,{encoding:'utf8',maxBuffer:16*1024**2});assert.equal(result.status,0,result.stderr);return result;}
function probe(file){return JSON.parse(run('ffprobe',['-v','error','-show_streams','-show_format','-show_frames','-show_entries','frame=best_effort_timestamp_time,pkt_duration_time','-of','json',file]).stdout);}
const before=await digest(source),original=probe(source),video=original.streams.find(s=>s.codec_type==='video');
assert.equal(original.streams.length,1,'The approved prepared example has no audio; do not silently strip a new source.');
assert.equal(video.width,3840);assert.equal(video.height,2160);assert.equal(video.nb_frames,'161');assert.equal(video.avg_frame_rate,'25/1');
await mkdir(resolve(root,'public/preview-media/v3'),{recursive:true});
run('ffmpeg',['-hide_banner','-v','error','-n','-threads','2','-i',source,'-map','0:v:0','-vf','scale=1280:720:flags=lanczos','-fps_mode','passthrough','-c:v','libx264','-threads','2','-preset','medium','-crf','18','-profile:v','main','-level:v','3.1','-pix_fmt','yuv420p','-g','25','-bf','0','-movflags','+faststart','-map_metadata','-1',output]);
const prepared=probe(output),next=prepared.streams.find(s=>s.codec_type==='video');
assert.equal(next.width,1280);assert.equal(next.height,720);assert.equal(next.avg_frame_rate,video.avg_frame_rate);
assert.equal(next.nb_frames,video.nb_frames);assert.equal(next.duration,video.duration);assert.equal(next.start_time,video.start_time);
assert.deepEqual(prepared.frames,original.frames,'Every frame retains its original source timestamp/duration.');
assert.equal(await digest(source),before,'The immutable source must remain untouched.');
const compare=run('ffmpeg',['-hide_banner','-threads','2','-i',source,'-threads','2','-i',output,'-filter_complex_threads','1','-lavfi','[0:v]scale=1280:720:flags=lanczos[reference];[reference][1:v]ssim','-an','-f','null','-']);
const ssim=Number(/All:([\d.]+)/.exec(compare.stderr)?.[1]);assert.ok(ssim>.98,`SSIM too low: ${ssim}`);
const proof={source:source.slice(root.length+1),output:output.slice(root.length+1),sourceSha256:before,previewSha256:await digest(output),sourceBytes:Number(original.format.size),previewBytes:Number(prepared.format.size),sourceDimensions:[video.width,video.height],previewDimensions:[next.width,next.height],frames:Number(next.nb_frames),fps:25,duration:Number(next.duration),identicalFrameTiming:true,scaledReferenceSSIM:ssim,noAudioInOriginal:true};
await mkdir(resolve(root,'reports'),{recursive:true});await writeFile(resolve(root,'reports/ba-slow-preview-proof.json'),JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof,null,2));
