import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyRecipeChanges,recipeProposals} from '../src/studio/planner-recipes';
import {programmeIdentity,linkedTasksForRow,taskKey} from '../src/studio/day-planner-model';
import type {Plan,PlannerRow,PlannerRecord,ProgrammeRule,PlannerTask,PlannerTaskChoice} from '../src/studio/day-planner-model';
const row=(patch:Partial<PlannerRow>={}):PlannerRow=>({id:'programme',sheet:'LUNDI',cell:'A2',raw:'Magazine',title:'Bonjour le Bénin',subtitle:'Épisode 31',category:'Magazine',airDate:'2026-09-07',broadcastDate:'2026-09-07',time:'06:30:00',duration:1800,included:true,issues:[],kinds:['ba','popup'],formats:['tv','vertical'],media:null,location:null,...patch});
const plan=(rows:PlannerRow[]):Plan=>({kind:'plan',name:'Lundi',source:'conducteur.xlsx',sourceHash:'a'.repeat(64),rows,weekly:{rowIds:[rows[0].id],formats:['tv']}});
const rule=(r:PlannerRow,kinds:ProgrammeRule['kinds']=['tds','renvoi']):PlannerRecord<ProgrammeRule>=>({id:'11111111-1111-4111-8111-111111111111',revision:2,archived:false,createdBy:'designer@example.test',updatedBy:'designer@example.test',updatedAt:'2026-09-25T00:00:00Z',data:{kind:'rule',name:r.title,programme:programmeIdentity(r),keywords:r.title,directoryId:null,preferredPath:null,kinds}});

test('recipes only propose changes for exact included programme/episode and never mutate inputs',()=>{
  const r=row(),source=plan([r,row({id:'different',subtitle:'Épisode 32'}),row({id:'excluded',included:false})]),before=structuredClone(source);
  const result=recipeProposals(source.rows,[rule(r)]);
  assert.equal(result.length,1);assert.equal(result[0].rowId,r.id);assert.deepEqual(result[0].after,['tds','renvoi']);assert.deepEqual(source,before);
  assert.equal(recipeProposals([r],[rule(r,['popup','ba'])]).length,0,'same set in another order is not a change');
});
test('invalid, archived and ambiguous recipes cannot become automatic suggestions',()=>{
  const r=row(),known=rule(r);
  for(const rules of [[{...known,archived:true}],[known,{...known,id:'other'}],[{...known,data:{...known.data,kinds:['invalid']}}]])assert.equal(recipeProposals([r],rules as PlannerRecord<ProgrammeRule>[]).length,0);
});
test('apply and undo change only kinds, preserving formats, exact media, excerpts and weekly order',()=>{
  const url='local-media:'+'b'.repeat(64)+':100',r=row({media:{url,name:'BLB.mp4',mimeType:'video/mp4'},excerpt:{source:url,start:12,end:18,duration:1800}}),source=plan([r]),before=structuredClone(source),changes=recipeProposals([r],[rule(r)]);
  const applied=applyRecipeChanges(source,changes);assert.equal(applied.applied.length,1);assert.deepEqual(applied.plan.rows[0],{...r,kinds:['tds','renvoi']});assert.deepEqual(applied.plan.weekly,source.weekly);assert.deepEqual(source,before);
  assert.deepEqual(applyRecipeChanges(applied.plan,changes,true).plan,source);
});
test('a stale proposal cannot overwrite a renamed, excluded or manually edited row',()=>{
  const r=row(),changes=recipeProposals([r],[rule(r)]);
  for(const updated of [row({title:'Autre émission'}),row({included:false}),row({kinds:['event']})]){const source=plan([updated]);const result=applyRecipeChanges(source,changes);assert.equal(result.applied.length,0);assert.equal(result.plan,source);}
});
test('undo preserves subsequent manual changes and unrelated edits',()=>{
  const a=row(),b=row({id:'second'}),source=plan([a,b]),changes=recipeProposals(source.rows,[rule(a)]);
  const applied=applyRecipeChanges(source,changes).plan;applied.rows[0]={...applied.rows[0],kinds:['event']};applied.rows[1]={...applied.rows[1],time:'10:15:00',formats:['portrait']};
  const result=applyRecipeChanges(applied,changes,true);assert.equal(result.applied.length,1);assert.deepEqual(result.plan.rows[0].kinds,['event']);assert.deepEqual(result.plan.rows[1],{...b,time:'10:15:00',formats:['portrait']});
});

test('existing linked projects remain accessible independently of the current recipe and formats',()=>{
  const id='Programme:1,épisode',task=(kind:PlannerTaskChoice['kind'],format:PlannerTaskChoice['format'],rowIds=[id]):PlannerTask=>({key:taskKey({kind,format,rowIds}),projectId:kind+format,title:'Habillage',status:'draft',archived:false,sourceRevision:1});
  const ba=task('ba','vertical'),popup=task('popup','tv'),other=task('ba','tv',['other']),weekly=task('weekly','tv');
  assert.deepEqual(linkedTasksForRow(id,[ba,popup,other,weekly]),[ba,popup]);
  assert.deepEqual(linkedTasksForRow('missing',[ba,popup,other,weekly]),[]);
});
