import test from 'node:test';
import assert from 'node:assert/strict';
import type {Plan,PlannerRow} from '../src/studio/day-planner-model';
import {applyPlannerLogoReview,reviewPlannerLogo,undoPlannerLogoChanges} from '../src/studio/planner-logo-reuse';

const programme='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const logo={url:'local-media:'+'a'.repeat(64)+':200',name:'Confirmé.png',mimeType:'image/png'};
const oldLogo={...logo,url:'local-media:'+'b'.repeat(64)+':300',name:'Choix manuel.png'};
function fixture(count=7):Plan {
 const rows:PlannerRow[]=Array.from({length:count},(_,i)=>({id:`r${i}`,sheet:'Mardi',cell:`B${i+2}`,raw:`Programme ${i}`,title:'Même titre',subtitle:`Épisode ${i}`,category:'Magazine',broadcastDate:'2026-09-29',airDate:i===1?'2026-09-30':'2026-09-29',time:i===1?'00:30:00':'20:30:00',duration:1800,included:true,kinds:['ba','popup'],formats:['tv','vertical'],issues:[],media:null,location:null,programmeId:programme,programmeRevision:1}));
 if(count>=7){rows[2].logo=oldLogo;rows[3].programmeId=other;rows[4].sourceRemoved=true;rows[5].included=false;delete rows[6].programmeId;delete rows[6].programmeRevision;}
 return {kind:'plan',name:'Recette indépendante',source:'Mardi.xlsx',sourceHash:'a'.repeat(64),rows,sourceRows:structuredClone(rows),weekly:{rowIds:[],formats:['tv']}};
}
test('identity, not homonymous labels: all dates but only retained explicit links',()=>{
 const plan=fixture(),choice=structuredClone(logo),review=reviewPlannerLogo(plan,'r0',choice);
 assert.deepEqual(review.rows.map(row=>row.id),['r0','r1','r2']);
 assert.equal(review.rows[1].airDate,'2026-09-30');
 plan.rows[0].title='Retouche après revue';choice.name='Nom objet modifié';
 assert.equal(review.rows[0].title,'Même titre');assert.equal(review.logo?.name,'Confirmé.png');
});
test('selection and replacement must be explicit; never mutate input/history/weekly/media',()=>{
 const plan=fixture(),before=structuredClone(plan),review=reviewPlannerLogo(plan,'r0',logo);
 const result=applyPlannerLogoReview(plan,review,['r0','r1','r2','r3','absent']);
 assert.deepEqual(result.changes.map(change=>change.after.id),['r0','r1']);
 assert.deepEqual(new Set(result.skipped),new Set(['r2','r3','absent']));assert.deepEqual(plan,before);
 assert.deepEqual(result.plan.rows[2].logo,oldLogo);assert.deepEqual(result.plan.sourceRows,plan.sourceRows);assert.deepEqual(result.plan.weekly,plan.weekly);
 for(let i=0;i<plan.rows.length;i++){const {logo:ignored,...row}=result.plan.rows[i],{logo:ignoredBefore,...expected}=plan.rows[i];assert.deepEqual(row,expected);}
});
test('replacement authorization alone does nothing; selected authorized row changes once',()=>{
 const plan=fixture(),review=reviewPlannerLogo(plan,'r0',logo);
 assert.equal(applyPlannerLogoReview(plan,review,[],['r2']).plan,plan);
 const result=applyPlannerLogoReview(plan,review,['r2','r2'],['r2']);
 assert.deepEqual(result.changes.map(change=>change.after.id),['r2']);assert.equal(result.plan.rows[0].logo,undefined);
});
test('partial concurrent edits exclude precisely changed targets and keep the rest',()=>{
 for(const patch of [{logo:oldLogo},{title:''},{time:'01:00:00'},{programmeRevision:2},{programmeId:other},{included:false},{sourceRemoved:true}]){
  const plan=fixture(),review=reviewPlannerLogo(plan,'r0',logo);Object.assign(plan.rows[1],patch);const before=structuredClone(plan.rows[1]);
  const result=applyPlannerLogoReview(plan,review,['r0','r1']);assert.equal(result.sourceChanged,false);
  assert.deepEqual(result.changes.map(change=>change.after.id),['r0']);assert.deepEqual(result.skipped,['r1']);assert.deepEqual(result.plan.rows[1],before);
 }
});
test('source reassign/revision/edit or reimport invalidates whole reviewed group',()=>{
 for(const change of [(plan:Plan)=>{plan.sourceHash='c'.repeat(64);},(plan:Plan)=>{plan.source='Autre.xlsx';},(plan:Plan)=>{plan.rows[0].title='Nouveau';},(plan:Plan)=>{plan.rows[0].programmeId=other;},(plan:Plan)=>{plan.rows[0].programmeRevision=2;}]){
  const plan=fixture(),review=reviewPlannerLogo(plan,'r0',logo);change(plan);
  const result=applyPlannerLogoReview(plan,review,['r0','r1']);assert.equal(result.plan,plan);assert.equal(result.sourceChanged,true);assert.equal(result.changes.length,0);
 }
});
test('removed candidates and later new occurrences cannot be silently included',()=>{
 const plan=fixture(),review=reviewPlannerLogo(plan,'r0',logo);plan.rows=plan.rows.filter(row=>row.id!=='r1');plan.rows.push({...plan.rows[0],id:'late'});
 const result=applyPlannerLogoReview(plan,review,['r0','r1','late']);assert.deepEqual(result.changes.map(change=>change.after.id),['r0']);assert.equal(result.plan.rows.at(-1)?.logo,undefined);assert.deepEqual(new Set(result.skipped),new Set(['r1','late']));
});
test('removal stays single even if a caller passes other programme IDs',()=>{
 const plan=fixture();plan.rows[0].logo=logo;plan.rows[1].logo=logo;
 const review=reviewPlannerLogo(plan,'r0',null),result=applyPlannerLogoReview(plan,review,['r0','r1'],['r1']);
 assert.deepEqual(review.rows.map(row=>row.id),['r0']);assert.equal(result.plan.rows[0].logo,null);assert.deepEqual(result.plan.rows[1].logo,logo);
});
test('undo restores only its own logo while preserving later editorial changes',()=>{
 const plan=fixture(),review=reviewPlannerLogo(plan,'r0',logo),applied=applyPlannerLogoReview(plan,review,['r0','r1','r2'],['r2']);
 applied.plan.rows[0].title='Retouche à conserver';applied.plan.rows[0].time='23:50:00';applied.plan.rows[1].logo=oldLogo;applied.plan.rows[2].programmeId=other;
 const before=structuredClone(applied.plan),undone=undoPlannerLogoChanges(applied.plan,review,applied.changes);
 assert.deepEqual(undone.changes.map(change=>change.after.id),['r0']);assert.equal(Object.hasOwn(undone.plan.rows[0],'logo'),false);assert.equal(undone.plan.rows[0].title,'Retouche à conserver');assert.equal(undone.plan.rows[0].time,'23:50:00');
 assert.deepEqual(undone.plan.rows.slice(1),before.rows.slice(1));assert.deepEqual(applied.plan,before);
});
test('undo restores exact undefined/null/absent and leaves reimport alone',()=>{
 for(const value of ['absent','undefined','null','old'] as const){
  const plan=fixture();if(value!=='absent')plan.rows[0].logo=value==='null'?null:value==='old'?oldLogo:undefined;
  const original=structuredClone(plan.rows[0]),review=reviewPlannerLogo(plan,'r0',logo),applied=applyPlannerLogoReview(plan,review,['r0']);
  assert.deepEqual(undoPlannerLogoChanges(applied.plan,review,applied.changes).plan.rows[0],original);
  applied.plan.sourceHash='c'.repeat(64);assert.equal(undoPlannerLogoChanges(applied.plan,review,applied.changes).plan,applied.plan);
 }
});
test('complete 600-row review and batch remain local; malformed row identity rejected',()=>{
 const plan=fixture(600),review=reviewPlannerLogo(plan,'r0',logo);assert.equal(review.rows.length,596);
 const result=applyPlannerLogoReview(plan,review,review.rows.map(row=>row.id));assert.equal(result.changes.length,595);
 assert.equal(undoPlannerLogoChanges(result.plan,review,result.changes).changes.length,595);
 plan.rows.push({...plan.rows[0],id:'extra'});assert.throws(()=>reviewPlannerLogo(plan,'r0',logo));plan.rows.pop();plan.rows[1].id='r0';assert.throws(()=>reviewPlannerLogo(plan,'r0',logo));
});
test('invalid and nonimage references cannot become a verified batch candidate',()=>{
 for(const patch of [{url:'https://untrusted.example/logo.png'},{mimeType:'video/mp4'},{mimeType:'image/svg+xml'}])assert.throws(()=>reviewPlannerLogo(fixture(),'r0',{...logo,...patch}));
});
