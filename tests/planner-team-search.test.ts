import test from 'node:test';
import assert from 'node:assert/strict';
import {TeamMediaMatcher,searchTeamIndexes,searchRead,teamMediaKey,teamDirectoryCatalog} from '../src/studio/planner-team-search';
import type {DirectoryIndex,PlannerRecord,PlannerRow,PlannerSummary,ProgrammeRule} from '../src/studio/day-planner-model';

const row=(title='Bonjour le Bénin',patch:Partial<PlannerRow>={}):PlannerRow=>({id:title,title,subtitle:'',sheet:'Lundi',cell:'A1',raw:'',category:'Magazine',broadcastDate:'2026-09-07',airDate:'2026-09-07',time:'06:30:00',duration:1800,included:true,kinds:['ba','popup'],formats:['tv'],issues:[],media:null,location:null,...patch});
function dir(id:string,names:string[],partial=false):PlannerRecord<DirectoryIndex>{return {id,revision:1,data:{kind:'directory',name:id,files:names.map(name=>({name:name.split('/').at(-1)!,path:name,size:100,modified:1})),partial,scannedAt:'2026-09-24T00:00:00Z'},createdBy:'test',updatedBy:'test',updatedAt:'2026-09-24T00:00:00Z',archived:false};}
const summaries=(dirs:PlannerRecord<DirectoryIndex>[]):PlannerSummary[]=>dirs.map(d=>({id:d.id,kind:'directory',name:d.data.name,revision:d.revision,updatedAt:d.updatedAt,archived:d.archived}));
test('team search finds each programme in its own directory, without mutating rows or reading files',()=>{
 const rows=[row(),row('Magazine sport'),row('Programme absent')],before=structuredClone(rows);
 const a=dir('matinale',['Bonjour le Bénin 07-09-2026.mp4']),b=dir('sports',['Magazine sport 07-09-2026.mp4']);
 const m=new TeamMediaMatcher(rows,[]);m.add(a);m.add(b);
 const p=m.result();assert.equal(p[0].suggested,teamMediaKey(a.id,a.data.files[0].path));assert.equal(p[1].suggested,teamMediaKey(b.id,b.data.files[0].path));assert.equal(p[2].matches.length,0);assert.deepEqual(rows,before);
});
test('cross-directory ambiguity is not hidden by individually confident or remembered matches',()=>{
 const a=dir('a',['Bonjour le Bénin 07-09-2026.mp4']),b=dir('b',['Bonjour le Bénin 07-09-2026 V2.mp4']);
 const rule:PlannerRecord<ProgrammeRule>={...a,data:{kind:'rule',name:'Matinale',programme:'bonjour le benin',keywords:'Bonjour le Bénin',directoryId:'a',preferredPath:a.data.files[0].path,kinds:['ba']}};
 const m=new TeamMediaMatcher([row()],[rule]);m.add(a);m.add(b);
 assert.equal(m.result()[0].suggested,'');assert.equal(m.result()[0].matches.length,2);
 assert.notEqual(teamMediaKey('a','b/c'),teamMediaKey('a/b','c'));
});
test('date, episode and technical-resource guards remain effective across team indexes',()=>{
 const m=new TeamMediaMatcher([row(),row('Santé',{subtitle:'Épisode 31'}),row('Magazine sport')],[]);
 m.add(dir('old',['Bonjour le Bénin 06-09-2026.mp4','Santé 30.mp4','LOGO Magazine sport.png']));
 m.add(dir('today',['Bonjour le Bénin 07-09-2026.mp4']));
 assert.ok(m.result()[0].suggested.includes('today'));assert.equal(m.result()[1].suggested,'');assert.equal(m.result()[2].suggested,'');
});
test('a saved local reference can only reconnect its exact directory and path, not a ranked substitute',()=>{
 const a=dir('a',['original.mp4','Bonjour le Bénin.mp4']),b=dir('b',['original.mp4','Bonjour le Bénin.mp4']);
 const r=row('Bonjour le Bénin',{media:{url:`local-media:${'a'.repeat(64)}:100`,name:'original.mp4',mimeType:'video/mp4'},location:{directoryId:'a',path:'original.mp4',size:100,modified:1}});
 const m=new TeamMediaMatcher([r],[]);m.add(b);assert.equal(m.result()[0].matches.length,0);m.add(a);
 assert.equal(m.result(false)[0].suggested,teamMediaKey('a','original.mp4'));assert.equal(m.result()[0].matches.length,1);
});
test('aggregation is deterministic, deduplicates indexes and bounds retained candidates',()=>{
 const dirs=Array.from({length:20},(_,i)=>dir(String(i),Array.from({length:10},(_,j)=>`Bonjour le Bénin ${j}.mp4`)));
 const a=new TeamMediaMatcher([row()],[]),b=new TeamMediaMatcher([row()],[]);
 for(const d of dirs){a.add(d);a.add(d);}for(const d of [...dirs].reverse())b.add(d);
 assert.deepEqual(a.result(),b.result());assert.equal(a.result()[0].matches.length,5);assert.equal(a.result()[0].suggested,'');
});
test('team reads at most three indexes concurrently; one failed/partial index prevents fuzzy preselection',async()=>{
 const dirs=[dir('one',['Bonjour le Bénin.mp4']),dir('two',[]),dir('three',[]),dir('four',[])];
 for(const mode of ['complete','failure','partial']){
  const m=new TeamMediaMatcher([row()],[]),progress:number[]=[];let active=0,peak=0;
  const result=await searchTeamIndexes({directories:summaries(dirs),signal:new AbortController().signal,
   get:async id=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,2));active--;if(mode==='failure'&&id==='four')throw Error('Indisponible');const d=structuredClone(dirs.find(d=>d.id===id)!);if(mode==='partial'&&id==='two')d.data.partial=true;return d;},
   add:async d=>m.add(d),result:async complete=>m.result(complete),onProgress:p=>progress.push(p.done)});
  assert.equal(peak,3);assert.equal(progress.at(-1),4);assert.equal(result.proposals[0].suggested!=='',mode==='complete');
  assert.equal(result.failures.length,mode==='failure'?1:0);assert.equal(result.partial.length,mode==='partial'?1:0);
 }
});
test('cancellation rejects a stalled read promptly and ignores its later result',async()=>{
 const c=new AbortController();let reply!:(d:PlannerRecord<DirectoryIndex>)=>void,added=0;
 const promise=searchTeamIndexes({directories:summaries([dir('one',[])]),signal:c.signal,get:async()=>new Promise(r=>{reply=r;}),add:async()=>{added++;},result:async()=>[],onProgress:()=>{}});
 await new Promise(r=>setTimeout(r,1));c.abort();await assert.rejects(promise);reply(dir('one',[]));await new Promise(r=>setTimeout(r,1));assert.equal(added,0);
});
test('a timed out index cannot become a late candidate; authentication failure stops remaining reads',async()=>{
 let added=0;
 const result=await searchTeamIndexes({directories:summaries([dir('one',[])]),signal:new AbortController().signal,get:async()=>new Promise(()=>{}),add:async()=>{added++;},result:async complete=>{assert.equal(complete,false);return [];},onProgress:()=>{},timeoutMs:5});
 assert.equal(result.failures.length,1);assert.equal(added,0);
 let started=0;const c=new AbortController();
 await assert.rejects(searchTeamIndexes({directories:summaries(Array.from({length:10},(_,i)=>dir(String(i),[]))),signal:c.signal,get:async()=>{started++;throw Object.assign(Error('Session expirée'),{status:401});},add:async()=>{},result:async()=>[],onProgress:()=>{}}),/Session expirée/);
 assert.equal(started,3);
});
test('read cancellation propagates to fetch and never invokes already-cancelled operations',async()=>{
 const c=new AbortController();c.abort();let started=0;
 await assert.rejects(searchRead(async()=>{started++;return 1;},c.signal));assert.equal(started,0);
 const d=new AbortController();let inner:AbortSignal|undefined;
 const request=searchRead(async signal=>{inner=signal;return new Promise(()=>{});},d.signal);await Promise.resolve();d.abort();await assert.rejects(request);assert.equal(inner?.aborted,true);
});
test('directory catalogue follows all pages, deduplicates, and refuses repeating cursors',async()=>{
 const dirs=summaries([dir('one',[]),dir('two',[])]),offsets:number[]=[],progress:number[]=[];
 const result=await teamDirectoryCatalog(async offset=>{offsets.push(offset);return offset===0?{documents:[dirs[0]],next:50}:{documents:dirs,next:null};},new AbortController().signal,n=>progress.push(n));
 assert.deepEqual(offsets,[0,50]);assert.deepEqual(progress,[1,2]);assert.equal(result.length,2);
 await assert.rejects(teamDirectoryCatalog(async()=>({documents:dirs,next:0}),new AbortController().signal,()=>{}),/liste des dossiers a changé/);
});
