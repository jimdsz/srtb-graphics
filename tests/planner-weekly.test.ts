import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planSchema,taskKey} from '../src/studio/day-planner-model';
import type {Plan,PlannerRow} from '../src/studio/day-planner-model';
import {moveWeeklyProgramme,patchPlannerProgramme,plannerWeekly,setPlannerIncluded,updatePlannerWeekly,weeklyChoices,weeklyProposalStart,weeklySelectionReview} from '../src/studio/planner-weekly';
import {plannerProject} from '../src/studio/day-planner-project';
const plan=():Plan=>({kind:'plan',name:'Semaine',source:'semaine.xlsx',sourceHash:'a'.repeat(64),rows:Array.from({length:7},(_,i):PlannerRow=>{
 const media={url:`local-media:${i+1}`.padEnd(76,String(i+1))+':100',name:`Programme ${i+1}.mp4`,mimeType:'video/mp4'};
 return {id:String(i),sheet:'Grille',cell:'B'+i,raw:'',title:`Programme ${i+1}`,subtitle:'',category:'Magazine',broadcastDate:`2026-09-${7+i<10?'0':''}${7+i}`,airDate:`2026-09-${7+i<10?'0':''}${7+i}`,time:`${12+i}:30:00`,duration:1800,included:true,kinds:['ba'],formats:['tv'],issues:[],media,location:null,excerpt:{source:media.url,start:10+i,end:20+i,duration:1800}};
})});

