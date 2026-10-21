import test from 'node:test';
import assert from 'node:assert/strict';
import type {Plan,PlannerRow} from '../src/studio/day-planner-model';
import type {Programme} from '../src/studio/channel-model';
import {applyProgrammeBatch,currentProgrammeBatch,groupProgrammeBatch,readProgrammeCatalogue,refreshProgrammeBatch,reviewProgrammeBatch} from '../src/studio/planner-programme-batch';

const channel='benin-tv',pId='11111111-1111-4111-8111-111111111111',qId='22222222-2222-4222-8222-222222222222';
const p:Programme={id:pId,channel_id:channel,name:'LE JOURNAL',revision:4,archived:0,updated_at:'2026-09-29T00:00:00Z',data:{name:'LE JOURNAL',aliases:['JT'],category:'Information',recipe:[],recurring:true,notes:'',replayUrl:'',voiceProfileId:null,directoryIds:[],logo:''}};
const q:Programme={...p,id:qId,name:'LES RENCONTRES',data:{...p.data,name:'LES RENCONTRES',aliases:['RENCONTRES'],recurring:false,recipe:['popup']}};
const row:PlannerRow={id:'a',sheet:'JOUR',cell:'A1',raw:'JT',title:'JT',subtitle:'Épisode 3 · retouché',category:'Ma catégorie',broadcastDate:'2026-09-28',airDate:'2026-09-29',time:'00:30:00',duration:1800,included:true,kinds:['ba','event'],formats:['tv','vertical'],media:{url:'local-media:video:123',name:'Mon épisode.mp4',mimeType:'video/mp4'},location:{directoryId:qId,path:'episodes/episode3.mp4',size:123,modified:123},logo:{url:'local-media:logo:234',name:'Mon logo.png',mimeType:'image/png'},excerpt:{source:'local-media:video:123',start:10,end:20,duration:120},voices:{ba:{source:{url:'local-media:voice:456',name:'Ma voix.wav',mimeType:'audio/wav'},sourceDuration:5,start:1,end:4,cue:'DEMAIN',confirmed:true,placement:{mode:'ba-manual',intro:1,carton:3}}},issues:['À relire']};
function plan(rows:PlannerRow[]=[row,{...structuredClone(row),id:'b',cell:'A2',subtitle:'Épisode 4',time:'03:30:00'},{...structuredClone(row),id:'c',title:'RENCONTRES',subtitle:'Autre émission'}]):Plan{return {kind:'plan',name:'Préparation retouchée',source:'grille.xlsx',sourceHash:'a'.repeat(64),rows:structuredClone(rows),sourceRows:structuredClone(rows),weekly:{rowIds:[rows[0].id],formats:['tv']}};}
const rowWithoutLink=({programmeId:_id,programmeRevision:_revision,...rest}:PlannerRow)=>rest;

