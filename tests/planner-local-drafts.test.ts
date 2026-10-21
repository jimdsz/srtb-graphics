import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {listPlannerLocalDrafts,makePlannerLocalDraft,MAX_LOCAL_PLANNER_DRAFT_BYTES,plannerDraftScope,removePlannerLocalDraft,writePlannerLocalDraft} from '../src/studio/planner-local-drafts';
import type {Plan,PlannerRecord} from '../src/studio/day-planner-model';
import type {PlannerLocalDraft} from '../src/studio/planner-local-drafts';

const scope=plannerDraftScope(' Editor@Example.test ','benin-tv');
const plan:Plan={kind:'plan',name:'Lundi',source:'conducteur.pdf',sourceHash:'a'.repeat(64),rows:[{id:'row1',sheet:'Lundi',cell:'B2',raw:'MAGAZINE',title:'MAGAZINE',subtitle:'Épisode 17',category:'Magazine',broadcastDate:'2026-09-28',airDate:'2026-09-29',time:'00:30:00',duration:1200,included:true,kinds:['ba','popup'],formats:['tv','vertical'],issues:[],media:null,location:null}]};
function draft(patch:Partial<PlannerLocalDraft>={}):PlannerLocalDraft{return makePlannerLocalDraft(scope,{id:randomUUID(),draftId:randomUUID(),sequence:1,base:null,plan:structuredClone(plan),...patch},patch.savedAt??100);}
function fake(){
 const request:any={},calls:Array<{type:string;key?:unknown;value?:unknown;request:any}>=[];let closes=0,aborts=0,opens=0,transactions=0;
 const call=(type:string,key?:unknown,value?:unknown)=>{const operation:any={};calls.push({type,key,value,request:operation});return operation;};
 const makeStore=(prefix:string):any=>({index:(name:string)=>{assert.equal(name,'scope');return{getAll:(key:unknown,count:number)=>{assert.equal(count,21);return call(prefix+'all',key);}};},get:(key:unknown)=>call(prefix+'get',key),put:(value:unknown)=>call(prefix+'put',undefined,value),delete:(key:unknown)=>call(prefix+'delete',key)});
 const store=makeStore(''),budget=makeStore('budget-');
 const tx:any={objectStore:(name:string)=>{assert.ok(['drafts','budget'].includes(name));return name==='drafts'?store:budget;},abort(){aborts++;tx.onabort?.();}};
 const db:any={close(){closes++;},transaction:(names:string[])=>{assert.deepEqual(names,['drafts','budget']);transactions++;return tx;}};request.result=db;
 const factory={open(name:string,version:number){assert.equal(name,'srtb-planner-drafts');assert.equal(version,1);opens++;return request;}} as unknown as IDBFactory;
 return {request,tx,db,factory,calls,open(){request.onsuccess();},reply(index:number,value:unknown){calls[index].request.result=calls[index].type==='budget-all'&&Array.isArray(value)?value.map(draft=>draft?.schema===1?{owner:draft.owner,channel:draft.channel,id:draft.id,draftId:draft.draftId,sequence:draft.sequence,bytes:new TextEncoder().encode(JSON.stringify(draft)).byteLength}:draft):value;calls[index].request.onsuccess?.();},commit(){tx.oncomplete();},get closes(){return closes;},get aborts(){return aborts;},get opens(){return opens;},get transactions(){return transactions;}};
}

