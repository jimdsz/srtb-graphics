import test from 'node:test';
import assert from 'node:assert/strict';
import {plannerVoiceSchema} from '../src/studio/planner-voice-model';
import type {PlannerVoice} from '../src/studio/planner-voice-model';
import {plannerVoiceCue,plannerVoicePatch,selectedPlannerVoice} from '../src/studio/planner-voice';
import {plannerProject} from '../src/studio/day-planner-project';
import {planSchema,taskKey} from '../src/studio/day-planner-model';
import type {Plan,PlannerTaskChoice} from '../src/studio/day-planner-model';

const voice=(cue='Lundi',placement:PlannerVoice['placement']={mode:'ba-auto'}):PlannerVoice=>({source:{url:'local-media:'+'a'.repeat(64)+':100',name:'audio.wav',mimeType:'audio/wav'},sourceDuration:3.47,start:0,end:3.47,cue,confirmed:true,placement});
const plan=():Plan=>({kind:'plan',name:'Recette',source:'planning.xlsx',sourceHash:'b'.repeat(64),rows:Array.from({length:7},(_,i)=>({id:String(i),sheet:'Semaine',cell:'A'+i,raw:'',broadcastDate:'2026-09-07',airDate:'2026-09-07',time:'20:30',duration:1800,title:'Programme '+i,subtitle:'',category:'Magazine',included:true,issues:[],kinds:['ba','popup','tds','renvoi','event'],formats:['tv','portrait','vertical'],media:null,location:null}))});
test('old plans remain silent; only the explicitly chosen type inherits its voice in every format',()=>{
  const p=plan();planSchema.parse(p);
  for(const kind of ['ba','popup','tds','renvoi','event'] as const)assert.equal(plannerProject(p,{kind,format:'tv',rowIds:['0']}).data._audio_voice_enabled,false);
  p.rows[0].voices={ba:voice()};planSchema.parse(p);
  for(const format of ['tv','portrait','vertical'] as const){
    const data=plannerProject(p,{kind:'ba',format,rowIds:['0']}).data;
    assert.deepEqual(data._audio_voice_url,voice().source);assert.equal(data._audio_voice_enabled,true);
    assert.equal(data._audio_voice_in_seconds,0);assert.equal(data._audio_voice_out_seconds,3.47);
    assert.equal(data._studio_ba_voice_fit,'fit-complete');assert.ok(Math.abs(Number(data._audio_voice_intro_offset_seconds)-.89)<1e-9);
    assert.equal(data._audio_voice_outro_offset_seconds,68.48);assert.equal(data._audio_bed_enabled,false);
    assert.equal(plannerProject(p,{kind:'popup',format,rowIds:['0']}).data._audio_voice_enabled,false);
  }
});
test('single departures are exact in every non-BA type and weekly never inherits a programme voice',()=>{
  const p=plan();p.rows[0].voices={ba:voice(),popup:voice('Lundi',{mode:'single',delay:2.25}),tds:voice('Tout de suite',{mode:'single',delay:.8}),renvoi:voice('Lundi',{mode:'single',delay:1}),event:voice('Lundi',{mode:'single',delay:4})};
  for(const kind of ['popup','tds','renvoi','event'] as const)for(const format of ['tv','portrait','vertical'] as const){const v=p.rows[0].voices[kind]!,data=plannerProject(p,{kind,format,rowIds:['0']}).data;assert.equal(data._audio_voice_enabled,true);assert.equal(data._audio_voice_start_seconds,0);assert.equal(data._audio_voice_end_seconds,3.47);assert.equal(data._audio_voice_delay_seconds,v.placement.mode==='single'?v.placement.delay:NaN);}
  const choice:PlannerTaskChoice={kind:'weekly',format:'vertical',rowIds:p.rows.map(r=>r.id)};
  assert.equal(selectedPlannerVoice(p,choice),undefined);assert.equal(plannerProject(p,choice).data._audio_voice_enabled,false);
  p.weekly={rowIds:choice.rowIds,formats:['vertical'],voice:voice('Cette semaine',{mode:'single',delay:.5})};planSchema.parse(p);
  assert.equal(plannerProject(p,choice).data._audio_voice_delay_seconds,.5);
});
test('changing the day preserves the selection for review but cannot create a wrong announcement',()=>{
  const p=plan();p.rows[0].voices={ba:voice()};p.rows[0].airDate='2026-09-08';
  assert.equal(planSchema.parse(p).rows[0].voices?.ba?.cue,'Lundi');
  assert.throws(()=>plannerProject(p,{kind:'ba',format:'tv',rowIds:['0']}),/ne correspond plus/);
  p.rows[0].voices.ba=voice('Mardi');assert.equal(plannerProject(p,{kind:'ba',format:'tv',rowIds:['0']}).data._jour_1,'mardi');
  assert.throws(()=>plannerVoicePatch('tds',voice('Lundi',{mode:'single',delay:0})),/ne correspond plus/);
  assert.equal(plannerVoiceCue('ba','2026-09-07'),'Lundi');assert.equal(plannerVoiceCue('weekly'),'Cette semaine');
  for(const date of ['2026-02-30','2026-13-01','invalid',''])assert.equal(plannerVoiceCue('ba',date),'');
});
test('calage rejects silent cropping, mismatched placement and unconfirmed or foreign sources',()=>{
  assert.throws(()=>plannerVoicePatch('ba',{...voice(),sourceDuration:5,end:5},'2026-09-07'),/dépasse/);
  const manual=voice('Lundi',{mode:'ba-manual',intro:4,carton:1});
  assert.equal(plannerVoicePatch('ba',manual,'2026-09-07')._audio_voice_outro_offset_seconds,65.8);
  assert.throws(()=>plannerVoicePatch('ba',voice('Lundi',{mode:'single',delay:1}),'2026-09-07'),/départs/);
  assert.throws(()=>plannerVoicePatch('popup',voice(),'2026-09-07'),/un seul départ/);
  assert.throws(()=>plannerVoicePatch('popup',voice('Lundi',{mode:'single',delay:599}),'2026-09-07'),/après cet habillage/);
  for(const patch of [{confirmed:false},{end:5},{start:3.47},{source:{...voice().source,url:'https://elsewhere.example/a.wav'}},{source:{...voice().source,mimeType:'video/mp4'}}])assert.equal(plannerVoiceSchema.safeParse({...voice(),...patch}).success,false);
});
test('signature remains independent and voice changes never change the task identity',()=>{
  const p=plan(),choice:PlannerTaskChoice={kind:'ba',format:'tv',rowIds:['0']},key=taskKey(choice);p.rows[0].voices={ba:voice()};
  const data=plannerProject(p,{...choice,signature:true}).data;assert.equal(data._audio_voice_enabled,true);assert.equal(data._audio_bed_enabled,true);assert.equal(taskKey(choice),key);
});
