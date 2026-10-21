import test from 'node:test';
import assert from 'node:assert/strict';
import type {Plan,PlannerRow} from '../src/studio/day-planner-model';
import {reviewPlannerLogo,applyPlannerLogoReview,undoPlannerLogoChanges} from '../src/studio/planner-logo-reuse';

const programme='11111111-1111-4111-8111-111111111111',otherProgramme='22222222-2222-4222-8222-222222222222';
const logo={url:'local-media:'+'a'.repeat(64)+':200',name:'Logo confirmé.png',mimeType:'image/png'},prior={...logo,url:'local-media:'+'b'.repeat(64)+':200',name:'Logo manuel.png'};
const fixture=(count=4):Plan=>({kind:'plan',name:'Préparation',source:'conducteur.xlsx',sourceHash:'a'.repeat(64),rows:Array.from({length:count},(_,index):PlannerRow=>({id:String(index),sheet:'Jour',cell:`A${index}`,raw:'source',title:'Magazine',subtitle:`Épisode ${index}`,category:'Magazine',broadcastDate:'2026-09-29',airDate:'2026-09-29',time:'20:30',duration:1800,included:true,kinds:['ba','popup'],formats:['tv','portrait'],issues:[],media:null,location:null,programmeId:programme,programmeRevision:index+1}))});

