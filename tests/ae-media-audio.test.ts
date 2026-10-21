import test from 'node:test';
import assert from 'node:assert/strict';
import {aeMediaWindows,aeSocialTrackTimes} from '../src/studio/ae-media-timing';
import {installAEMediaAudio} from '../src/studio/ae-media-audio';
import {audioEvents} from '../src/studio/video/audio';
import {makeTimeline} from '../src/studio/video/timeline';
import {getTemplate,templateDefaults,validateProjectData} from '../src/studio/domain';
import type {ProjectData} from '../src/studio/domain';
import type {LegacyGraphic,PreparedGraphic,Track} from '../src/studio/video/engine';
import {packageDocuments} from '../src/studio/delivery-runtime';
import type {DeliveryPlan} from '../src/studio/delivery-plan';

const clip=(url:string,start=3,length=2)=>({type:'video',url,start,end:start+length,length});

test('AE source sound is explicit, bounded and silent by default in saved older projects',()=>{
  for(const id of ['BTV_Renvoi','BTV_Evenement','BTV_Semainier']){
    const template=getTemplate(id),data=validateProjectData(template,{});
    for(const key of Object.keys(template.fields).filter(key=>/^_media_.+_audio_enabled$/.test(key))){
      assert.equal(data[key],false);assert.equal(data[key.replace(/audio_enabled$/,'volume')],1);
      assert.equal(validateProjectData(template,{[key]:true})[key],true);
      assert.throws(()=>validateProjectData(template,{[key.replace(/audio_enabled$/,'volume')]:1.1}));
    }
  }
});

test('TV audio follows visible AE activation windows, including output holds and an early OUT',()=>{
  assert.deepEqual(aeMediaWindows('BTV_Evenement','intro',{activeStart:1.8,activeEnd:4.08},17.72,21.04),[{at:1.8,until:4.08,elapsed:0}]);
  assert.deepEqual(aeMediaWindows('BTV_Evenement','event',{activeStart:0,activeEnd:21.04},30,33.32),[{at:0,until:33.32,elapsed:0}]);
  assert.deepEqual(aeMediaWindows('BTV_Semainier','programme_7',{activeStart:17.4,activeEnd:21},18,21.08),[{at:17.4,until:18,elapsed:0}]);
  assert.deepEqual(aeMediaWindows('BTV_Semainier','final',{activeStart:19.8,activeEnd:25},4,7.08),[]);
});

test('social pictures and sound use the same weekly editorial transition points',()=>{
  const transitions=[['intro',0,2.96],['programme_1',2.96,5.4],['programme_2',5.4,7.8],['programme_7',17.4,19.8],['final',19.8,30]] as const;
  for(const [kind,start,end]of transitions){
    const at=start+.1;assert.equal(aeSocialTrackTimes('BTV_Semainier',at)?.[kind],at-start);
    assert.deepEqual(aeMediaWindows('BTV_Semainier',kind,{},26.92,30,true),[{at:start,until:end,elapsed:0}]);
  }
  assert.deepEqual(aeMediaWindows('BTV_Evenement','intro',{activeStart:1.8,activeEnd:4.08},17.72,21.04,true),[{at:0,until:21.04,elapsed:0}]);
});

test('offline AE sound concatenates cut source audio at the same clock and stops at silent image holds',()=>{
  const data:ProjectData={_out_mode:'duration',_out_duration_seconds:8,_media_renvoi_audio_enabled:true,_media_renvoi_volume:.5};
  const timeline=makeTimeline('BTV_Renvoi',data,{renvoi:5},8),track:Track={clips:[clip('red.mp4'),{...clip('still.jpg',0,1),type:'image'},clip('blue.mp4',7)],loop:false,length:5};
  const prepared={graphic:{},data,timeline,tracks:{renvoi:track}} as unknown as PreparedGraphic;
  const events=audioEvents(prepared,'BTV_Renvoi',false);
  assert.deepEqual(events.map(({url,at,start,duration})=>({url,at,start,duration})),[
    {url:'red.mp4',at:0,start:3,duration:2},{url:'blue.mp4',at:3,start:7,duration:2},
  ]);assert.equal(events[0].gain(0),.5);
  assert.deepEqual(audioEvents({...prepared,data:{...data,_media_renvoi_audio_enabled:false}},'BTV_Renvoi',false),[]);
  const tv={...prepared,tracks:{intro:{...track,activeStart:1.8,activeEnd:4.08}},data:{...data,_media_intro_audio_enabled:true},timeline:makeTimeline('BTV_Evenement',{...data,_out_duration_seconds:10},{},10)};
  const intro=audioEvents(tv,'BTV_Evenement',false);assert.equal(intro[0].at,1.8);assert.equal(intro[0].start,3);
  const social=audioEvents({...tv,data:{...tv.data,_studio_format:'vertical'}},'BTV_Evenement',false);assert.equal(social[0].at,0);
});

function node(){return {muted:true,volume:1,paused:true,seeking:false,plays:0,pauses:0,pause(){this.paused=true;this.pauses++;},play(){this.paused=false;this.plays++;return Promise.resolve();}};}
test('preview source sound only unmutes the displayed excerpt and pause/held tail stay silent',async()=>{
  const a=node(),b=node(),track={clips:[{...clip('a.mp4'),node:a},{...clip('b.mp4'),node:b}],loop:false,length:4};
  const g={playing:true,muted:false,disposed:false,elapsed:0,data:{_out_mode:'duration',_out_duration_seconds:8,_media_renvoi_audio_enabled:true,_media_renvoi_volume:.4},tracks:{renvoi:track},media:a,pause(){this.playing=false;},setMuted(value:boolean){this.muted=value;}} as unknown as LegacyGraphic;
  const audio=installAEMediaAudio(g,'BTV_Renvoi');audio.sync(1,true);await Promise.resolve();assert.equal(a.muted,false);assert.equal(a.volume,.4);assert.equal(b.muted,true);
  audio.sync(2.5,true);assert.equal(a.muted,true);assert.equal(b.muted,true);
  g.media=b;audio.sync(2.5,true);await Promise.resolve();assert.equal(b.muted,false);assert.equal(a.muted,true);
  audio.sync(4.1);assert.equal(b.muted,true);g.pause();assert.equal(a.paused,true);assert.equal(b.paused,true);
});

test('a late play completion cannot restart a replaced excerpt',async()=>{
  const a=node(),b=node();let complete!:()=>void;a.play=function(){this.paused=false;return new Promise<void>(resolve=>{complete=resolve;});};
  const g={playing:true,muted:false,disposed:false,data:{_out_mode:'duration',_out_duration_seconds:8,_media_renvoi_audio_enabled:true},tracks:{renvoi:{clips:[{...clip('a.mp4'),node:a},{...clip('b.mp4'),node:b}],loop:false,length:4}},media:a} as unknown as LegacyGraphic;
  const audio=installAEMediaAudio(g,'BTV_Renvoi');audio.sync(1,true);g.media=b;complete();await Promise.resolve();assert.equal(a.muted,true);assert.equal(a.paused,true);
});

test('portable output opts out of preview muting while preserving project sound toggles',()=>{
  const template=getTemplate('BTV_Renvoi'),data={...templateDefaults(template),_media_renvoi_audio_enabled:true};
  const docs=packageDocuments({data,project:{id:'test',revision:1,title:'Montage'}} as unknown as DeliveryPlan,template);
  assert.ok(docs['srtb-project.mjs'].includes("previewMuted:false"));assert.equal(JSON.parse(docs['PROJET.json']).data._media_renvoi_audio_enabled,true);
});