test('scope normalizes only the authenticated email and rejects malformed context',()=>{
 assert.deepEqual(scope,{owner:'editor@example.test',channel:'benin-tv'});
 for(const [email,channel]of [['','benin-tv'],['a@example.test','../../x'],['a@example.test','OTHER']])assert.throws(()=>plannerDraftScope(email,channel));
});
test('snapshot clones all editorial choices and retains unfinished title/name without weakening server schema',()=>{
 const current=structuredClone(plan);current.name='';current.rows[0].title='';current.rows[0].time='';
 current.rows[0].media={url:`local-media:${'1'.repeat(64)}:120`,name:'Programme.mp4',mimeType:'video/mp4'};
 current.sourceRows=structuredClone(plan.rows);current.weekly={rowIds:['row1'],formats:['tv']};
 const copy=draft({plan:current});assert.deepEqual(copy.plan,current);
 current.rows[0].subtitle='later';assert.equal(copy.plan.rows[0].subtitle,'Épisode 17');
 assert.equal(copy.plan.rows[0].airDate,'2026-09-29');assert.equal(copy.plan.rows[0].title,'');
});
test('base identity must match draft and carries the exact shared revision',()=>{
 const id=randomUUID(),base:PlannerRecord<Plan>={id,revision:7,data:plan,createdBy:scope.owner,updatedBy:scope.owner,updatedAt:'2026-09-29T00:00:00Z',archived:false};
 const copy=draft({draftId:id,base});assert.equal(copy.base?.revision,7);assert.deepEqual(copy.base?.data,plan);
 assert.throws(()=>draft({base}));
});
test('untrusted payloads, temporary URLs, binary/handle additions and oversized entries are refused intact',()=>{
 for(const url of ['blob:temporary','https://example.test/token=secret','data:video/mp4;base64,AAA','http://127.0.0.1:43871/v1/media/secret']){
  const current=structuredClone(plan);current.rows[0].media={url,name:'Programme.mp4',mimeType:'video/mp4'};assert.throws(()=>draft({plan:current}));
 }
 assert.throws(()=>draft({plan:{...plan,token:'secret'} as Plan}));
 assert.throws(()=>draft({plan:{...plan,source:'x'.repeat(MAX_LOCAL_PLANNER_DRAFT_BYTES)} as Plan}),/volumineuse/);
 assert.throws(()=>draft({sequence:0}));
 assert.throws(()=>draft({savedAt:Number.MAX_SAFE_INTEGER}));
});
test('list reads only owner/channel, sorts newest first and resolves only at commit',async()=>{
 const f=fake(),one=draft({savedAt:100}),two=draft({savedAt:200});let settled=false;
 const pending=listPlannerLocalDrafts(scope,{factory:f.factory}).then(value=>{settled=true;return value;});
 f.open();assert.deepEqual(f.calls[0].key,[scope.owner,scope.channel]);f.reply(0,[one,two]);await Promise.resolve();assert.equal(settled,false);
 f.commit();assert.deepEqual((await pending).map(d=>d.id),[two.id,one.id]);assert.equal(f.closes,1);
});
test('write acknowledges only committed data, never request success',async()=>{
 const f=fake(),value=draft();let settled=false;
 const pending=writePlannerLocalDraft(scope,value,{factory:f.factory}).then(result=>{settled=true;return result;});
 f.open();f.reply(0,[]);assert.equal(f.calls[1].type,'put');assert.deepEqual(f.calls[1].value,value);f.reply(1,undefined);await Promise.resolve();assert.equal(settled,false);
 f.commit();assert.equal(await pending,true);assert.equal(f.aborts,0);
});
test('same session cannot overwrite a newer or equal sequence and separate sessions are independent',async()=>{
 const prior=draft({sequence:5});
 for(const sequence of [4,5]){const f=fake(),pending=writePlannerLocalDraft(scope,{...prior,sequence},{factory:f.factory});f.open();f.reply(0,[prior]);f.commit();assert.equal(await pending,false);assert.equal(f.calls.length,1);}
 const next={...prior,id:randomUUID(),sequence:1},f=fake(),pending=writePlannerLocalDraft(scope,next,{factory:f.factory});f.open();f.reply(0,[prior]);assert.deepEqual(f.calls[1].value,next);f.reply(1,null);f.commit();assert.equal(await pending,true);
});
test('same copy cannot silently change its shared document identity',async()=>{
 const previous=draft(),f=fake(),pending=writePlannerLocalDraft(scope,{...previous,sequence:2,draftId:randomUUID()},{factory:f.factory});
 const checked=assert.rejects(pending,/autre préparation/);f.open();f.reply(0,[previous]);await checked;assert.equal(f.calls.length,1);assert.equal(f.aborts,1);
});
test('cross-user or channel data from storage fails closed without deleting anything',async()=>{
 for(const patch of [{owner:'other@example.test'},{channel:'another'}]){
  const f=fake(),pending=listPlannerLocalDrafts(scope,{factory:f.factory}),checked=assert.rejects(pending,/autre compte/);
  f.open();f.reply(0,[{...draft(),...patch}]);await checked;assert.equal(f.calls.length,1);
  assert.throws(()=>writePlannerLocalDraft(scope,{...draft(),...patch},{factory:f.factory}),/autre compte/);
 }
});
test('count quota refuses the new copy without evicting another session',async()=>{
 const f=fake(),pending=writePlannerLocalDraft(scope,draft(),{factory:f.factory}),checked=assert.rejects(pending,/Vingt copies/);
 f.open();f.reply(0,Array.from({length:20},()=>draft()));await checked;assert.equal(f.calls.length,1);assert.equal(f.aborts,1);
});
test('at the count quota an existing session can still update its own copy',async()=>{
 const rows=Array.from({length:20},()=>draft()),next={...rows[0],sequence:2},f=fake(),pending=writePlannerLocalDraft(scope,next,{factory:f.factory});
 f.open();f.reply(0,rows);assert.deepEqual(f.calls[1].value,next);f.reply(1,null);f.commit();assert.equal(await pending,true);
});
test('aggregate byte quota counts UTF-8 and never silently prunes older drafts',async()=>{
 const large:Plan={...plan,rows:Array.from({length:600},(_,index)=>({...plan.rows[0],id:String(index),raw:'界'.repeat(1600)}))};
 const rows=Array.from({length:9},()=>draft({plan:large}));
 const f=fake(),pending=writePlannerLocalDraft(scope,draft(),{factory:f.factory}),checked=assert.rejects(pending,/mémoire des préparations est pleine/);
 f.open();f.reply(0,rows);await checked;assert.equal(f.calls.length,1);assert.equal(f.aborts,1);
});
test('compare-and-delete only removes the exact current sequence in the exact scope',async()=>{
 const value=draft({sequence:3});
 for(const current of [undefined,{...value,sequence:4},value]){
  const f=fake(),pending=removePlannerLocalDraft(scope,value.id,3,{factory:f.factory});f.open();assert.deepEqual(f.calls[0].key,[scope.owner,scope.channel,value.id]);f.reply(0,current);
  if(current===value){assert.equal(f.calls[1].type,'delete');assert.deepEqual(f.calls[1].key,[scope.owner,scope.channel,value.id]);f.reply(1,null);}
  f.commit();assert.equal(await pending,current===value);assert.equal(f.calls.length,current===value?3:1);
 }
});
test('aborted commit does not report saved after a successful put',async()=>{
 const f=fake(),pending=writePlannerLocalDraft(scope,draft(),{factory:f.factory}),checked=assert.rejects(pending,/pas été confirmée/);
 f.open();f.reply(0,[]);f.reply(1,null);f.tx.onabort();await checked;assert.equal(f.closes,1);
});
test('metadata and content use one transaction; metadata failure never reports a successful save',async()=>{
 const f=fake(),value=draft(),pending=writePlannerLocalDraft(scope,value,{factory:f.factory}),checked=assert.rejects(pending,/pas pu être conservée/);
 f.open();assert.equal(f.calls[0].type,'budget-all');f.reply(0,[]);assert.equal(f.calls[2].type,'budget-put');
 assert.deepEqual(f.calls[2].value,{owner:scope.owner,channel:scope.channel,id:value.id,draftId:value.draftId,sequence:value.sequence,bytes:new TextEncoder().encode(JSON.stringify(value)).byteLength});
 f.reply(1,null);f.calls[2].request.onerror();await checked;assert.equal(f.transactions,1);assert.equal(f.aborts,1);
});
test('storage failures and corruption settle with recoverable non-technical errors',async()=>{
 for(const stage of ['open','transaction','read','write','corrupt']){
  const f=fake(),pending=writePlannerLocalDraft(scope,draft(),{factory:f.factory}),checked=assert.rejects(pending);
  if(stage==='open')f.request.onerror();else if(stage==='transaction'){f.db.transaction=()=>{throw Error('private internal details');};f.open();}
  else {f.open();if(stage==='read')f.calls[0].request.onerror();else if(stage==='corrupt')f.reply(0,[{password:'must not be returned'}]);else{f.reply(0,[]);f.calls[1].request.onerror();}}
  await checked;
 }
});
test('blocked or stalled opens fail and late success closes without entering storage',async()=>{
 for(const blocked of [true,false]){
  const f=fake(),pending=listPlannerLocalDrafts(scope,{factory:f.factory,timeoutMs:10}),checked=assert.rejects(pending,blocked?/bloquée/:/ne répond pas/);
  if(blocked)f.request.onblocked();await checked;f.open();assert.equal(f.transactions,0);assert.equal(f.closes,1);
 }
});
test('timeouts and signal cancellation abort the transaction and ignore late completion',async()=>{
 for(const reason of ['timeout','signal']){
  const f=fake(),c=new AbortController(),pending=writePlannerLocalDraft(scope,draft(),{factory:f.factory,signal:c.signal,timeoutMs:10}),checked=assert.rejects(pending);
  f.open();f.reply(0,[]);if(reason==='signal')c.abort();await checked;assert.equal(f.aborts,1);assert.equal(f.closes,1);f.reply(1,null);f.commit();
 }
});
test('already aborted request never opens the database',async()=>{
 const f=fake(),c=new AbortController();c.abort();await assert.rejects(listPlannerLocalDrafts(scope,{factory:f.factory,signal:c.signal}),{name:'AbortError'});assert.equal(f.opens,0);
});
test('database version change aborts a pending operation and closes the connection',async()=>{
 const f=fake(),pending=listPlannerLocalDrafts(scope,{factory:f.factory}),checked=assert.rejects(pending,/autre onglet/);
 f.open();f.db.onversionchange();await checked;assert.equal(f.aborts,1);assert.equal(f.closes,1);
});
test('unavailable IndexedDB rejects without exposing the internal provider error',async()=>{
 const factory={open(){throw Error('sensitive internal diagnostic');}} as unknown as IDBFactory;
 await assert.rejects(listPlannerLocalDrafts(scope,{factory}),error=>error instanceof Error&&/indisponible/.test(error.message)&&!error.message.includes('sensitive'));
});
