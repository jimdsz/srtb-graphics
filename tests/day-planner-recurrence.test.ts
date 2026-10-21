import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recurringProgramme} from '../src/studio/day-planner-recurrence';
import {describeProgramme} from '../src/studio/day-planner-import';
import {planSchema,programmeIdentity,ruleSchema} from '../src/studio/day-planner-model';
import type {Plan,PlannerRow,PlannerRecord,ProgrammeRule} from '../src/studio/day-planner-model';
import {applyRecipeChanges,recipeProposals,recipeMemoryCandidates,recipeMemoryRule} from '../src/studio/planner-recipes';
import {checkedPlannerPreparation} from '../src/studio/planner-validation';

const row=(raw:string,patch:Partial<PlannerRow>={}):PlannerRow=>{const described=describeProgramme(raw);return {id:raw,sheet:'Lundi',cell:'B2',raw,broadcastDate:'2026-09-07',airDate:'2026-09-07',time:'20:00:00',duration:1800,...described,kinds:[...described.kinds],formats:['tv'],media:null,location:null,...patch};};
const rule=(r:PlannerRow,kinds:ProgrammeRule['kinds']):PlannerRecord<ProgrammeRule>=>({id:'11111111-1111-4111-8111-111111111111',revision:2,archived:false,createdBy:'test',updatedBy:'test',updatedAt:'2026-09-28T00:00:00Z',data:{kind:'rule',name:r.title,programme:programmeIdentity(r),keywords:r.title,directoryId:null,preferredPath:null,kinds}});
const plan=(rows:PlannerRow[]):Plan=>({kind:'plan',name:'Lundi',source:'conducteur.xlsx',sourceHash:'a'.repeat(64),rows});

test('recognizes only daily news and weather service aliases, including accents and boundary live/repeat markers',()=>{
  for(const title of ['JT','J.T.','JT 13H','JT de 20 h 00','Journal','Le journal','JOURNAL TELEVISE DE 13H','JOURNAL TÉLÉVISÉ DE 20H','JOURNAL DE 23H30',"Bulletin d’information",'BULLETIN D’INFORMATIONS','Bulletin','Journal du soir','Journal édition de la mi-journée','JT en langues nationales']){
    for(const raw of [title,`DIRECT : ${title}`,`${title} (EN DIRECT)`,`REDIFFUSION ${title}`,`${title} / REDIFF`,`${title} + MÉTÉO + PAGE PUBLICITAIRE`]){
      assert.equal(recurringProgramme(raw)?.kind,'news',raw);const result=describeProgramme(raw);assert.equal(result.included,true,raw);assert.deepEqual(result.kinds,[],raw);assert.equal(result.category,'Information',raw);assert.ok(result.issues.some(message=>message.includes('vérifier les habillages existants')),raw);
    }
  }
  for(const raw of ['METEO','MÉTÉO (DIRECT)','La météo','Bulletin météo','Bulletin météorologique','Prévisions météorologiques','REDIFF MÉTÉO','MÉTÉO 20H00','Météo + PAGE PUBLICITAIRE']){
    assert.equal(recurringProgramme(raw)?.kind,'weather',raw);const result=describeProgramme(raw);assert.equal(result.included,true);assert.deepEqual(result.kinds,[]);assert.equal(result.category,'Météo');
  }
});

test('does not infer recurrence from arbitrary live programmes or titles containing journal, bulletin or météo',()=>{
  for(const raw of ['SPORT : BÉNIN – SÉNÉGAL (DIRECT)','FINALE DE LA COUPE EN DIRECT','DIRECT : CONSEIL MUNICIPAL','MAGAZINE : SUCCÈS EN DIRECT','Journal de voyage',"Le journal d’Anne Frank",'Le journal de la culture','FILM : LE JOURNAL','La météo des cultures','MÉTÉO DES CULTURES','Bulletin de santé','Magazine : MÉTÉO','Le direct','Journal de 99h','JT du festival','DOCUMENTAIRE : JOURNAL TELEVISE']){
    assert.equal(recurringProgramme(raw),null,raw);assert.deepEqual(describeProgramme(raw).kinds,['ba','popup'],raw);assert.equal(describeProgramme(raw).included,true,raw);
  }
  for(const raw of ['PAGE PUBLICITAIRE','BANDES ANNONCES','JINGLE'])assert.equal(describeProgramme(raw).included,false,raw);
});

