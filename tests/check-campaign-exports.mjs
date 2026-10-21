// Source media are read-only; optional reports/contact sheets stay in reports/.
// Explicit local input paths only. Never imports the application renderer.
import {spawnSync} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {lstat,readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isAbsolute,resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CAMPAIGN_EXPORTS,readSyntheticFixture,stereoFloat32,analyzeVoice,parseFrameHashes,analyzeAlphaHashes} from './campaign-export-analysis.mjs';

const bin='C:/Program Files/PlayoutPilot/Components/casparcg/current',root=fileURLToPath(new URL('../',import.meta.url));
function command(tool,args,maxBuffer=8*1024**2){
  const result=spawnSync(`${bin}/${tool}.exe`,args,{windowsHide:true,maxBuffer,timeout:240000});
  if(result.error)throw result.error;
  if(result.status!==0)throw Error(`${tool} a échoué (${result.status}) : ${result.stderr.toString('utf8').slice(-4000)}`);
  return result.stdout;
}
async function fileHash(path){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
function entries(args){
  if(!args.length)throw Error('Fournir uniquement cle=CHEMIN_ABSOLU, par exemple popup-alpha=C:\\Exports\\fichier.mov. Clés : '+Object.keys(CAMPAIGN_EXPORTS).join(', '));
  const used=new Set(),paths=new Set();
  return args.map(argument=>{
    const at=argument.indexOf('='),key=argument.slice(0,at),path=argument.slice(at+1),expected=Object.hasOwn(CAMPAIGN_EXPORTS,key)?CAMPAIGN_EXPORTS[key]:undefined;
    if(at<1||!expected||!isAbsolute(path)||path.startsWith('\\\\')||/[*?\0]|^[a-z]+:\/\//i.test(path)||used.has(key)||paths.has(resolve(path).toLowerCase()))throw Error('Clé/chemin explicite local invalide ou dupliqué.');
    if(extname(path).toLowerCase()!==(expected.alpha?'.mov':'.mp4'))throw Error('Extension inattendue pour '+key);
    used.add(key);paths.add(resolve(path).toLowerCase());return {key,path:resolve(path),expected};
  });
}

const report={kind:'independent-local-campaign-diagnostic',campaignQualified:false,notice:'Aucune conclusion globale sur 8 exports. Pas de comparaison visuelle éditoriale ; les mesures ne valident pas les voix réelles.',results:[]};
let artifactDirectory;
try{
  const args=process.argv.slice(2),artifacts=args.filter(value=>value==='--artifacts');
  if(artifacts.length>1)throw Error('Option --artifacts dupliquée.');
  const inputs=entries(args.filter(value=>value!=='--artifacts'));report.provided=inputs.map(input=>input.key);report.missing=Object.keys(CAMPAIGN_EXPORTS).filter(key=>!report.provided.includes(key));
  if(artifacts.length){
    const parent=resolve(root,'reports'),info=await lstat(parent);if(!info.isDirectory()||info.isSymbolicLink())throw Error('Répertoire reports régulier requis.');
    artifactDirectory=resolve(parent,`campaign-export-analysis-${Date.now()}`);await mkdir(artifactDirectory);
    report.artifactDirectory=artifactDirectory;
  }
  report.ffmpegVersion=command('ffmpeg',['-version']).toString('utf8').split(/\r?\n/)[0];
  for(const {key,path,expected} of inputs){
    const result={key,path};report.results.push(result);process.stderr.write(`Diagnostic local : ${key}\n`);
    try{
      const before=await lstat(path);if(!before.isFile()||before.isSymbolicLink()||before.size>2*1024**3)throw Error('Fichier régulier local, au plus2Gio, requis.');
      result.bytes=before.size;result.sha256=await fileHash(path);
      const probe=JSON.parse(command('ffprobe',['-v','error','-threads','2','-show_streams','-show_format','-of','json',path]).toString('utf8'));
      const videos=probe.streams.filter(stream=>stream.codec_type==='video'),audios=probe.streams.filter(stream=>stream.codec_type==='audio');
      if(videos.length!==1)throw Error('Un flux vidéo unique est requis.');
      const video=videos[0];result.streams=probe.streams;result.format=probe.format;
      result.expected={...expected,frames:expected.alpha?326:503,duration:expected.alpha?13.04:20.12,fps:25,audio:!expected.alpha};
      result.metadataChecks={dimensions:video.width===expected.width&&video.height===expected.height,fps:video.avg_frame_rate==='25/1',declaredFrames:Number(video.nb_frames)===result.expected.frames,videoDuration:Number(video.duration)===result.expected.duration,audioCount:audios.length===(expected.alpha?0:1)};
      if(!result.metadataChecks.dimensions)throw Error('Dimensions inattendues : décodage borné refusé.');
      const base=['-hide_banner','-v','error','-nostdin','-xerror','-threads','2','-filter_threads','2','-protocol_whitelist','file,pipe','-i',path,'-map','0:v:0','-an'];
      if(expected.alpha&&!/^(?:yuva|gbrap|rgba|bgra|argb|abgr|ya)/.test(video.pix_fmt||''))throw Error('Le format vidéo déclaré ne possède pas de canal alpha.');
      const videoArgs=[...base,...(expected.alpha?['-vf','alphaextract,format=gray16le']:[]),'-fps_mode','passthrough','-c:v','rawvideo','-threads','2','-f','framehash','-hash','sha256','pipe:1'];
      const hashes=parseFrameHashes(command('ffmpeg',videoArgs).toString('utf8'));
      result.decodedVideo={frames:hashes.length,expectedFrames:hashes.length===result.expected.frames,ptsContiguousAt25Fps:hashes.every((frame,index)=>frame.pts===index&&frame.duration===1),first:hashes[0],last:hashes.at(-1),decoderExit:0};
      if(expected.alpha)result.alpha=analyzeAlphaHashes(hashes,video.width,video.height);
      else{
        if(audios.length!==1||audios[0].channels!==2||Number(audios[0].sample_rate)!==48000)throw Error('Voix attendue en stéréo48k : aucun rééchantillonnage/upmix implicite autorisé.');
        const fixturePath=resolve(root,'.tools/campaign-qualification',`TEST-SYNTHETIQUE-${expected.fixture}.wav`),fixtureBytes=await readFile(fixturePath),fixture=readSyntheticFixture(fixtureBytes,expected.frequency);
        result.fixture={path:fixturePath,sha256:createHash('sha256').update(fixtureBytes).digest('hex'),frames:fixture.length,rate:48000,shape:'Amplitude 0,4 pendant les 40 ms initiales/finales ; 0,12 au centre ; aucune rampe dans la source.'};
        const audio=command('ffmpeg',['-hide_banner','-v','error','-nostdin','-xerror','-threads','2','-protocol_whitelist','file,pipe','-i',path,'-map','0:a:0','-vn','-c:a','pcm_f32le','-threads','2','-f','f32le','pipe:1'],16*1024**2);
        const pcm=stereoFloat32(audio);result.decodedAudio={frames:pcm.left.length,rate:48000,duration:pcm.left.length/48000,decoderExit:0};
        result.voice=analyzeVoice(pcm,fixture,expected.frequency);
        if(artifactDirectory){
          const indices=[25,100,200,297,375,450,490,502],size=expected.height===1080?[480,270]:expected.height===1350?[256,320]:[216,384],contact=resolve(artifactDirectory,key+'-contact.png');
          const select=indices.map(index=>`eq(n\\,${index})`).join('+');
          command('ffmpeg',[...base,'-vf',`select=${select},scale=${size[0]}:${size[1]},tile=4x2:padding=8:margin=8:color=black`,'-frames:v','1','-threads','2','-c:v','png','-n',contact]);
          result.contactSheet={path:contact,layout:'4 columns × 2 rows; left to right, top to bottom',requestedSeconds:[1,4,8,11.9,15,18,19.6,20.08],actualSeconds:indices.map(index=>index/25),frameIndices:indices,tileWidth:size[0],tileHeight:size[1]};
        }
      }
      const after=await lstat(path);if(after.size!==before.size||after.mtimeMs!==before.mtimeMs)throw Error('Fichier modifié pendant le diagnostic.');
      result.analysisCompleted=true;
    }catch(error){result.analysisCompleted=false;result.error=error.message;process.exitCode=1;}
  }
}catch(error){report.error=error.message;process.exitCode=1;}
if(artifactDirectory){
  const path=resolve(artifactDirectory,'measurements.json');await writeFile(path,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({reportPath:path,provided:report.provided,missing:report.missing,campaignQualified:false,error:report.error,results:report.results.map(result=>({key:result.key,analysisCompleted:result.analysisCompleted,error:result.error,sha256:result.sha256,metadataChecks:result.metadataChecks,decodedVideo:result.decodedVideo,decodedAudio:result.decodedAudio,alpha:result.alpha,contactSheet:result.contactSheet,insertions:result.voice?.insertions.map(insertion=>({start:insertion.start,end:insertion.end,stableWindows:insertion.stableWindows.map(window=>({start:window.start,end:window.end,winnerHz:window.winnerHz,expectedVsOtherDb:window.expectedVsOtherDb,expectedAmplitude:window.expectedAmplitude})),terminalMarkerDb:insertion.terminalMarker.amplitudeIncreaseDb,bins10ms:insertion.wholePassage.bins10ms,expectedWins:insertion.wholePassage.expectedWins,gainMedian:insertion.wholePassage.gainMedian}))}))},null,2));
}else console.log(JSON.stringify(report,null,2));
