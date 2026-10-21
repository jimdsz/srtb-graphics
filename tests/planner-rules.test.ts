import test from 'node:test';
import assert from 'node:assert/strict';
import {programmeRules} from '../src/studio/planner-rules';
import {mediaProposals} from '../src/studio/day-planner-assistant';
import {TeamMediaMatcher} from '../src/studio/planner-team-search';
import type {DirectoryIndex,PlannerRecord,PlannerRow,ProgrammeRule} from '../src/studio/day-planner-model';

const row:PlannerRow={id:'programme',sheet:'Lundi',cell:'A1',raw:'',title:'Bonjour le Bénin',subtitle:'',category:'Magazine',broadcastDate:'2026-09-07',airDate:'2026-09-07',time:'06:30:00',duration:1800,included:true,kinds:['ba','popup'],formats:['tv'],issues:[],media:null,location:null};
const directory:PlannerRecord<DirectoryIndex>={id:'folder',revision:1,archived:false,createdBy:'test',updatedBy:'test',updatedAt:'2026-09-25T00:00:00Z',data:{kind:'directory',name:'Programme',scannedAt:'2026-09-25T00:00:00Z',partial:false,files:[{name:'Bonjour le Benin.mp4',path:'Bonjour le Benin.mp4',size:100,modified:1}]}};
const first:PlannerRecord<ProgrammeRule>={...directory,id:'one',data:{kind:'rule',name:row.title,programme:'bonjour le benin',keywords:row.title,directoryId:directory.id,preferredPath:directory.data.files[0].path,kinds:['ba']}};
const other={...first,id:'two',data:{...first.data,preferredPath:'OTHER.mp4'}};

test('ambiguous programme rules have no first/last winner in either response order',()=>{
 for(const rules of [[first,other],[other,first],[first,other,first]]){
  const result=programmeRules(rules);assert.equal(result.unique.size,0);assert.deepEqual([...result.conflicts],['bonjour le benin']);
  const proposal=mediaProposals([row],directory,rules)[0];assert.ok(proposal.matches.length);assert.equal(proposal.suggested,'');assert.equal(proposal.rule,undefined);assert.equal(proposal.ruleConflict,true);
  const matcher=new TeamMediaMatcher([row],rules);matcher.add(directory);const team=matcher.result()[0];assert.ok(team.matches.length);assert.equal(team.suggested,'');assert.equal(team.ruleConflict,true);
 }
});
test('duplicates never reconnect an arbitrary choice, but an explicitly saved project location remains usable',()=>{
 const saved={...row,media:{url:'local-media:'+'a'.repeat(64)+':100',name:'Bonjour le Benin.mp4',mimeType:'video/mp4'},location:{directoryId:directory.id,path:directory.data.files[0].path,size:100,modified:1}};
 const matcher=new TeamMediaMatcher([saved],[first,other]);matcher.add(directory);const result=matcher.result()[0];
 assert.equal(result.ruleConflict,true);assert.equal(result.suggested,result.matches[0].key);assert.equal(result.matches[0].file.path,saved.location.path);
});
test('archived records do not compete; identical repeated records are safe but revision disagreement is not',()=>{
 for(const rules of [[first,{...other,archived:true}],[first,first]]){const result=programmeRules(rules);assert.equal(result.conflicts.size,0);assert.equal(result.unique.get(first.data.programme),first);}
 for(const variant of [{...first,revision:2},{...first,data:{...first.data,preferredPath:'different.mp4'}}])assert.equal(programmeRules([first,variant]).conflicts.size,1);
 const separate={...other,data:{...other.data,programme:'autre emission'}};assert.equal(programmeRules([first,separate]).unique.size,2);
});
