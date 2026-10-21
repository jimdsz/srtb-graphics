import test from 'node:test';
import assert from 'node:assert/strict';
import {planSchema,plannerFormats,plannerKinds} from '../src/studio/day-planner-model';
import type {Plan} from '../src/studio/day-planner-model';
import {plannerProject} from '../src/studio/day-planner-project';
import {compareConductors} from '../src/studio/conductor-diff';
import {overlayLogoSettings} from '../src/studio/logo-model';

const logo={url:'local-media:'+'a'.repeat(64)+':200',name:'Logo.png',mimeType:'image/png'};
const fixture=():Plan=>({kind:'plan',name:'Logo recette',source:'recette.xlsx',sourceHash:'a'.repeat(64),rows:Array.from({length:7},(_,i)=>({id:String(i),sheet:'RECETTE',cell:'A'+i,raw:'',title:'Émission '+i,subtitle:'Épisode 1',category:'Magazine',broadcastDate:'2026-09-28',airDate:'2026-09-28',time:'20:30:00',duration:1800,included:true,kinds:['ba'],formats:['tv'],issues:[],media:null,location:null}))});
for(const kind of plannerKinds)for(const format of plannerFormats)test(`confirmed logo uses the editable overlay, ${kind}/${format}`,()=>{
 const plan=fixture();plan.rows[0].logo=logo;const before=JSON.stringify(plan),{data}=plannerProject(plan,{kind,format,rowIds:['0']});
 const settings=overlayLogoSettings(data);assert.equal(settings.enabled,true);assert.deepEqual(settings.source,logo);assert.equal(settings.size,12);assert.equal(settings.motion,'none');
 assert.equal(data._studio_format,format);assert.equal(JSON.stringify(plan),before);
});
test('old plans remain unchanged and logo removal leaves no sample logo',()=>{
 const plan=fixture();assert.deepEqual(planSchema.parse(plan),plan);
 for(const value of [undefined,null]){plan.rows[0].logo=value;const data=plannerProject(plan,{kind:'ba',format:'tv',rowIds:['0']}).data;assert.equal(data._studio_overlay_logo_enabled,false);assert.equal(data._studio_overlay_logo_url,'');}
});
test('a programme logo is never repeated over the seven programmes of a semainier',()=>{
 const plan=fixture();for(const row of plan.rows)row.logo=logo;
 for(const format of plannerFormats){const {data}=plannerProject(plan,{kind:'weekly',format,rowIds:plan.rows.map(row=>row.id)});assert.equal(data._studio_overlay_logo_enabled,false);assert.equal(data._studio_overlay_logo_url,'');}
});
test('wrong media types and non-local external logos are rejected',()=>{
 for(const patch of [{mimeType:'video/mp4'},{mimeType:'image/svg+xml'},{url:'https://example.com/logo.png'},{url:'blob:unverified'}]){
  const plan=fixture();plan.rows[0].logo={...logo,...patch};assert.equal(planSchema.safeParse(plan).success,false);
 }
});
test('reimport keeps the chosen logo with its episode, without moving it to a new episode',()=>{
 const before=fixture();before.sourceRows=structuredClone(before.rows);before.rows[0].logo=logo;
 const incoming=fixture();incoming.sourceHash='b'.repeat(64);incoming.rows[0].id='moved';incoming.rows[0].time='21:00:00';
 let result=compareConductors(before,incoming);assert.deepEqual(result.plan.rows.find(row=>row.id==='0')!.logo,logo);
 incoming.rows[0].subtitle='Épisode 2';result=compareConductors(before,incoming);const fresh=result.plan.rows.find(row=>row.subtitle==='Épisode 2')!;
 assert.equal(fresh.logo,undefined);assert.equal(result.plan.rows.find(row=>row.id==='0')!.sourceRemoved,true);
});
