import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage();
await mkdir('reports/ae-live',{recursive:true});
try{
 await page.goto('http://127.0.0.1:5221/tests/preview-reliability.html');
 const report=[];
 for(const id of ['BTV_Renvoi','BTV_Evenement','BTV_Semainier'])for(const format of ['tv','vertical','portrait']){
  const result=await page.evaluate(async({id,format})=>{
   const {getTemplate,templateDefaults}=await import('/src/studio/domain.ts'),{prepareGraphic}=await import('/src/studio/video/engine.ts');
   const template=getTemplate(id),data={...templateDefaults(template),_studio_format:format,_audio_enabled:false};
   for(const key of Object.keys(data))if(key.startsWith('_media_')&&key.endsWith('_url'))data[key]={url:'/preview-media/v1/ba-programme.mp4',name:'Programme.mp4',mimeType:'video/mp4'};
   const graphic=await prepareGraphic(template,data,12,false,new AbortController().signal);
   try{
    const checks=[];let png='';
    for(const seconds of [.8,3.16,5.28,7,graphic.timeline.outAt+.5,graphic.timeline.duration-.04]){
     const canvas=await graphic.frame(Math.round(seconds*25),null),pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let opaque=0;
     for(let p=3;p<pixels.length;p+=4)if(pixels[p]>32)opaque++;
     checks.push({seconds,opaque});if(seconds===5.28)png=canvas.toDataURL('image/png');
    }
    return {id,format,checks,png,duration:graphic.timeline.duration};
   }finally{await graphic.dispose();}
  },{id,format});
  assert.ok(result.checks[2].opaque>10000,`${id} ${format}: visible exported frame`);
  await writeFile(`reports/ae-live/${id}-${format}-export.png`,Buffer.from(result.png.split(',')[1],'base64'));delete result.png;report.push(result);console.log(JSON.stringify(result));
 }
 await writeFile('reports/ae-live/frames.json',JSON.stringify({at:new Date().toISOString(),report},null,2));
}finally{await browser.close();}