test('same durable programme identity only; excluded and removed rows stay out',()=>{
 const plan=fixture(7);plan.rows[1].title='Titre retouché';plan.rows[2].programmeId=otherProgramme;delete plan.rows[3].programmeId;plan.rows[4].included=false;plan.rows[5].sourceRemoved=true;
 const before=structuredClone(plan),review=reviewPlannerLogo(plan,'0',logo);
 assert.deepEqual(review.rows.map(row=>row.id),['0','1','6']);assert.deepEqual(review.rows.map(row=>row.programmeRevision),[1,2,7]);assert.deepEqual(plan,before);
 plan.rows[1].title='Autre retouche';logo.name='Logo confirmé.png';assert.equal(review.rows[1].title,'Titre retouché');
});
test('unlinked row and logo removal never create a group',()=>{
 const plan=fixture();delete plan.rows[0].programmeId;
 assert.equal(reviewPlannerLogo(plan,'0',logo).rows.length,1);
 plan.rows[0].programmeId=programme;plan.rows[0].logo=prior;
 const review=reviewPlannerLogo(plan,'0',null),result=applyPlannerLogoReview(plan,review,['0','1'],['1']);
 assert.equal(review.rows.length,1);assert.equal(result.plan.rows[0].logo,null);assert.equal(result.plan.rows[1].logo,undefined);assert.deepEqual(result.skipped,['1']);
});
test('empty selection is non-mutating and one selected row never propagates',()=>{
 const plan=fixture(),review=reviewPlannerLogo(plan,'0',logo);
 assert.equal(applyPlannerLogoReview(plan,review,[]).plan,plan);
 const result=applyPlannerLogoReview(plan,review,['0']);assert.equal(result.changes.length,1);assert.equal(result.plan.rows[1],plan.rows[1]);assert.equal(plan.rows[0].logo,undefined);
});
test('more than twenty occurrences remain explicitly selectable with no truncation',()=>{
 const plan=fixture(60),review=reviewPlannerLogo(plan,'0',logo),result=applyPlannerLogoReview(plan,review,review.rows.map(row=>row.id));
 assert.equal(review.rows.length,60);assert.equal(result.changes.length,60);assert.deepEqual(result.skipped,[]);assert.equal(result.plan.rows[59].logo?.name,logo.name);
});
test('existing logos require distinct per-row replacement consent',()=>{
 const plan=fixture();plan.rows[1].logo=prior;plan.rows[2].logo=prior;
 const review=reviewPlannerLogo(plan,'0',logo),result=applyPlannerLogoReview(plan,review,['0','1','2'],['1']);
 assert.deepEqual(result.changes.map(change=>change.after.id),['0','1']);assert.deepEqual(result.skipped,['2']);assert.deepEqual(result.plan.rows[2].logo,prior);
 assert.equal(applyPlannerLogoReview(plan,review,['0'],['1']).plan.rows[1],plan.rows[1]);
});
test('source existing logo may be explicitly replaced; same asset is a no-op',()=>{
 const plan=fixture();plan.rows[0].logo=prior;plan.rows[1].logo=logo;
 const result=applyPlannerLogoReview(plan,reviewPlannerLogo(plan,'0',logo),['0','1'],['1']);
 assert.deepEqual(result.changes.map(change=>change.after.id),['0']);assert.deepEqual(result.skipped,[]);
});
for(const [name,patch]of Object.entries({reassigned:{programmeId:otherProgramme},revision:{programmeRevision:9},manualLogo:{logo:prior},episode:{subtitle:'Retouché'},time:{time:'21:00'},media:{media:prior},voice:{voices:{}},removed:{sourceRemoved:true},excluded:{included:false}}))test(`concurrent ${name} is kept, other selected occurrences can be applied`,()=>{
 const plan=fixture(),review=reviewPlannerLogo(plan,'0',logo);Object.assign(plan.rows[1],patch);const edited=structuredClone(plan.rows[1]);
 const result=applyPlannerLogoReview(plan,review,['0','1','2'],['1']);assert.deepEqual(result.plan.rows[1],edited);assert.deepEqual(result.skipped,['1']);assert.deepEqual(result.changes.map(change=>change.after.id),['0','2']);
});
test('source row changed or source reimported refuses the entire review',()=>{
 for(const edit of [(p:Plan)=>{p.rows[0].subtitle='Autre épisode';},(p:Plan)=>{p.sourceHash='b'.repeat(64);},(p:Plan)=>{p.rows[0].programmeRevision=99;},(p:Plan)=>{p.rows.shift();}]){
  const plan=fixture(),review=reviewPlannerLogo(plan,'0',logo);edit(plan);const result=applyPlannerLogoReview(plan,review,['0','1']);
  assert.equal(result.sourceChanged,true);assert.equal(result.plan,plan);assert.equal(result.changes.length,0);
 }
});
test('invalid image, unknown/removed source and duplicate row IDs are rejected',()=>{
 assert.throws(()=>reviewPlannerLogo(fixture(),'unknown',logo));
 const plan=fixture();plan.rows[0].sourceRemoved=true;assert.throws(()=>reviewPlannerLogo(plan,'0',logo));
 for(const patch of [{mimeType:'video/mp4'},{url:'https://example.test/logo.png'},{mimeType:'image/svg+xml'}])assert.throws(()=>reviewPlannerLogo(fixture(),'0',{...logo,...patch}));
 const duplicate=fixture();duplicate.rows[1].id='0';assert.throws(()=>reviewPlannerLogo(duplicate,'0',logo));
});
test('apply affects only logo; original sourceRows, weekly settings, episodes and assets stay identical',()=>{
 const plan=fixture();plan.sourceRows=structuredClone(plan.rows);plan.rows[0].media=prior;plan.rows[1].location={directoryId:'11111111-1111-4111-8111-111111111111',path:'Dossier/Épisode',size:200,modified:1};
 const before=structuredClone(plan),review=reviewPlannerLogo(plan,'0',logo),result=applyPlannerLogoReview(plan,review,['0','1']);
 const strip=(p:Plan)=>({...p,rows:p.rows.map(({logo:_logo,...rest})=>rest)});
 assert.deepEqual(strip(result.plan),strip(before));assert.deepEqual(plan,before);assert.equal(result.plan.sourceRows,plan.sourceRows);
});
test('undo restores exact absent/null/existing logo without overwriting later unrelated edits',()=>{
 const plan=fixture();plan.rows[1].logo=null;plan.rows[2].logo=prior;
 const review=reviewPlannerLogo(plan,'0',logo),applied=applyPlannerLogoReview(plan,review,['0','1','2'],['2']);
 applied.plan.rows[0]={...applied.plan.rows[0],title:'Retouche ultérieure',subtitle:'Épisode suivant',time:'23:15',media:prior};
 const result=undoPlannerLogoChanges(applied.plan,review,applied.changes);
 assert.equal(result.changes.length,3);assert.equal(Object.hasOwn(result.plan.rows[0],'logo'),false);assert.equal(result.plan.rows[1].logo,null);assert.deepEqual(result.plan.rows[2].logo,prior);
 assert.equal(result.plan.rows[0].title,'Retouche ultérieure');assert.equal(result.plan.rows[0].time,'23:15');assert.deepEqual(result.plan.rows[0].media,prior);
});
test('undo preserves a newer logo, reassignment, changed revision, and removed rows',()=>{
 const plan=fixture(6),review=reviewPlannerLogo(plan,'0',logo),applied=applyPlannerLogoReview(plan,review,review.rows.map(row=>row.id));
 applied.plan.rows[0].logo=prior;applied.plan.rows[1].programmeId=otherProgramme;applied.plan.rows[2].programmeRevision=100;applied.plan.rows[3].sourceRemoved=true;applied.plan.rows[4].included=false;
 const result=undoPlannerLogoChanges(applied.plan,review,applied.changes);
 assert.deepEqual(result.changes.map(change=>change.after.id),['5']);assert.deepEqual(result.skipped,['0','1','2','3','4']);
 assert.deepEqual(result.plan.rows.slice(0,5),applied.plan.rows.slice(0,5));
});
test('undo does not cross a reimport or restore missing rows; replay cannot clobber newer state',()=>{
 const plan=fixture(),review=reviewPlannerLogo(plan,'0',logo),applied=applyPlannerLogoReview(plan,review,['0','1']);
 const once=undoPlannerLogoChanges(applied.plan,review,applied.changes),twice=undoPlannerLogoChanges(once.plan,review,applied.changes);
 assert.equal(twice.plan,once.plan);assert.equal(twice.changes.length,0);
 const reimported={...applied.plan,sourceHash:'different'};assert.equal(undoPlannerLogoChanges(reimported,review,applied.changes).plan,reimported);
 applied.plan.rows=applied.plan.rows.filter(row=>row.id!=='1');assert.deepEqual(undoPlannerLogoChanges(applied.plan,review,applied.changes).skipped,['1']);
});