test('weekly settings preserve old lists and round-trip ordered selections and formats',()=>{
 const old=plan(),snapshot=JSON.stringify(old);assert.deepEqual(planSchema.parse(old),old);assert.deepEqual(plannerWeekly(old),{rowIds:[],formats:['tv']});assert.equal(JSON.stringify(old),snapshot);
 const next=updatePlannerWeekly(old,{rowIds:['3','1','6','2','0','5','4'],formats:['portrait','tv','vertical']});
 assert.deepEqual(planSchema.parse(JSON.parse(JSON.stringify(next))),next);assert.equal(JSON.stringify(old),snapshot);
 for(const weekly of [{rowIds:['0','0'],formats:['tv']},{rowIds:['missing'],formats:['tv']},{rowIds:[],formats:[]},{rowIds:[],formats:['tv','tv']},{rowIds:['0','1','2','3','4','5','6','7'],formats:['tv']}])assert.equal(planSchema.safeParse({...old,weekly}).success,false);
 assert.equal(planSchema.safeParse({...next,rows:next.rows.map(row=>({...row,included:false}))}).success,false);
});
test('weekly period round-trips without changing formats, voice or existing task identity',()=>{
 const old=updatePlannerWeekly(plan(),{rowIds:['0','1','2','3','4','5','6'],formats:['portrait','tv'],voice:{source:{url:'local-media:'+'a'.repeat(64)+':100',name:'semaine.wav',mimeType:'audio/wav'},sourceDuration:3,start:0,end:3,cue:'Cette semaine',confirmed:true,placement:{mode:'single',delay:1}}});
 assert.equal(weeklyProposalStart(old),'2026-09-07');const snapshot=JSON.stringify(old);
 const next=updatePlannerWeekly(old,{startDate:'2026-09-08'});
 assert.deepEqual(planSchema.parse(next),next);assert.equal(weeklyProposalStart(next),'2026-09-08');
 assert.deepEqual(next.weekly?.voice,old.weekly?.voice);assert.deepEqual(next.weekly?.formats,old.weekly?.formats);
 assert.deepEqual(weeklyChoices(next).map(taskKey),weeklyChoices(old).map(taskKey));assert.equal(JSON.stringify(old),snapshot);
 for(const startDate of ['','2026-02-29','2026-9-7','9999-12-26'])assert.equal(planSchema.safeParse({...old,weekly:{...old.weekly,startDate}}).success,false);
});
test('weekly date review warns without replacing deliberate duplicate-day or outside-period selections',()=>{
 const p=updatePlannerWeekly(plan(),{rowIds:['0','1','2','3','4','5','6'],formats:['tv'],startDate:'2026-09-07'});
 p.rows[0].airDate='2026-09-08';p.rows[6].airDate='2026-09-14';const before=structuredClone(p);
 assert.deepEqual(weeklySelectionReview(p),{startDate:'2026-09-07',endDate:'2026-09-13',missingDates:['2026-09-07','2026-09-13'],duplicateDates:['2026-09-08'],outsideRowIds:['6']});
 assert.equal(weeklyChoices(p).length,1);assert.deepEqual(p,before);
 p.rows.forEach(row=>row.airDate='2026-09-08');assert.equal(weeklyChoices(p).length,1);assert.ok(planSchema.safeParse(p).success);
 assert.deepEqual(weeklySelectionReview(plan()).missingDates,['2026-09-07','2026-09-08','2026-09-09','2026-09-10','2026-09-11','2026-09-12','2026-09-13']);
 const noPeriod=plan();noPeriod.rows.forEach(row=>row.broadcastDate='9999-12-31');assert.equal(weeklyProposalStart(noPeriod),'');assert.deepEqual(weeklySelectionReview(noPeriod).missingDates,[]);
});
test('weekly reorder is bounded, immutable and stable; exclusion removes only its selected slots',()=>{
 const ids=['0','1','2'];assert.deepEqual(moveWeeklyProgramme(ids,'0',1),['1','0','2']);assert.deepEqual(moveWeeklyProgramme(ids,'2',-1),['0','2','1']);
 for(const [id,dir]of [['0',-1],['2',1],['missing',1]] as const)assert.deepEqual(moveWeeklyProgramme(ids,id,dir),ids);
 assert.deepEqual(ids,['0','1','2']);const selected=updatePlannerWeekly(plan(),{rowIds:ids,formats:['vertical']});
 const edited=patchPlannerProgramme(selected,'0',{title:'Nouveau titre'});assert.deepEqual(edited.weekly,selected.weekly);
 const excluded=patchPlannerProgramme(selected,'1',{included:false});assert.deepEqual(excluded.weekly,{rowIds:['0','2'],formats:['vertical']});assert.deepEqual(excluded.rows[1].media,selected.rows[1].media);
 const batch=setPlannerIncluded(selected,['0','2'],false);assert.deepEqual(batch.weekly?.rowIds,['1']);assert.deepEqual(setPlannerIncluded(batch,['0','2'],true).weekly?.rowIds,['1']);assert.ok(planSchema.safeParse(batch).success);
});
test('weekly choices map all three formats to the exact ordered text, media and excerpt for all seven slots',()=>{
 const p=updatePlannerWeekly(plan(),{rowIds:['6','3','1','0','4','2','5'],formats:['tv','portrait','vertical']});
 const choices=weeklyChoices(p);assert.equal(choices.length,3);assert.equal(new Set(choices.map(taskKey)).size,3);
 for(const choice of choices){const result=plannerProject(p,choice);assert.equal(result.template.id,'BTV_Semainier');assert.equal(result.data._studio_format,choice.format);assert.ok(result.title.startsWith('Semainier · 2026-09-07 au 2026-09-13 · '));
  choice.rowIds.forEach((id,i)=>{const row=p.rows.find(r=>r.id===id)!;assert.equal(result.data[`programme_${i+1}_title`],row.title);assert.deepEqual(result.data[`_media_programme_${i+1}_url`],row.media);assert.equal(result.data[`_media_programme_${i+1}_start_seconds`],row.excerpt!.start);assert.equal(result.data[`_media_programme_${i+1}_end_seconds`],row.excerpt!.end);assert.ok(String(result.data[`programme_${i+1}_category`]).endsWith(row.time.slice(0,5).replace(':','h').toUpperCase()));});
 }
 assert.throws(()=>weeklyChoices(plan()),/sept programmes/);assert.throws(()=>updatePlannerWeekly(p,{rowIds:['absent']}),/retenu/);
});
