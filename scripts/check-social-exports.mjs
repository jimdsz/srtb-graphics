import {readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {unzipSync} from 'fflate';
const directory=resolve('reports/social-qualification');
const files=await readdir(directory),report=[];
const executable='C:/Program Files/PlayoutPilot/Components/casparcg/current/';
function probe(path){const r=spawnSync(executable+'ffprobe.exe',['-v','error','-show_streams','-show_format','-of','json',path],{encoding:'utf8',maxBuffer:1024**2});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}
for(const mode of ['exports','alpha']){
  const filename=files.filter(n=>new RegExp('^'+mode+'-\\d+\\.json$').test(n)).sort().at(-1);assert.ok(filename,mode+' evidence missing');
  const records=JSON.parse(await readFile(resolve(directory,filename),'utf8')),stamp=filename.match(/\d+/)[0];
  assert.equal(records.length,mode==='exports'?14:12);
  for(const record of records){
    const stem=record.id.toLowerCase().replaceAll('_','-')+'-'+record.presentation+'-'+stamp;
    if(record.format==='png'){
      const zip=unzipSync(await readFile(resolve(directory,stem+'-png.zip'))),manifest=JSON.parse(new TextDecoder().decode(zip['SEQUENCE.json']));
      assert.equal(Object.keys(zip).filter(n=>/^images\/image_\d{6}\.png$/.test(n)).length,record.frames);
      for(const key of ['width','height','fps','frames','duration'])assert.equal(manifest[key],record[key]);
      assert.equal(manifest.alpha,'straight');assert.ok(zip['audio.wav']);
      const png=zip['images/image_000076.png'];assert.equal(new DataView(png.buffer,png.byteOffset).getUint32(16),record.width);assert.equal(png[25],6);
      report.push({file:stem+'-png.zip',result:'PASS',images:record.frames,rgba:true});
    }else{
      const path=resolve(directory,stem+'.'+record.format),metadata=probe(path),video=metadata.streams.find(s=>s.codec_type==='video'),audio=metadata.streams.find(s=>s.codec_type==='audio');
      assert.equal(video.width,record.width);assert.equal(video.height,record.height);assert.equal(video.avg_frame_rate,'25/1');assert.equal(Number(video.nb_frames),record.frames);assert.ok(Math.abs(Number(video.duration)-record.duration)<.001);assert.equal(Number(audio.sample_rate),48000);
      const decoded=spawnSync(executable+'ffmpeg.exe',['-v','error','-threads','2','-i',path,'-f','null','-'],{encoding:'utf8',maxBuffer:1024**2});assert.equal(decoded.status,0,decoded.stderr);assert.equal(decoded.stderr.trim(),'');
      let alpha;
      if(record.format==='mov'){
        assert.equal(video.codec_name,'prores');assert.equal(video.profile,'4444');assert.match(video.pix_fmt,/^yuva/);assert.equal(audio.codec_name,'pcm_s24le');
        const pixels=spawnSync(executable+'ffmpeg.exe',['-v','error','-ss','3','-i',path,'-frames:v','1','-vf','alphaextract,format=gray','-f','rawvideo','pipe:1'],{maxBuffer:4*1024**2});assert.equal(pixels.status,0,pixels.stderr.toString());
        let min=255,max=0;for(const value of pixels.stdout){min=Math.min(min,value);max=Math.max(max,value);}assert.equal(min,0);assert.equal(max,255);alpha={min,max};
      }else assert.equal(video.codec_name,'h264');
      report.push({file:stem+'.'+record.format,result:'PASS',codec:video.codec_name,width:video.width,height:video.height,frames:Number(video.nb_frames),audio:audio.codec_name,alpha});
    }
    console.log('PASS',stem,record.format);
  }
}
await writeFile(resolve(directory,'independent-'+Date.now()+'.json'),JSON.stringify(report,null,2));
console.log('Independent FFmpeg / PNG archive checks passed:',report.length);
