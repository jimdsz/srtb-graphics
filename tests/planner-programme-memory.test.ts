import test from 'node:test';
import assert from 'node:assert/strict';
import {plannerMemoryRule,plannerRuleQuery,programmeRules,resolveProgrammeRule} from '../src/studio/planner-rules';
import {programmeIdentity,ruleSchema} from '../src/studio/day-planner-model';
import type {PlannerRow,PlannerRecord,ProgrammeRule,DirectoryIndex,Plan} from '../src/studio/day-planner-model';
import {loadPlannerMediaCatalog} from '../src/studio/planner-media-workflow';
import type {plannerAPI} from '../src/studio/day-planner-api';
import {recipeProposals,applyRecipeChanges} from '../src/studio/planner-recipes';
import {mediaProposals} from '../src/studio/day-planner-assistant';
import {TeamMediaMatcher} from '../src/studio/planner-team-search';

const row=(episode:number):PlannerRow=>({id:`ep${episode}`,sheet:'Lundi',cell:'A2',raw:'',title:'Bonjour le Bénin',subtitle:`Épisode ${episode}`,category:'Magazine',broadcastDate:'2026-09-07',airDate:'2026-09-07',time:'06:30:00',duration:1800,included:true,kinds:['tds','renvoi'],formats:['tv'],issues:[],media:null,location:null});
const directory:PlannerRecord<DirectoryIndex>={id:'11111111-1111-4111-8111-111111111111',revision:1,archived:false,createdBy:'test',updatedBy:'test',updatedAt:'2026-09-25T00:00:00Z',data:{kind:'directory',name:'Matinale',scannedAt:'2026-09-25T00:00:00Z',partial:false,files:[{name:'Bonjour le Benin episode 1.mp4',path:'Bonjour le Benin episode 1.mp4',size:100,modified:1}]}};
const memory=(episode=1,reuse=true):PlannerRecord<ProgrammeRule>=>({...directory,id:`record-${episode}`,data:plannerMemoryRule(row(episode),directory.id,directory.data.files[0].path,reuse)});

test('a weekly-only programme remembers no individual graphics, without inventing BA or pop-up recipes',()=>{
 for(const reuse of [false,true]){
  const chosen={...row(1),kinds:[]},before=structuredClone(chosen);
  const data=plannerMemoryRule(chosen,directory.id,directory.data.files[0].path,reuse);
  assert.deepEqual(data.kinds,[]);
  const saved={...memory(),data:ruleSchema.parse(data)};
  assert.equal(saved.data.preferredPath,directory.data.files[0].path);
  assert.deepEqual(recipeProposals([chosen],[saved]),[]);
  const next=row(2),changes=recipeProposals([next],[saved]);
  assert.equal(changes.length,reuse?1:0);
  if(reuse){
   assert.deepEqual(changes[0].after,[]);
   const plan:Plan={kind:'plan',name:'Semainier seul',source:'test.xlsx',sourceHash:'a'.repeat(64),rows:[next],weekly:{rowIds:[next.id],formats:['tv']}};
   const applied=applyRecipeChanges(plan,changes);
   assert.deepEqual(applied.plan.rows[0],{...next,kinds:[]});
   assert.deepEqual(applied.plan.weekly,plan.weekly);
   assert.deepEqual(applyRecipeChanges(applied.plan,changes,true).plan,plan);
  }
  data.kinds.push('event');
  assert.deepEqual(chosen,before,'a remembered recipe must not alias the row choices');
 }
});

test('next-episode memory is opt-in, normalized and separate from the exact file association',()=>{
 const exact=memory(1,false),family=memory();
 assert.equal(ruleSchema.safeParse(family.data).success,true);assert.equal(ruleSchema.safeParse(exact.data).success,true);
 assert.equal(exact.data.family,undefined);assert.equal(family.data.family,'bonjour le benin');
 assert.equal(resolveProgrammeRule(row(2),programmeRules([exact])).data,undefined);
 const chosen=resolveProgrammeRule(row(2),programmeRules([family]));
 assert.equal(chosen.inherited,true);assert.equal(chosen.exact,undefined);assert.equal(chosen.data?.directoryId,directory.id);assert.equal(chosen.data?.preferredPath,null);
 assert.equal(family.data.preferredPath,directory.data.files[0].path);
 assert.deepEqual(plannerRuleQuery([row(1),row(2),row(1)]),{programmes:[programmeIdentity(row(1)),programmeIdentity(row(2))],families:['bonjour le benin']});
});

