import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalRecipe,editedRecipeChange,explicitRecipeMemory,recipeEditorContext} from '../src/studio/planner-recipe-editor-model';
import {applyRecipeChanges,recipeMemoryRule} from '../src/studio/planner-recipes';
import {normalized,programmeIdentity} from '../src/studio/day-planner-model';
import type {Plan,PlannerRecord,PlannerRow,ProgrammeRule} from '../src/studio/day-planner-model';

const row=(patch:Partial<PlannerRow>={}):PlannerRow=>({id:'line',title:'Magazine de recette',subtitle:'Épisode 31',category:'Magazine',sheet:'Lundi',cell:'B3',raw:'Magazine',airDate:'2026-09-29',broadcastDate:'2026-09-29',time:'20:30:00',duration:1200,included:true,kinds:['ba','popup'],formats:['tv','portrait'],issues:[],media:null,location:null,...patch});
const directory='11111111-1111-4111-8111-111111111111';
const rule=(source=row(),patch:Partial<ProgrammeRule>={},id='22222222-2222-4222-8222-222222222222'):PlannerRecord<ProgrammeRule>=>({id,revision:4,archived:false,createdBy:'reviewer@example.test',updatedBy:'reviewer@example.test',updatedAt:'2026-09-29T12:00:00Z',data:{kind:'rule',name:source.title,programme:programmeIdentity(source),keywords:'Recherche éditoriale',directoryId:directory,preferredPath:'episodes/episode-31.mp4',kinds:['tds'],...patch}});

