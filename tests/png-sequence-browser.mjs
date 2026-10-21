import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {unzipSync,strFromU8} from 'fflate';
const base=process.env.SRTB_QA_ORIGIN||'http://127.0.0.1:5193',browser=await chromium.launch({channel:'msedge',headless:true});
const reports=[],errors=[];
try{
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true}),page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  const response=await context.request.post(base+'/api/graphics/projects',{headers:{Origin:base},data:{title:'Recette PNG transparent',templateId:'BTV_PopUp',data:{_background_visible:false,_out_mode:'manual'}}});
  assert.ok(response.ok(),await response.text());const project=await response.json();
  await page.goto(base+'/tests/workspace-reliability.html?project='+project.id);
  await expect(page.getByRole('button',{name:'Lire l’aperçu',exact:true})).toBeEnabled({timeout:30000});
  await page.getByRole('button',{name:'Exporter',exact:true}).first().click();
  await expect(page.getByText('Sans transparence. Pour un fond transparent, choisissez MOV ou PNG.',{exact:true})).toBeVisible();
  await page.getByRole('radio',{name:'PNG · Séquence · ZIP · Transparence alpha',exact:true}).check();
  await page.getByText('Options · fond et son',{exact:false}).click();
  await page.getByLabel('Inclure les pistes sonores activées dans le projet').uncheck();
  await page.getByLabel('Déclencher OUT après (secondes)').fill('12');
  const started=Date.now(),event=page.waitForEvent('download',{timeout:180000});
  await page.getByRole('button',{name:'Télécharger la séquence PNG',exact:true}).click();
  const download=await event;assert.match(download.suggestedFilename(),/_PNG\.zip$/);
  const bytes=await readFile(await download.path()),files=unzipSync(bytes),manifest=JSON.parse(strFromU8(files['SEQUENCE.json']));
  assert.equal(manifest.frames,321);assert.equal(manifest.duration,12.84);assert.equal(manifest.fps,25);assert.equal(manifest.alpha,'straight');assert.equal(manifest.audio,null);assert.equal(files['audio.wav'],undefined);
  const names=Object.keys(files).filter(name=>name.endsWith('.png')).sort();assert.equal(names.length,321);assert.equal(names[0],'images/image_000001.png');assert.equal(names.at(-1),'images/image_000321.png');
  for(const file of manifest.files)assert.equal(createHash('sha256').update(files[file.path]).digest('hex'),file.sha256);
  const points=await page.evaluate(async data=>{
    const bitmap=await createImageBitmap(new Blob([new Uint8Array(data)],{type:'image/png'})),canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;const c=canvas.getContext('2d');c.drawImage(bitmap,0,0);bitmap.close();
    return {outside:c.getImageData(0,0,1,1).data[3],thumbnail:c.getImageData(1620,400,1,1).data[3],panel:c.getImageData(1620,640,1,1).data[3]};
  },[...files['images/image_000081.png']]);
  assert.deepEqual(points,{outside:0,thumbnail:255,panel:255});
  assert.equal((await (await context.request.get(base+'/api/graphics/projects/'+project.id)).json()).revision,project.revision);
  reports.push({test:'Actual UI download, 321 RGBA frames, OUT complete, hashes, transparent background and opaque thumbnail, unchanged draft',seconds:(Date.now()-started)/1000,bytes:bytes.length,points});
  await mkdir('reports/reliability',{recursive:true});await page.getByRole('region',{name:'Export vidéo'}).screenshot({path:'reports/reliability/png-export.png'});
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.getByRole('region',{name:'Export vidéo'}).screenshot({path:'reports/reliability/png-export-mobile.png'});
  // Cancellation happens while real frames are being written, not only before load.
  let downloads=0;page.on('download',()=>downloads++);
  await page.getByRole('button',{name:'Télécharger la séquence PNG',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:/PNG \d+ \/ /})).toBeVisible({timeout:30000});
  await page.getByRole('button',{name:'Annuler le rendu',exact:true}).click();await expect(page.getByText('Export annulé.',{exact:true})).toBeVisible({timeout:30000});assert.equal(downloads,0);
  const temporary=await page.evaluate(async()=>{const d=await(await navigator.storage.getDirectory()).getDirectoryHandle('srtb-temporary-exports');const names=[];for await(const name of d.keys())names.push(name);return names;});assert.deepEqual(temporary,[]);
  reports.push({test:'Cancel mid-sequence, no download and OPFS temporary file removed; mobile 390px fits'});
  // Local sound, decoded again from the actual produced ZIP. No media uploads.
  await page.goto(base+'/tests/preview-reliability.html');await expect(page.getByRole('button',{name:'Lire l’aperçu',exact:true})).toBeEnabled({timeout:30000});
  const audioResult=await page.evaluate(async()=>{
    const {pcm24Wav}=await import('/src/studio/video/sequence-format.ts'),{exportBroadcastVideo}=await import('/src/studio/video/export.ts');
    const {getTemplate,templateDefaults}=await import('/src/studio/domain.ts'),{resolveLocalData}=await import('/src/studio/local-media.ts'),{unzipSync}=await import('/node_modules/.vite/deps/fflate.js');
    const source=new AudioBuffer({length:48000,sampleRate:48000,numberOfChannels:2});for(let c=0;c<2;c++){const values=source.getChannelData(c);for(let i=0;i<values.length;i++)values[i]=Math.sin(2*Math.PI*440*i/48000)*.1;}
    const descriptor=await window.previewQA.bindLocalFile(new File([...pcm24Wav(source)],'son-local.wav',{type:'audio/wav'}),()=>{});
    const t=getTemplate('BTV_Relais_Antenne'),data={...templateDefaults(t),_audio_enabled:true,_audio_url:descriptor,_audio_loop:true,_audio_start_seconds:0,_audio_end_seconds:1,_audio_volume:1,_out_mode:'manual'};
    const out=await exportBroadcastVideo(t,resolveLocalData(t,data),{format:'png',audio:true,manualOut:1.4,removeBackground:true,background:'#000000'},new AbortController().signal,()=>{});
    try{const files=unzipSync(new Uint8Array(await out.blob.arrayBuffer())),ctx=new AudioContext(),decoded=await ctx.decodeAudioData(files['audio.wav'].slice().buffer);let peak=0;for(const x of decoded.getChannelData(0))peak=Math.max(peak,Math.abs(x));await ctx.close();return {report:out.report,audio:{duration:decoded.duration,channels:decoded.numberOfChannels,peak},files:Object.keys(files).length};}finally{await out.dispose();}
  });
  assert.equal(audioResult.report.frames,60);assert.equal(audioResult.audio.duration,2.4);assert.equal(audioResult.audio.channels,2);assert.ok(audioResult.audio.peak>.05);assert.equal(audioResult.files,63);
  reports.push({test:'Local WAV mixed and decoded from exported ZIP, aligned 2.4 seconds stereo 48 kHz',...audioResult});
  assert.deepEqual(errors,[]);await writeFile('reports/reliability/png-sequence.json',JSON.stringify({checkedAt:new Date().toISOString(),reports,errors},null,2));console.log(JSON.stringify(reports));
}finally{await browser.close();}