test('retained recurrent rows need neither a media nor kinds to save or create another programme',()=>{
  const news=row('JOURNAL TÉLÉVISÉ DE 20H',{time:''}),sport=row('SPORT : FINALE EN DIRECT',{id:'sport'}),source=plan([news,sport]);
  assert.deepEqual(checkedPlannerPreparation(source,[sport.id]),source);assert.equal(planSchema.safeParse(source).success,true);
  const restored=planSchema.parse(JSON.parse(JSON.stringify(source)));assert.deepEqual(restored.rows[0].kinds,[]);assert.equal(restored.rows[0].raw,news.raw);
  const old=plan([row('Journal',{kinds:['popup']})]);assert.deepEqual(planSchema.parse(old),old,'opening a saved preparation does not rewrite its recipe');
});

test('explicit team recipes and manual choices override recurrence, and applying a recipe remains reversible',()=>{
  const news=row('Journal'),source=plan([news]),changes=recipeProposals(source.rows,[rule(news,['ba','tds'])]);
  assert.equal(changes.length,1);const applied=applyRecipeChanges(source,changes);assert.deepEqual(applied.plan.rows[0].kinds,['ba','tds']);assert.deepEqual(applyRecipeChanges(applied.plan,changes,true).plan,source);
  const manual=plan([{...news,kinds:['event']}]);assert.equal(applyRecipeChanges(manual,changes).applied.length,0);assert.deepEqual(manual.rows[0].kinds,['event']);
});

test('empty recipes can remember arbitrary live appointments without a file, while preserving exact existing media associations',()=>{
  const recurring=row('RENDEZ-VOUS EN DIRECT',{kinds:[]}),empty=recipeMemoryRule(recurring,undefined,true);
  assert.equal(ruleSchema.safeParse(empty).success,true);assert.deepEqual(empty.kinds,[]);assert.equal(empty.directoryId,null);assert.equal(empty.preferredPath,null);assert.equal(empty.family,'rendez vous en direct');
  const remembered={...rule(recurring,['ba']).data,directoryId:'22222222-2222-4222-8222-222222222222',preferredPath:'old/episode.mp4',keywords:'Matinale',family:'rendez vous en direct'};
  const changed=recipeMemoryRule(recurring,remembered);assert.equal(changed.directoryId,remembered.directoryId);assert.equal(changed.preferredPath,remembered.preferredPath);assert.equal(changed.keywords,'Matinale');assert.equal(changed.family,remembered.family);assert.deepEqual(changed.kinds,[]);
  const nextEpisode={...recurring,subtitle:'Épisode 2'},inherited=recipeMemoryRule(nextEpisode,remembered);assert.equal(inherited.preferredPath,null);assert.equal(inherited.directoryId,remembered.directoryId);assert.equal(inherited.family,undefined,'saving one new episode must not share its override with the family implicitly');
  assert.equal(recipeMemoryRule(nextEpisode,remembered,true).family,remembered.family,'new episode sharing remains an explicit choice');
  const candidates=recipeMemoryCandidates([row('RENDEZ-VOUS EN DIRECT')],[{...rule(recurring,[]),data:empty}]);assert.deepEqual(candidates[0].known?.kinds,[]);
  const proposals=recipeProposals([row('RENDEZ-VOUS EN DIRECT')],[{...rule(recurring,[]),data:empty}]);assert.deepEqual(proposals[0].after,[]);
});

test('memory candidates deduplicate a repeated conductor title and refuse conflicting decisions or team rules',()=>{
  const first=row('Journal'),second={...first,id:'second',time:'23:00:00'},known=rule(first,['popup']);
  assert.equal(recipeMemoryCandidates([first,second],[]).length,1);assert.equal(recipeMemoryCandidates([first,second],[])[0].conflict,false);
  assert.equal(recipeMemoryCandidates([first,{...second,kinds:['ba']}],[])[0].conflict,true);
  assert.equal(recipeMemoryCandidates([first],[known,{...known,id:'another'}])[0].conflict,true);
  assert.equal(recipeMemoryCandidates([{...first,included:false}],[]).length,0);
});