test('explicit recipe canonicalises choices including the intentionally empty recipe',()=>{
 assert.deepEqual(canonicalRecipe(['event','ba','ba']),['ba','event']);
 const result=explicitRecipeMemory(row(),[],'episode',[]);assert.deepEqual(result.data.kinds,[]);assert.equal(result.prior,null);assert.equal(result.data.preferredPath,null);assert.equal(result.data.directoryId,null);
});
test('explicit episode scope removes family while legacy false preserves it',()=>{
 const current=row(),known=rule(current,{family:normalized(current.title)}),before=structuredClone(known);
 const next=explicitRecipeMemory(current,['event'],'episode',[known]);
 assert.equal(next.data.family,undefined);assert.equal(next.narrows,true);assert.equal(next.prior?.id,known.id);
 assert.equal(recipeMemoryRule(current,known.data,false).family,known.data.family);assert.deepEqual(known,before);
});
test('editing exact recipe preserves folder, exact file, keyword and identity',()=>{
 const current=row(),known=rule();const next=explicitRecipeMemory(current,['event'],'episode',[known]);
 assert.deepEqual(next.data,{...known.data,kinds:['event']});
});
test('new exact episode inherits agreed folder but never previous episode file',()=>{
 const current=row({subtitle:'Épisode 32'}),known=rule(row(),{family:normalized(current.title)}),next=explicitRecipeMemory(current,['popup'],'episode',[known]);
 assert.equal(next.prior,null);assert.equal(next.inherited,true);assert.equal(next.data.programme,programmeIdentity(current));assert.equal(next.data.directoryId,directory);assert.equal(next.data.preferredPath,null);assert.equal(next.data.family,undefined);
});
test('programme edit addresses the existing unique family without copying its episode into the current row',()=>{
 const current=row({subtitle:'Épisode 32'}),known=rule(row(),{family:normalized(current.title)}),next=explicitRecipeMemory(current,['popup'],'programme',[known]);
 assert.equal(next.prior?.id,known.id);assert.equal(next.data.programme,known.data.programme);assert.equal(next.data.preferredPath,known.data.preferredPath);assert.equal(next.data.family,normalized(current.title));assert.equal(current.media,null);
});
test('programme review reports that an independent exact recipe stays prioritary',()=>{
 const current=row({subtitle:'Épisode 32'}),family=rule(row(),{family:normalized(current.title)}),exact=rule(current,{},'33333333-3333-4333-8333-333333333333');
 const next=explicitRecipeMemory(current,['popup'],'programme',[family,exact]);assert.equal(next.prior?.id,family.id);assert.equal(next.exactRemainsPrior,true);
});
test('multiple family sources require explicit reconciliation even if values agree',()=>{
 const a=rule(row(),{family:normalized(row().title)}),b=rule(row({subtitle:'Épisode 30'}),{family:normalized(row().title)},'33333333-3333-4333-8333-333333333333');
 assert.throws(()=>explicitRecipeMemory(row({subtitle:'Épisode 32'}),['ba'],'programme',[a,b]),/Plusieurs règles/);
});
test('ambiguous exact identities cannot become shared decisions',()=>{
 const a=rule(),b={...rule(),id:'33333333-3333-4333-8333-333333333333'};
 assert.throws(()=>explicitRecipeMemory(row(),['ba'],'episode',[a,b]),/contradictoires/);
});
test('contradictory versions of the same id fail closed',()=>{
 const a=rule();assert.throws(()=>recipeEditorContext(row(),[a,{...a,revision:5}]),/versions contradictoires/);
});
test('context comparison is stable across record order but detects revision and content changes',()=>{
 const current=row({subtitle:'Épisode 32'}),a=rule(row(),{family:normalized(current.title)}),b=rule(current,{},'33333333-3333-4333-8333-333333333333');
 const key=recipeEditorContext(current,[a,b]).key;assert.equal(key,recipeEditorContext(current,[b,a]).key);
 assert.notEqual(key,recipeEditorContext(current,[a,{...b,revision:5}]).key);
 assert.notEqual(key,recipeEditorContext(current,[a,{...b,data:{...b.data,keywords:'Autre'}}]).key);
});
test('removed, excluded and unnamed rows cannot be remembered',()=>{
 for(const patch of [{included:false},{sourceRemoved:true},{title:''}])assert.throws(()=>explicitRecipeMemory(row(patch),['ba'],'episode',[]),/programme retenu/);
});
test('local apply and undo preserve all unrelated row and plan fields',()=>{
 const media={url:'local-media:'+'a'.repeat(64)+':100',name:'Programme.mp4',mimeType:'video/mp4'},current=row({media,logo:{url:'local-media:'+'b'.repeat(64)+':20',name:'Logo.png',mimeType:'image/png'},location:{directoryId:directory,path:'exact.mp4',size:100,modified:1},excerpt:{source:media.url,start:2,end:12,duration:30}});
 const plan:Plan={kind:'plan',name:'Conducteur',source:'local.xlsx',sourceHash:'a'.repeat(64),rows:[current],sourceRows:[structuredClone(current)],weekly:{rowIds:[current.id],formats:['tv']}};
 const change=editedRecipeChange(current,['event']),applied=applyRecipeChanges(plan,[change]);assert.deepEqual(applied.plan,{...plan,rows:[{...current,kinds:['event']}]});assert.deepEqual(applyRecipeChanges(applied.plan,[change],true).plan,plan);
 const retouched={...applied.plan,rows:[{...applied.plan.rows[0],kinds:['renvoi'] as PlannerRow['kinds']}]};assert.equal(applyRecipeChanges(retouched,[change],true).applied.length,0);
});
test('apply and parent undo ignore rows removed by conductor reimport',()=>{
 const current=row(),change=editedRecipeChange(current,['event']);
 for(const undo of [false,true]){
  const removed={...current,sourceRemoved:true,kinds:undo?change.after:change.before};
  const plan:Plan={kind:'plan',name:'Conducteur',source:'local.xlsx',sourceHash:'a'.repeat(64),rows:[removed],sourceRows:[structuredClone(current)],weekly:{rowIds:[current.id],formats:['tv']}};
  const result=applyRecipeChanges(plan,[change],undo);assert.equal(result.plan,plan);assert.deepEqual(result.applied,[]);assert.deepEqual(result.plan.rows[0],removed);
 }
});