test('an old episode file is never promoted by a reused programme recipe',()=>{
 const rules=[memory()],next=row(2),before=structuredClone(next);
 const proposal=mediaProposals([next],directory,rules)[0];assert.equal(proposal.suggested,'');assert.equal(proposal.rule,undefined);
 assert.match(proposal.matches[0].reason,/Recette de l’émission/);assert.ok(proposal.matches[0].score<100);
 const matcher=new TeamMediaMatcher([next],rules);matcher.add(directory);assert.equal(matcher.result()[0].suggested,'');assert.deepEqual(next,before);
});

test('recurring recipes ignore file differences but require agreement on folder, search and kinds',()=>{
 const a=memory(),b=memory(2);b.data.preferredPath='other episode.mp4';
 for(const rules of [[a,b],[b,a]]){const result=resolveProgrammeRule(row(3),programmeRules(rules));assert.ok(result.data);assert.equal(result.data?.preferredPath,null);assert.equal(result.conflict,false);}
 for(const patch of [{directoryId:'22222222-2222-4222-8222-222222222222'},{keywords:'different search'},{kinds:['ba'] as ProgrammeRule['kinds']}]){
  const changed={...b,data:{...b.data,...patch}};
  for(const rules of [[a,changed],[changed,a]]){const result=resolveProgrammeRule(row(3),programmeRules(rules));assert.equal(result.data,undefined);assert.equal(result.conflict,true);assert.deepEqual(recipeProposals([row(3)],rules),[]);}
 }
});

test('exact choices outrank family suggestions; duplicates and archived choices do not become arbitrary defaults',()=>{
 const a=memory(),b=memory(2);b.data.kinds=['ba'];
 const exact=resolveProgrammeRule(row(2),programmeRules([a,b]));assert.equal(exact.exact,b);assert.equal(exact.conflict,false);assert.equal(exact.inherited,false);
 const duplicate={...a,id:'duplicate'};assert.equal(resolveProgrammeRule(row(3),programmeRules([a,duplicate])).conflict,true);
 assert.equal(resolveProgrammeRule(row(3),programmeRules([a,{...b,archived:true}])).conflict,false);
 assert.equal(resolveProgrammeRule({...row(3),title:'Autre émission'},programmeRules([a])).data,undefined);
});

test('recipe proposals for a new episode apply/undo only the kinds after explicit approval',()=>{
 const next={...row(2),kinds:['ba','popup'] as PlannerRow['kinds']},plan:Plan={kind:'plan',name:'Jour suivant',source:'test.xlsx',sourceHash:'a'.repeat(64),rows:[next]},before=structuredClone(plan);
 const changes=recipeProposals(plan.rows,[memory()]);assert.equal(changes.length,1);assert.equal(changes[0].inherited,true);assert.deepEqual(plan,before);
 const applied=applyRecipeChanges(plan,changes);assert.deepEqual(applied.plan.rows[0],{...next,kinds:['tds','renvoi']});assert.deepEqual(applyRecipeChanges(applied.plan,changes,true).plan,before);
});

test('individual picker retrieves the family folder without reusing the old write id or file',async()=>{
 const next=row(2),calls:unknown[]=[];
 const api={list:async()=>({documents:[],next:null}),rules:async(programmes:string[],_s:AbortSignal,families:string[])=>{calls.push({programmes,families});return {rules:[memory()]};},get:async()=>directory} as unknown as typeof plannerAPI;
 const result=await loadPlannerMediaCatalog(next,api,new AbortController().signal);
 assert.equal(result.directory?.id,directory.id);assert.equal(result.rule,null);assert.equal(result.recommendation?.preferredPath,null);assert.match(result.warning,/cet épisode/);
 assert.deepEqual(calls,[plannerRuleQuery([next])]);
});
