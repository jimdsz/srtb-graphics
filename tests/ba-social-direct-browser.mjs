import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const folder='reports/ba-social-direct';await mkdir(folder,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true}),errors=[],requests=[],records=[];let page;
try{
 page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
 await page.route('**/api/**',r=>r.fulfill({status:500,body:'No production API in local qualification'}));
 await page.goto('http://127.0.0.1:5198/tests/preview-reliability.html',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>!!window.previewQA?.set);
 for(const format of process.argv.includes('--extra-only')?[]:['portrait','vertical'])for(const mode of ['simple','multiple']){
  const label=`${mode}-${format}`;console.log('Checking '+label);
  const patch={_studio_format:format,_studio_ba_mode:mode,_audio_voice_enabled:false,_audio_bed_enabled:true,_out_mode:'duration',_out_duration_seconds:64.8,_media_body_start_seconds:2,_media_body_end_seconds:6,_media_body_rate:1.25,_media_body_loop:false,_media_body_audio_enabled:true,_media_intro_url:'lib/missing-intro.mp4',_media_pack_url:'lib/missing-outro.mp4',_audio_bed_url:'lib/missing-jingle.wav'};
  await page.evaluate(patch=>window.previewQA.set('BTV_BA_1P',patch),patch);
  const start=page.getByRole('button',{name:'Recommencer l’aperçu (IN)',exact:true});await expect(start).toBeEnabled({timeout:60000});
  await expect(page.locator('.monitor-sync')).toContainText('Aperçu à jour');
  await page.getByRole('button',{name:'Son',exact:true}).click();await expect(page.getByRole('button',{name:'Rétablir et activer la signature'})).toHaveCount(0);
  await expect(page.getByText('Départ sur les extraits (s)',{exact:true})).toBeVisible();await expect(page.getByText('Carton · départ après OUT (s)',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Médias',exact:true}).click();
  assert.equal(await page.locator('.fields-panel [data-inspector-field^="_media_intro_"]').count(),0);
  const state=await page.evaluate(async()=>{const g=document.querySelector('.graphic-host').firstElementChild;await g.__previewTransport.seek(0);g.__socialPreview.refresh();return {clock:g._times(),boxes:g.__socialTypography.boxes(),body:g.media.status().body,plan:g.audio.plan,canvas:g.__socialPreview.canvas.toDataURL()};});
  assert.equal(state.clock.body,0);assert.equal(state.body.sourceTime,2);assert.equal(state.body.rate,1.25);assert.ok(state.boxes.length);assert.ok(state.plan.voice.every(item=>!item.id.endsWith('outro')));
  await writeFile(`${folder}/${label}-first.png`,Buffer.from(state.canvas.split(',')[1],'base64'));
  const end=await page.evaluate(async()=>{const g=document.querySelector('.graphic-host').firstElementChild;await g.__previewTransport.seek(3.16);g.__socialPreview.refresh();return {boxes:g.__socialTypography.boxes(),body:g.media.status().body,canvas:g.__socialPreview.canvas.toDataURL()};});
  assert.deepEqual(end.boxes,state.boxes,'graphics do not move between first and last excerpt frame');assert.ok(Math.abs(end.body.sourceTime-5.95)<.001);
  await writeFile(`${folder}/${label}-last.png`,Buffer.from(end.canvas.split(',')[1],'base64'));
  // Play/mute through the real operator control, then pause/seek/resume.
  const unmute=page.getByRole('button',{name:'Activer le son',exact:true});if(await unmute.count())await unmute.click();await expect(start).toBeEnabled();await start.click();
  await page.waitForFunction(()=>document.querySelector('.graphic-host').firstElementChild.__previewTransport.snapshot().seconds>.35);
  const playback=await page.evaluate(async()=>{const g=document.querySelector('.graphic-host').firstElementChild;await g.__previewTransport.pause();const a=g.__previewTransport.snapshot();await g.__previewTransport.seek(1);await g.__previewTransport.resume();return {paused:a,clock:g._times(),body:g.media.status().body,bed:g.audio.config._audio_bed_enabled};});
  assert.equal(playback.paused.playing,false);assert.equal(playback.bed,false);assert.ok(playback.clock.body>=1&&playback.clock.body<1.5);
  await page.waitForFunction(()=>document.querySelector('.graphic-host').firstElementChild.__previewTransport.snapshot().phase==='stopped',{},{timeout:10000});
  const stopped=await page.evaluate(()=>{const g=document.querySelector('.graphic-host').firstElementChild;return {snapshot:g.__previewTransport.snapshot(),body:g.media.status().body,audio:g.audio.playing};});
  assert.ok(stopped.snapshot.seconds>=3.2&&stopped.snapshot.seconds<3.6);assert.equal(stopped.body.playing,false);assert.equal(stopped.audio,false);
  if(format==='portrait'&&mode==='simple'){
   // Early manual OUT must complete in the same action, not enter an 8 s tail.
   await page.evaluate(async()=>{const g=document.querySelector('.graphic-host').firstElementChild;await g.__previewTransport.seek(.4);await g.__previewTransport.resume();await g.__previewTransport.out();});
   assert.equal(await page.evaluate(()=>document.querySelector('.graphic-host').firstElementChild.__previewTransport.snapshot().phase),'stopped');
  }
  const [download,report]=await Promise.all([page.waitForEvent('download',{timeout:240000}),page.evaluate(async label=>{const {qualifyBASocialExport}=await import('/tests/ba-social-direct-exports.ts');return qualifyBASocialExport(window.previewQA.data(),label);},label)]);
  await download.saveAs(`${folder}/${label}.mp4`);await page.evaluate(()=>window.disposeQualificationExport());assert.equal(report.duration,3.2);assert.equal(report.frames,80);assert.ok(report.audioPeak>0);records.push({label,playback,stopped,report});
  console.log('PASS '+label+' preview, timing and MP4 with audio');
 }
 // Long optional voice crosses the old TV OUT marker on the direct clock.
 console.log('Checking long voice, looping playlist and supplementary logo');
 await page.evaluate(async()=>{
  const {syntheticVoice}=await import('/tests/ba-social-direct-exports.ts');
  const voiceURL=syntheticVoice(),voice=await window.previewQA.bindLocalFile(new File([await(await fetch(voiceURL)).blob()],'qualification.wav',{type:'audio/wav'}),()=>{}),logo=await window.previewQA.bindLocalFile(new File([await(await fetch('/social/v2/btv-logo-horizontal-white.png')).blob()],'qualification-logo.png',{type:'image/png'}),()=>{});URL.revokeObjectURL(voiceURL);
  window.previewQA.set('BTV_BA_1P',{_studio_format:'vertical',_out_mode:'duration',_out_duration_seconds:80,_media_body_sequence:JSON.stringify([{url:'lib/media/programme.mp4',start:1,end:2},{url:'lib/media/programme.mp4',start:8,end:9}]),_media_body_loop:true,_media_body_audio_enabled:false,_audio_voice_enabled:true,_audio_voice_url:voice,_audio_voice_in_seconds:0,_audio_voice_out_seconds:5,_audio_voice_intro_offset_seconds:64,_audio_voice_outro_offset_seconds:68.48,_studio_ba_voice_fit:'manual',_studio_overlay_logo_enabled:true,_studio_overlay_logo_url:logo,_studio_overlay_logo_motion:'slide',_studio_overlay_logo_delay:2});
 });
 await expect(page.locator('.monitor-sync')).toContainText('Aperçu à jour',{timeout:60000});
 const unmuteVoice=page.getByRole('button',{name:'Activer le son',exact:true});if(await unmuteVoice.count())await unmuteVoice.click();
 await expect(page.getByRole('button',{name:'Recommencer l’aperçu (IN)',exact:true})).toBeEnabled({timeout:60000});
 await page.waitForFunction(()=>document.querySelector('.graphic-host').firstElementChild.muted===false);
 await page.waitForFunction(()=>document.querySelector('.graphic-host').firstElementChild.audio?.plan.voice?.[0]?.mainIn===64);
 const longVoice=await page.evaluate(async()=>{const g=document.querySelector('.graphic-host').firstElementChild;await g.__previewTransport.seek(64.4);await g.__previewTransport.resume();return g.audio.plan;});
 assert.equal(longVoice.voice.length,1);assert.equal(longVoice.voice[0].mainOut,69);assert.deepEqual(longVoice.bed,[]);
 await page.waitForFunction(()=>document.querySelector('.graphic-host').firstElementChild.__previewTransport.snapshot().seconds>65.2);
 const voiceStatus=await page.evaluate(async()=>{const g=document.querySelector('.graphic-host').firstElementChild,voice=g.audio.status().tracks.voice,status={muted:g.muted,audioMuted:g.audio.muted,playing:g.audio.playing,main:g.audio.mainSeconds,clock:g.audio.context.currentTime,direct:g.audio.config._audio_social_direct_enabled};await g.__previewTransport.pause();await g.__previewTransport.seek(65.2);return {voice,status,body:g.media.status().body};});
 console.log('Long voice check '+JSON.stringify(voiceStatus));
 assert.equal(voiceStatus.voice.audible,true);assert.ok(voiceStatus.voice.sourceSeconds>1.1);assert.ok(Math.abs(voiceStatus.body.sourceTime-8.2)<.001);
 // Export an eight-second version: one five-second voice, no closing copy.
 await page.evaluate(()=>window.previewQA.patch({_out_duration_seconds:8,_audio_voice_intro_offset_seconds:2}));
 await page.waitForFunction(()=>document.querySelector('.graphic-host').firstElementChild.audio?.plan.voice?.[0]?.mainIn===2);
 const [voiceDownload,voiceReport]=await Promise.all([page.waitForEvent('download',{timeout:240000}),page.evaluate(async()=>{const {qualifyBASocialExport}=await import('/tests/ba-social-direct-exports.ts');return qualifyBASocialExport(window.previewQA.data(),'voice-playlist-logo');})]);
 await voiceDownload.saveAs(`${folder}/voice-playlist-logo.mp4`);await page.evaluate(()=>window.disposeQualificationExport());assert.equal(voiceReport.duration,8);assert.equal(voiceReport.frames,200);assert.ok(voiceReport.audioPeak>.1);records.push({label:'voice-playlist-logo',voiceStatus,report:voiceReport});
 assert.deepEqual(errors,[]);assert.ok(!requests.some(url=>/missing-(intro|outro|jingle)/.test(url)),'unused TV assets were fetched');assert.ok(!requests.some(url=>url.includes('/api/')));
 await writeFile(`${folder}/report.json`,JSON.stringify({status:'PASS',records,errors,unusedTVFetches:0},null,2));
}catch(error){const notices=await page?.locator('.notice,[role="alert"]').allTextContents();await writeFile(`${folder}/failure.json`,JSON.stringify({error:String(error),notices,errors,records,requests},null,2));throw error;}finally{await browser.close();}