test('default batch only links all selected occurrences; all manual choices and plan metadata survive',()=>{
 const before=plan(),snapshot=structuredClone(before),matches=reviewProgrammeBatch(before,[p,q],'link');
 const result=applyProgrammeBatch(before,matches.filter(match=>match.status==='ready'));
 assert.equal(result.changed,3);assert.deepEqual(before,snapshot);
 assert.deepEqual(result.plan.rows.map(rowWithoutLink),before.rows);
 assert.deepEqual(result.plan.sourceRows,before.sourceRows);assert.deepEqual(result.plan.weekly,before.weekly);assert.equal(result.plan.name,before.name);assert.equal(result.plan.sourceHash,before.sourceHash);
 assert.deepEqual(result.plan.rows.map(r=>[r.programmeId,r.programmeRevision]),[[pId,4],[pId,4],[qId,4]]);
});
test('copy mode is explicit and changes only official title, filled category and recipe in addition to links',()=>{
 const before=plan(),matches=reviewProgrammeBatch(before,[p,q],'copy'),result=applyProgrammeBatch(before,matches);
 assert.equal(result.plan.rows[0].title,'LE JOURNAL');assert.equal(result.plan.rows[0].category,'Information');assert.deepEqual(result.plan.rows[0].kinds,[]);assert.deepEqual(result.plan.rows[2].kinds,['popup']);
 for(let i=0;i<before.rows.length;i++)assert.deepEqual(rowWithoutLink({...result.plan.rows[i],title:before.rows[i].title,category:before.rows[i].category,kinds:before.rows[i].kinds}),before.rows[i]);
 assert.deepEqual(result.plan.sourceRows,before.sourceRows);assert.deepEqual(result.plan.weekly,before.weekly);
});
test('empty non-recurring recipe and blank category keep occurrence choices even in copy mode',()=>{
 const matches=reviewProgrammeBatch(plan(),[{...p,data:{...p.data,recurring:false,recipe:[],category:''}}],'copy');
 assert.deepEqual(matches[0].after?.kinds,row.kinds);assert.equal(matches[0].after?.category,row.category);
});
test('groups are programme-specific and retain every one of more than 20 occurrences',()=>{
 const rows=Array.from({length:26},(_,i)=>({...row,id:String(i),subtitle:'Épisode '+i}));rows.push({...row,id:'other',title:'RENCONTRES'});
 const groups=groupProgrammeBatch(reviewProgrammeBatch(plan(rows),[p,q],'link'));
 assert.deepEqual(groups.map(g=>g.matches.length),[26,1]);assert.equal(groups[0].programme.id,pId);assert.equal(groups[1].programme.id,qId);
});
test('empty normalized titles, similar titles and ambiguous aliases are never selectable',()=>{
 for(const title of ['???','…','JT soir'])assert.equal(reviewProgrammeBatch(plan([{...row,title}]),[{...p,data:{...p.data,aliases:['???','…','JT']}}],'link')[0].status,'unmatched');
 const matches=reviewProgrammeBatch(plan(),[p,{...q,data:{...q.data,aliases:['JT']}}],'link');assert.equal(matches[0].status,'ambiguous');assert.equal(groupProgrammeBatch(matches).some(g=>g.matches.some(m=>m.rowId==='a')),false);
});
test('removed rows are ignored, excluded rows remain excluded, archived programmes are unavailable',()=>{
 const before=plan([{...row,included:false},{...row,id:'removed',sourceRemoved:true}]),matches=reviewProgrammeBatch(before,[p],'link');
 assert.equal(matches.length,1);assert.equal(applyProgrammeBatch(before,matches).plan.rows[0].included,false);assert.deepEqual(applyProgrammeBatch(before,matches).plan.rows[1],before.rows[1]);
 assert.equal(reviewProgrammeBatch(before,[{...p,archived:1}],'link')[0].status,'unmatched');
});
test('already linked current revision is unchanged by default and never silently downgraded',()=>{
 const before=plan([{...row,programmeId:pId,programmeRevision:4}]);assert.equal(reviewProgrammeBatch(before,[p],'link')[0].status,'unchanged');assert.equal(reviewProgrammeBatch(before,[p],'copy')[0].status,'ready');
 assert.equal(reviewProgrammeBatch(before,[{...p,revision:3}],'link')[0].status,'stale');
});
test('refresh excludes changed revision, same-revision data changes, archival and a newly ambiguous alias',()=>{
 const before=plan([row]),matches=reviewProgrammeBatch(before,[p],'link');
 for(const fresh of [[{...p,revision:5}],[{...p,data:{...p.data,notes:'Changed without a revision'}}],[{...p,archived:1}],[],[p,{...q,data:{...q.data,aliases:['JT']}}]]){
  const result=refreshProgrammeBatch(before,matches,['a'],fresh,'link');assert.equal(result.matches.length,0);assert.equal(result.skipped.length,1);
 }
});
test('only selected rows with identical snapshots reach the final review',()=>{
 const before=plan(),matches=reviewProgrammeBatch(before,[p,q],'link'),changed=structuredClone(before);changed.rows[0].logo=null;
 const result=refreshProgrammeBatch(changed,matches,['a','b'],[p,q],'link');assert.deepEqual(result.matches.map(m=>m.rowId),['b']);assert.deepEqual(result.skipped.map(m=>m.rowId),['a']);
 assert.equal(applyProgrammeBatch(changed,result.matches).plan.rows[0].logo,null);
});
test('last-moment edits are excluded while untouched lines apply and current plan metadata is preserved',()=>{
 const before=plan(),matches=reviewProgrammeBatch(before,[p,q],'link'),changed=structuredClone(before);changed.name='Nouveau nom';changed.rows[0].voices!.ba!.start=2;
 const checked=currentProgrammeBatch(changed,matches);assert.deepEqual(checked.skipped.map(m=>m.rowId),['a']);
 const result=applyProgrammeBatch(changed,matches);assert.equal(result.changed,2);assert.equal(result.plan.name,'Nouveau nom');assert.deepEqual(result.plan.rows[0],changed.rows[0]);
});
test('catalogue reads all pages before returning',async()=>{
 const seen:(string|null)[]=[],signal=new AbortController().signal;
 const result=await readProgrammeCatalogue(async cursor=>{seen.push(cursor);return cursor===null?{programmes:[p],next:'page2'}:{programmes:[q],next:null};},signal,channel,()=>channel);
 assert.deepEqual(result,[p,q]);assert.deepEqual(seen,[null,'page2']);
});
test('catalogue failures never return a partial result',async()=>{
 let calls=0;await assert.rejects(readProgrammeCatalogue(async()=>{if(calls++)throw Error('Network');return {programmes:[p],next:'page2'};},new AbortController().signal,channel,()=>channel));assert.equal(calls,2);
});
test('catalogue rejects repeated cursors, duplicate IDs and cross-channel responses',async()=>{
 let page=0;await assert.rejects(readProgrammeCatalogue(async()=>({programmes:[{...p,id:String(page++)}],next:'same'}),new AbortController().signal,channel,()=>channel));
 await assert.rejects(readProgrammeCatalogue(async()=>({programmes:[p,p],next:null}),new AbortController().signal,channel,()=>channel));
 await assert.rejects(readProgrammeCatalogue(async()=>({programmes:[{...p,channel_id:'other'}],next:null}),new AbortController().signal,channel,()=>channel));
});
test('an empty page claiming a continuation or an oversized page rejects the whole catalogue',async()=>{
 let page=0;await assert.rejects(readProgrammeCatalogue(async()=>page++?{programmes:[],next:'page3'}:{programmes:[p],next:'page2'},new AbortController().signal,channel,()=>channel));
 await assert.rejects(readProgrammeCatalogue(async()=>({programmes:Array.from({length:101},(_,i)=>({...p,id:String(i)})),next:null}),new AbortController().signal,channel,()=>channel));
});
test('catalogue abort and channel transition ignore late data',async()=>{
 const c=new AbortController();let release!:(value:{programmes:Programme[];next:null})=>void;
 const pending=readProgrammeCatalogue(()=>new Promise(resolve=>{release=resolve;}),c.signal,channel,()=>channel);await Promise.resolve();c.abort();await assert.rejects(pending);release({programmes:[p],next:null});
 let active=channel;await assert.rejects(readProgrammeCatalogue(async()=>{active='other';return {programmes:[p],next:null};},new AbortController().signal,channel,()=>active));
});
test('catalogue accepts exactly 10000 complete records but refuses a truncated ceiling',async()=>{
 const all=Array.from({length:10000},(_,i)=>({...p,id:String(i)}));
 const page=(cursor:string|null,more=false)=>{const start=Number(cursor||0),end=start+100;return {programmes:all.slice(start,end),next:end<all.length||more?String(end):null};};
 assert.equal((await readProgrammeCatalogue(async cursor=>page(cursor),new AbortController().signal,channel,()=>channel)).length,10000);
 await assert.rejects(readProgrammeCatalogue(async cursor=>page(cursor,true),new AbortController().signal,channel,()=>channel));
});
