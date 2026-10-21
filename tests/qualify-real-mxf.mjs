// Explicit, read-only source qualification. Never copies/uploads the source or
// prepares its whole duration. The short output is a private local test artifact.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {preparationArguments} from '../connector/media-preparation.mjs';
const run=promisify(execFile),repo=path.resolve(import.meta.dirname,'..');
const source=process.env.QUALIFY_MXF_SOURCE;
if(!source||!path.isAbsolute(source)||!source.toLowerCase().endsWith('.mxf'))throw Error('Explicit MXF source required');
const sourceBefore=await fs.stat(source),folder=await fs.mkdtemp(path.join(repo,'.qa-delivery/real-mxf-'));
const engine=path.join(repo,'.tools/media-preparation/ffmpeg-9.0.2-essentials_build/bin');
const output=path.join(folder,'qualification-3-seconds.mp4'),args=preparationArguments(source,output);
args.splice(args.length-1,0,'-t','3');
await run(path.join(engine,'ffmpeg.exe'),args,{windowsHide:true,timeout:180000,maxBuffer:1024*1024});
const info=JSON.parse((await run(path.join(engine,'ffprobe.exe'),['-v','error','-show_entries','format=duration:stream=codec_name,codec_type,pix_fmt,width,height,channels','-of','json',output],{windowsHide:true})).stdout);
const after=await fs.stat(source),unchanged=['size','mtimeMs','ctimeMs','ino','dev'].every(key=>after[key]===sourceBefore[key]);
if(!unchanged||info.streams.find(s=>s.codec_type==='video')?.pix_fmt!=='yuv420p'||info.streams.find(s=>s.codec_type==='audio')?.codec_name!=='aac'){console.log(JSON.stringify({unchanged,info,changes:['size','mtimeMs','ctimeMs','ino','dev'].filter(key=>after[key]!==sourceBefore[key]).map(key=>({key,before:sourceBefore[key],after:after[key]}))}));throw Error('Qualification failed');}
const report={sourceBytes:sourceBefore.size,sampleOnly:true,wholeProgrammeTested:false,sourceMetadataUnchanged:unchanged,output,info};
await fs.writeFile(path.join(folder,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
