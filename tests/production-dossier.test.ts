import test from 'node:test';
import assert from 'node:assert/strict';
import {dossierTaskState,productionDossier} from '../src/studio/production-dossier';
import {latestPlannerTask,taskKey} from '../src/studio/day-planner-model';
import type {PlannerTask,PlannerTaskChoice} from '../src/studio/day-planner-model';

const choice:PlannerTaskChoice={rowIds:['row-a'],kind:'ba',format:'tv'};
const task=(patch:Partial<PlannerTask>={},selected:PlannerTaskChoice=choice):PlannerTask=>({key:taskKey(selected),projectId:`project-${taskKey(selected)}`,title:'Même titre de programme',status:'draft',archived:false,sourceRevision:1,...patch});
const variants=(tasks:readonly PlannerTask[],rowId='row-a')=>productionDossier(rowId,tasks).groups.flatMap(group=>group.variants);

test('empty authorized ledger contains no inferred project or total',()=>{
  assert.deepEqual(productionDossier('row-a',[]),{groups:[],projectCount:0});
});
test('row identity is exact; another airing with the same title cannot enter the dossier',()=>{
  const own=task(),other=task({}, {...choice,rowIds:['row-ab']}),sameTitle=task({}, {...choice,rowIds:['other']});
  assert.deepEqual(variants([other,own,sameTitle]).map(v=>v.project),[own]);
  assert.deepEqual(productionDossier('ROW-A',[own]),{groups:[],projectCount:0});
});
test('encoded punctuation, accents and edition-looking row IDs remain exact identities',()=>{
  for(const rowId of ['Émission / A:B,C %','row-a:r2','row-a,row-b','%3A']){
    const saved=task({}, {...choice,rowIds:[rowId]});
    assert.equal(variants([saved],rowId)[0]?.project,saved);
    assert.equal(productionDossier('row-a',[saved]).projectCount,0);
  }
});
test('non-canonical and malformed keys cannot impersonate valid row links',()=>{
  const badKeys=['ba:tv:%72ow-a','ba:tv:row-a:r01','ba:tv:row-a:r1','ba:tv:row-a:r0','ba:tv:row-a:r2:extra','ba:tv:row-a,other','ba:tv:row-a:%','BA:tv:row-a','ba:unknown:row-a','ba:tv:%ZZ'];
  assert.equal(productionDossier('row-a',badKeys.map(key=>task({key}))).projectCount,0);
  assert.equal(productionDossier('a/b',[task({key:'ba:tv:a%2fb'})]).projectCount,0,'Lowercase escape is not protocol canonical');
});
test('ordinary and revisioned semainiers never enter individual-row totals',()=>{
  const weekly:PlannerTaskChoice={kind:'weekly',format:'tv',rowIds:['row-a','b','c','d','e','f','g']};
  assert.deepEqual(productionDossier('row-a',[task({},weekly),task({}, {...weekly,edition:3})]),{groups:[],projectCount:0});
});
test('current project agrees with latestPlannerTask and every older edition is retained',()=>{
  const original=task(),second=task({sourceRevision:2}, {...choice,edition:2}),latest=task({sourceRevision:5,archived:true}, {...choice,edition:5});
  const tasks=[second,latest,original],result=variants(tasks)[0];
  assert.equal(result.project,latestPlannerTask(choice,tasks));
  assert.equal(result.project,latest,'Archived current edition remains visible');
  assert.deepEqual(result.otherVersions,[second,original]);
  assert.equal(productionDossier('row-a',tasks).projectCount,3);
});
test('source revision then edition tie-break match existing reuse semantics, not project status',()=>{
  const base=task({sourceRevision:5,status:'approved'}),r2=task({sourceRevision:5}, {...choice,edition:2}),r3=task({sourceRevision:5}, {...choice,edition:3});
  const tasks=[r2,base,r3];
  assert.equal(variants(tasks)[0].project,latestPlannerTask(choice,tasks));
  assert.equal(variants(tasks)[0].project,r3);
  assert.deepEqual(variants(tasks)[0].otherVersions,[r2,base]);
});
test('removed recipe/format choices cannot hide ledger links; groups remain in stable kind/format order',()=>{
  const tasks=[task({}, {...choice,kind:'renvoi',format:'vertical'}),task({}, {...choice,format:'portrait'}),task(),task({}, {...choice,kind:'popup'})];
  const result=productionDossier('row-a',tasks);
  assert.deepEqual(result.groups.map(group=>group.kind),['ba','popup','renvoi']);
  assert.deepEqual(result.groups[0].variants.map(variant=>variant.format),['tv','portrait']);
  assert.equal(result.projectCount,4,'Helper depends on immutable row identity and ledger, not current recipe');
});
test('invalid empty project references and invalid source revisions are ignored',()=>{
  const invalid=[task({projectId:''}),task({projectId:' \t '}),...[0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1].map(sourceRevision=>task({sourceRevision}))];
  assert.deepEqual(productionDossier('row-a',invalid),{groups:[],projectCount:0});
  assert.equal(productionDossier('row-a',[...invalid,task()]).projectCount,1);
});
test('strict duplicate key/project pairs count once without merging unrelated references by title',()=>{
  const first=task(),second=task({projectId:'other-authorized-ledger-reference'});
  const result=productionDossier('row-a',[first,{...first},second]);
  assert.equal(result.projectCount,2);
  assert.equal(result.groups[0].variants[0].otherVersions.length,1);
});
test('the grouping does not mutate its caller ledger or manufacture external/private references',()=>{
  const own=Object.freeze(task()),other=Object.freeze(task({projectId:'private-not-this-row'}, {...choice,rowIds:['other']}));
  const tasks=Object.freeze([own,other]);
  const before=structuredClone(tasks),result=variants(tasks);
  assert.deepEqual(tasks,before);
  assert.deepEqual(result.flatMap(v=>[v.project,...v.otherVersions]).map(t=>t.projectId),[own.projectId]);
});
test('states are explicitly mapped; archive takes precedence and unknown values never echo',()=>{
  for(const [status,label]of Object.entries({draft:'Brouillon',submitted:'À valider',approved:'Validé',rejected:'À corriger'})){
    assert.deepEqual(dossierTaskState({status,archived:false}),{key:status,label});
    assert.deepEqual(dossierTaskState({status,archived:true}),{key:'archived',label:'Archivé'});
  }
  for(const status of ['<private-status>','exported','done','constructor','__proto__','toString',''])assert.deepEqual(dossierTaskState({status,archived:false}),{key:'unknown',label:'État à vérifier'});
});
