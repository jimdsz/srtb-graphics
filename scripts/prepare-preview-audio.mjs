import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),sourcePath='/library/v1.7.0/BTV_BA_1P/sourceassets/BTV_BA1P%20-23LUFS.wav',proxyPath='/preview-media/audio-v1/ba-bed.flac';
const source=resolve(root,'public',decodeURIComponent(sourcePath).slice(1)),output=resolve(root,'public',proxyPath.slice(1)),manifestPath=resolve(root,'src/studio/preview-audio-proxy.generated.json');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceBytes=await readFile(source),sourceSha256=hash(sourceBytes);
// Filled from the immutable package, never accept a different jingle silently.
const expectedSource='0c83e15a393dc76e7b0eceb20c32c5bfaf8f648ac0a119c8de456c4375bd8e7c';
const expectedProxy='63ca0ac87277c93a0b1ecb110bc620f6949255b0965f6f385393cc56758b481f';
if(sourceSha256!==expectedSource)throw Error('Native BA jingle changed; requalify the preview proxy.');
if(process.argv.includes('--generate')){
  const ffmpeg='C:/Program Files/PlayoutPilot/Components/casparcg/current/ffmpeg.exe';
  const run=args=>{const result=spawnSync(ffmpeg,['-v','error','-nostdin',...args],{maxBuffer:32*1024**2,windowsHide:true});if(result.error)throw result.error;if(result.status!==0)throw Error(result.stderr.toString());return result.stdout;};
  await mkdir(resolve(output,'..'),{recursive:true});
  run(['-y','-i',source,'-map','0:a:0','-map_metadata','-1','-c:a','flac','-compression_level','12','-sample_fmt','s32','-bits_per_raw_sample','24',output]);
  const decode=path=>run(['-i',path,'-map','0:a:0','-f','f32le','-acodec','pcm_f32le','pipe:1']);
  const original=decode(source),derived=decode(output);
  if(original.length!==1440000*2*4||!original.equals(derived))throw Error('FLAC preview must decode sample-identically to the full original WAV.');
  const probes=[];for(let seconds=.125;seconds<30;seconds+=.5){const frame=Math.round(seconds*48000);for(const delta of [0,1,7]){const index=frame+delta;probes.push([index,original.readFloatLE(index*8),original.readFloatLE(index*8+4)]);}}
  const proxyBytes=await readFile(output);
  await writeFile(manifestPath,JSON.stringify({version:1,sourcePath,sourceSha256,sourceBytes:sourceBytes.length,proxyPath,proxySha256:hash(proxyBytes),proxyBytes:proxyBytes.length,sampleRate:48000,channels:2,frames:1440000,pcmSha256:hash(original),probes},null,2)+'\n');
}
const manifest=JSON.parse(await readFile(manifestPath,'utf8')),proxy=await readFile(output);
if(manifest.sourcePath!==sourcePath||manifest.proxyPath!==proxyPath||manifest.sourceSha256!==sourceSha256||manifest.sourceBytes!==sourceBytes.length||manifest.proxySha256!==expectedProxy||hash(proxy)!==expectedProxy||manifest.proxyBytes!==proxy.length||manifest.frames!==1440000||manifest.sampleRate!==48000||manifest.channels!==2)throw Error('Preview audio manifest or pinned binary is inconsistent.');
console.log(`Preview-only lossless BA jingle verified: ${sourceBytes.length} → ${proxy.length} bytes, 1440000 frames at48kHz. Original/export unchanged.`);
