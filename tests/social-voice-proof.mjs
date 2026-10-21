import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage();await page.route('**/api/**',route=>route.abort());
  await page.goto('http://127.0.0.1:5194/tests/social-motion-qualification.html');
  const results=await page.evaluate(async()=>{
    const {getTemplate,templateDefaults}=await import('/src/studio/domain.ts'),{prepareGraphic}=await import('/src/studio/video/engine.ts'),{audioEvents,mixAudio}=await import('/src/studio/video/audio.ts');
    const records=[];
    for(const id of ['BTV_BA_1P','BTV_BA_TDS']){
      const template=getTemplate(id),data={...templateDefaults(template),_studio_format:'portrait',_out_mode:'duration',_out_duration_seconds:id==='BTV_BA_1P'?12:15.28};
      for(const key of Object.keys(data)){
        if(/^_media_.+_url$/.test(key)){data[key]='/library/v1.7.0/BTV_Ce_Soir/lib/media/programme.jpg';data[key.slice(0,-4)+'_start_seconds']=0;data[key.slice(0,-4)+'_end_seconds']=30;}
        if(/^_media_.+_sequence$/.test(key))data[key]='[]';
        if(/^_media_.+_audio_enabled$/.test(key))data[key]=false;
      }
      data._audio_bed_enabled=true;data._audio_voice_enabled=true;data._audio_voice_url='/library/v1.7.0/BTV_BA_1P/sourceassets/VOIX SEMAINE.mp3.mpeg';
      if(id==='BTV_BA_1P'){data._audio_bed_gain=.15;data._audio_voice_gain=.1;}
      else Object.assign(data,{_background_visible:false,_audio_bed_volume:.15,_audio_voice_volume:.1,_audio_voice_start_seconds:3.2,_audio_voice_end_seconds:5.36,_audio_voice_delay_seconds:2.4});
      const prepared=await prepareGraphic(template,data,12,false,new AbortController().signal);
      try{
        const events=audioEvents(prepared,id,false).filter(event=>id==='BTV_BA_1P'?event.buffer===prepared.graphic.audio.buffers.voice.buffer:event.url?.includes('VOIX'));
        const mix=await mixAudio(events,prepared.timeline.duration,new AbortController().signal,()=>{});let energy=0,count=0;
        for(let channel=0;channel<mix.buffer.numberOfChannels;channel++)for(const event of events){const pcm=mix.buffer.getChannelData(channel);for(let index=Math.ceil((event.at+.08)*mix.buffer.sampleRate);index<Math.min(pcm.length,Math.floor((event.at+event.duration)*mix.buffer.sampleRate));index++){energy+=pcm[index]*pcm[index];count++;}}
        records.push({id,peak:mix.peak,rmsAfterAttack:Math.sqrt(energy/Math.max(1,count)),audible:mix.audible,measuredSamples:count,sampleRate:mix.buffer.sampleRate,voiceOnly:true,events:events.map(event=>({at:event.at,start:event.start,duration:event.duration,gainAtStart:event.gain(event.at),gainAfterAttack:event.gain(event.at+.08)}))});
      }finally{await prepared.dispose();}
    }
    return records;
  });
  for(const record of results){assert.ok(record.audible&&record.peak>1e-5&&record.rmsAfterAttack>1e-6);assert.ok(record.events.every(event=>event.gainAfterAttack===.1));}
  const directory=resolve('reports/social-motion-2026-09-30');await mkdir(directory,{recursive:true});await writeFile(resolve(directory,'voice-isolation.json'),JSON.stringify({status:'PASS',records:results},null,2));console.log(JSON.stringify(results));
}finally{await browser.close();}
