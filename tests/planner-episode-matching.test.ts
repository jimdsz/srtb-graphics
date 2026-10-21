import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaProposals} from '../src/studio/day-planner-assistant';
import {TeamMediaMatcher} from '../src/studio/planner-team-search';
import {programmeIdentity} from '../src/studio/day-planner-model';
import {mediaEpisodeHint} from '../src/studio/day-planner-media-episode';
import type {DirectoryIndex,PlannerRecord,PlannerRow,ProgrammeRule} from '../src/studio/day-planner-model';

const row=(subtitle='N°10'):PlannerRow=>({id:'ntc',title:'NTC',subtitle,sheet:'Lundi',cell:'B1',raw:'',category:'Magazine',broadcastDate:'2026-08-31',airDate:'2026-08-31',time:'09:00:00',duration:1800,included:true,kinds:['ba'],formats:['tv'],issues:[],media:null,location:null});
const directory=(...paths:string[]):PlannerRecord<DirectoryIndex>=>({id:'11111111-1111-4111-8111-111111111111',revision:1,createdBy:'test',updatedBy:'test',updatedAt:'2026-09-26T00:00:00Z',archived:false,data:{kind:'directory',name:'NTC',scannedAt:'2026-09-26T00:00:00Z',partial:false,files:paths.map(path=>({path,name:path.split('/').at(-1)!,size:100,modified:1}))}});
function proposals(r:PlannerRow,d:PlannerRecord<DirectoryIndex>,rules:PlannerRecord<ProgrammeRule>[]=[]){
 const single=mediaProposals([r],d,rules)[0],matcher=new TeamMediaMatcher([r],rules);matcher.add(d);const team=matcher.result()[0];
 return {single,team};
}
test('episode spellings and leading zeros select the correct candidate in single and team searches',()=>{
 for(const label of ['N°10','Nº 010','Épisode 10','10'])for(const name of ['NTC EP010.mp4','NTC épisode 010.mp4','NTC N°10.mp4','NTC 010.mp4']){
  const {single,team}=proposals(row(label),directory(name));assert.equal(single.suggested,name,`${label} / ${name}`);assert.ok(team.suggested,`${label} / ${name}`);
 }
});
test('a date or version number cannot impersonate the requested episode',()=>{
 for(const path of ['NTC EP030 31-08-2026.mp4','NTC EP030 V31.mp4','NTC 31-08-2026.mp4','Archives 31/NTC EP030.mp4']){
  const {single,team}=proposals(row('Épisode 31'),directory(path));assert.equal(single.suggested,'',path);assert.equal(team.suggested,'',path);assert.equal(single.matches.length,1);assert.match(single.matches[0].reason,/épisode|Épisode/);
 }
});
test('seasons are explicit and ambiguous episode paths remain manual',()=>{
 const correct='NTC S02E010.mp4';const p=proposals(row('Saison 2 épisode 10'),directory('NTC S01E010.mp4',correct));assert.equal(p.single.suggested,correct);assert.ok(p.team.suggested.includes(correct));
 for(const path of ['NTC S01E010.mp4','NTC E10.mp4','Saison 1/NTC S02E10.mp4','NTC E10-E11.mp4','NTC E10-11.mp4','Episode 11/NTC E10.mp4']){
  const {single,team}=proposals(row('Saison 2 épisode 10'),directory(path));assert.equal(single.suggested,'',path);assert.equal(team.suggested,'',path);
 }
});
test('an exact remembered choice with an unnumbered filename remains usable; a contradictory number stays manual',()=>{
 const r=row(),d=directory('programme-validé.mp4');
 const rule:PlannerRecord<ProgrammeRule>={...d,data:{kind:'rule',name:r.title,programme:programmeIdentity(r),keywords:r.title,directoryId:d.id,preferredPath:d.data.files[0].path,kinds:['ba']}};
 assert.equal(proposals(r,d,[rule]).single.suggested,'programme-validé.mp4');
 const wrong=directory('NTC EP011.mp4'),wrongRule={...rule,data:{...rule.data,preferredPath:wrong.data.files[0].path}};
 assert.equal(proposals(r,wrong,[wrongRule]).single.suggested,'');assert.equal(proposals(r,wrong,[wrongRule]).team.suggested,'');
 // Reconnecting an existing project is an exact source operation, not a new suggestion.
 const saved={...r,media:{url:`local-media:${'a'.repeat(64)}:100`,name:wrong.data.files[0].name,mimeType:'video/mp4'},location:{directoryId:wrong.id,path:wrong.data.files[0].path,size:100,modified:1}};
 assert.equal(mediaProposals([saved],wrong,[],true)[0].suggested,wrong.data.files[0].path);
});

test('years and unsupported numeric labels remain manual, but explicit high episode numbers work',()=>{
 for(const [label,path] of [['Épisode 2026','NTC 2026.mp4'],['Du 31 août 2026','NTC EP031.mp4'],['Épisodes 10 à 11','NTC E10.mp4']]){
  const p=proposals(row(label),directory(path));assert.equal(p.single.suggested,'');assert.equal(p.team.suggested,'');
 }
 assert.equal(proposals(row('Épisode 2026'),directory('NTC EP2026.mp4')).single.suggested,'NTC EP2026.mp4');
});

test('filename hints survive duplicates, accent/case and separators; changed metadata invalidates cached labels',()=>{
 const r=row('Saison 2 Épisode 10');
 for(const path of ['Saison 02/NTC S02E010.mp4','S02/NTC E010.MP4','NTC_s02_e010.mp4','NTC Saison 02 épisode 010.mp4'])assert.equal(proposals(r,directory(path)).single.suggested,path,path);
 const file=directory('NTC E010.mp4').data.files[0];assert.equal(mediaEpisodeHint(file,row()).status,'matching');
 file.path='NTC E011.mp4';file.name=file.path;assert.equal(mediaEpisodeHint(file,row()).status,'different');
 file.path='NTC 010.mp4';file.name=file.path;assert.equal(mediaEpisodeHint(file,row()).status,'matching');
 assert.equal(mediaEpisodeHint(file,{...row(),title:'AUTRE'}).status,'unknown','Cached parsing must not cache the programme-specific fallback');
 assert.equal(mediaEpisodeHint(file,row('')).status,'not-specified');
});

test('two correct candidates and partial directories still require an operator choice',()=>{
 const two=directory('NTC E010.mp4','NTC épisode 10.mov.mp4');
 assert.equal(proposals(row(),two).single.suggested,'');assert.equal(proposals(row(),two).team.suggested,'');
 const partial=directory('NTC E010.mp4');partial.data.partial=true;assert.equal(proposals(row(),partial).single.suggested,'');
 const matcher=new TeamMediaMatcher([row()],[]);matcher.add(partial);assert.equal(matcher.result(false)[0].suggested,'');
});
