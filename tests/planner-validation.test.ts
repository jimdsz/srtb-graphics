import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkedPlannerPreparation,PlannerPreparationError,plannerProblemLocation} from '../src/studio/planner-validation';
import type {Plan,PlannerRow} from '../src/studio/day-planner-model';

const row=(i=0):PlannerRow=>({id:String(i),sheet:'Lundi',cell:`A${i+1}`,raw:'',title:`Émission ${i+1}`,subtitle:'',category:'Magazine',broadcastDate:'2026-09-07',airDate:'2026-09-07',time:`${String(Math.floor(i/60)).padStart(2,'0')}:${String(i%60).padStart(2,'0')}:00`,duration:1800,included:true,kinds:['ba'],formats:['tv'],media:null,location:null,issues:[]});
const plan=():Plan=>({kind:'plan',name:'La journée',source:'conducteur.xlsx',sourceHash:'a'.repeat(64),rows:[row()]});
function errorOf(p:Plan,ids:string[]=[]){try{checkedPlannerPreparation(p,ids);}catch(e){assert.ok(e instanceof PlannerPreparationError);return e;}throw Error('Expected validation failure');}

test('a valid preparation round-trips without changing media or any editorial value',()=>{
 const p=plan();p.rows[0].media={url:'local-media:'+'a'.repeat(64)+':100',name:'Local.mp4',mimeType:'video/mp4'};
 p.rows[0].excerpt={source:p.rows[0].media.url,start:12,end:24,duration:3600};
 const snapshot=JSON.stringify(p);assert.deepEqual(checkedPlannerPreparation(p,['0']),p);assert.equal(JSON.stringify(p),snapshot);
});
test('the UI reports empty formats in French with the affected programme, never a schema dump',()=>{
 const p=plan();p.rows[0].formats=[];const error=errorOf(p);
 assert.equal(error.rowId,'0');assert.equal(error.field,'formats');assert.match(error.message,/Émission 1.*2026-09-07.*Choisissez au moins un format/);
 assert.doesNotMatch(error.message,/too_small|minimum|origin|Zod|expected/);
});
test('missing titles, dates and preparation names have actionable field targets',()=>{
 for(const [field,value,pattern]of [['title','',/Renseignez le titre/],['title','   ',/Renseignez le titre/],['airDate','',/date réelle/],['airDate','2026-02-30',/date réelle/],['subtitle','x'.repeat(401),/400/],['category','x'.repeat(81),/80/]] as const){
  const p=plan();p.rows[0][field]=value;const error=errorOf(p);assert.equal(error.rowId,'0');assert.equal(error.field,field);assert.match(error.message,pattern);
 }
 const p=plan();p.name='  ';const error=errorOf(p);assert.equal(error.rowId,undefined);assert.equal(error.field,'name');assert.match(error.message,/nom à la préparation/);
});
test('unfinished hours may be saved, but creating their graphics points back to the correct row',()=>{
 const p=plan();p.rows.push(row(1));p.rows[0].time='';
 assert.deepEqual(checkedPlannerPreparation(p),p);assert.deepEqual(checkedPlannerPreparation(p,['1']),p);
 const error=errorOf(p,['0']);assert.equal(error.rowId,'0');assert.equal(error.field,'time');assert.match(error.message,/heure de diffusion/);
});
test('invalid excerpts retain their exact source and edits when validation refuses the write',()=>{
 const p=plan();p.rows[0].media={url:'local-media:'+'a'.repeat(64)+':100',name:'Local.mp4',mimeType:'video/mp4'};
 p.rows[0].excerpt={source:'other-source',start:10,end:20,duration:30};
 const snapshot=JSON.stringify(p),error=errorOf(p);assert.equal(error.rowId,'0');assert.equal(error.field,'excerpt');assert.match(error.message,/passage/);assert.equal(JSON.stringify(p),snapshot);
});
test('locating an error selects the correct sorted page, including excluded rows, without modifying the plan',()=>{
 const p=plan();p.rows=Array.from({length:45},(_,i)=>row(i));p.rows.reverse();const snapshot=JSON.stringify(p);
 assert.deepEqual(plannerProblemLocation(p,new PlannerPreparationError('','title','25')),{day:'2026-09-07',page:1,excluded:false});
 assert.equal(JSON.stringify(p),snapshot);
 p.rows.find(r=>r.id==='25')!.included=false;
 assert.deepEqual(plannerProblemLocation(p,new PlannerPreparationError('','title','25')),{day:'2026-09-07',page:1,excluded:true});
 assert.equal(plannerProblemLocation(p,new PlannerPreparationError('','name')),null);
});
