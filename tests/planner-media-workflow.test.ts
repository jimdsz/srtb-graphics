import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlannerBatchMemory,loadPlannerMediaCatalog,loadPlannerSharedMedia,rememberPlannerMedia,savePlannerDirectory} from '../src/studio/planner-media-workflow';
import type {MediaAsset} from '../src/studio/domain';
import type {plannerAPI} from '../src/studio/day-planner-api';
import type {DirectoryIndex,PlannerRecord,PlannerRow,ProgrammeRule} from '../src/studio/day-planner-model';
const row:PlannerRow={id:'one',sheet:'Lundi',cell:'A1',raw:'',title:'Bonjour le Bénin',subtitle:'',category:'Magazine',broadcastDate:'2026-09-07',airDate:'2026-09-07',time:'06:30:00',duration:1800,included:true,kinds:['ba','popup'],formats:['tv'],issues:[],media:null,location:null};
const directory:PlannerRecord<DirectoryIndex>={id:'folder-last',revision:2,archived:false,createdBy:'test',updatedBy:'test',updatedAt:'2026-09-25T00:00:00Z',data:{kind:'directory',name:'Dernier dossier',files:[],scannedAt:'2026-09-25T00:00:00Z',partial:false}};
const rule:PlannerRecord<ProgrammeRule>={...directory,id:'rule',data:{kind:'rule',name:row.title,programme:'bonjour le benin',keywords:row.title,directoryId:directory.id,preferredPath:'matinale.mp4',kinds:['ba']}};
const signal=()=>new AbortController().signal;
const programme={id:'11111111-1111-4111-8111-111111111111',revision:2,name:'Bonjour le Bénin',channel_id:'benin-tv',archived:0,updated_at:'',data:{name:'Bonjour le Bénin',aliases:[],category:'',replayUrl:'',recurring:false,recipe:[],notes:'',directoryIds:[directory.id],voiceProfileId:null}};
function api(overrides:Partial<typeof plannerAPI>={}):typeof plannerAPI{return {
 list:async()=>({documents:[],next:null}),rules:async()=>({rules:[rule]}),get:async()=>directory,save:async()=>rule,...overrides,
} as typeof plannerAPI;}

const asset:MediaAsset={id:'image',name:'Émission.jpg',mime_type:'image/jpeg',bytes:20,created_by:'test',created_at:'2026-09-26',status:'ready'};
test('shared media read forwards cancellation and returns only ready visual resources without downloading any content',async()=>{
 let calls=0;
 const result=await loadPlannerSharedMedia({media:async s=>{calls++;assert.ok(s);assert.equal(s.aborted,false);return [asset,{...asset,id:'video',mime_type:'video/mp4'},{...asset,id:'sound',mime_type:'audio/mpeg'},{...asset,id:'pending',status:'uploading'},{...asset,id:'failed',status:'failed'}];}},signal());
 assert.deepEqual(result.map(m=>m.id),['image','video']);assert.equal(calls,1);
});

test('shared media cancellation releases callers even if transport ignores abort and rejects late replies',async()=>{
 const c=new AbortController();let late!:(value:MediaAsset[])=>void,transport:AbortSignal|undefined,continued=false;
 const pending=loadPlannerSharedMedia({media:async s=>{transport=s;return new Promise(resolve=>{late=resolve;});}},c.signal).then(value=>{continued=true;return value;});
 await Promise.resolve();c.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(transport?.aborted,true);
 late([asset]);await Promise.resolve();await Promise.resolve();assert.equal(continued,false);
});

test('shared media deadline stops the request without retry; explicit later retry can succeed',async()=>{
 let calls=0,transport:AbortSignal|undefined;
 const endpoint={media:async(s?:AbortSignal):Promise<MediaAsset[]>=>{calls++;transport=s;if(calls===1)return new Promise(()=>{});return [asset];}};
 await assert.rejects(loadPlannerSharedMedia(endpoint,signal(),15),/médiathèque ne répond pas/);assert.equal(calls,1);assert.equal(transport?.aborted,true);
 assert.deepEqual(await loadPlannerSharedMedia(endpoint,signal()),[asset]);assert.equal(calls,2);
});

test('shared media access errors propagate; an already cancelled read never calls the API',async()=>{
 for(const status of [401,403,429,500]){
  let calls=0;await assert.rejects(loadPlannerSharedMedia({media:async()=>{calls++;throw Object.assign(Error('Accès indisponible'),{status});}},signal()),e=>(e as {status:number}).status===status);assert.equal(calls,1);
 }
 const c=new AbortController();c.abort();let calls=0;
 await assert.rejects(loadPlannerSharedMedia({media:async()=>{calls++;return [asset];}},c.signal),{name:'AbortError'});assert.equal(calls,0);
});

test('individual media picker reads every folder page and exact rule without reading files',async()=>{
 const offsets:number[]=[],identities:string[][]=[];
 const result=await loadPlannerMediaCatalog(row,api({list:async(kind,offset)=>{
  assert.equal(kind,'directory');offsets.push(offset!);return {documents:[{id:`folder-${offset}`,revision:1,kind:'directory',name:`Dossier ${offset}`,archived:false,updatedAt:directory.updatedAt}],next:offset===0?100:null};
 },rules:async ids=>{identities.push(ids);return {rules:[rule]};}}),signal());
 assert.deepEqual(offsets,[0,100]);assert.deepEqual(identities,[['bonjour le benin']]);assert.equal(result.directories.length,2);assert.deepEqual(result.directory,directory);assert.deepEqual(result.rule,rule);
});
test('one confirmed programme directory is offered, never replacing a saved location or an explicit rule',async()=>{
 const linked={...row,programmeId:programme.id,programmeRevision:2};
 const summary={id:directory.id,revision:2,kind:'directory' as const,name:directory.data.name,archived:false,updatedAt:directory.updatedAt};
 const empty=api({rules:async()=>({rules:[]}),list:async()=>({documents:[summary],next:null})});
 const offered=await loadPlannerMediaCatalog(linked,empty,signal(),async()=>programme);assert.equal(offered.directory?.id,directory.id);assert.match(offered.warning,/fiche émission/);
 const stale=await loadPlannerMediaCatalog({...linked,programmeRevision:1},empty,signal(),async()=>programme);assert.equal(stale.directory,null);assert.match(stale.warning,/a changé/);assert.doesNotMatch(stale.warning,/Dossier proposé/);
 const multiple=await loadPlannerMediaCatalog(linked,api({...empty,list:async()=>({documents:[summary,{...summary,id:'other'}],next:null})}),signal(),async()=>({...programme,data:{...programme.data,directoryIds:[directory.id,'other']}}));assert.equal(multiple.directory,null);assert.match(multiple.warning,/Plusieurs dossiers/);
 const saved=await loadPlannerMediaCatalog({...linked,location:{directoryId:'saved',path:'episode.mp4',size:1,modified:2}},api({...empty,get:async id=>({...directory,id})}),signal(),async()=>programme);assert.equal(saved.directory?.id,'saved');
});
test('archived or ambiguous rules never select a remembered file; saved location takes precedence',async()=>{
 for(const rules of [[{...rule,archived:true}],[rule,{...rule,id:'duplicate'}]]){
  let reads=0;const result=await loadPlannerMediaCatalog(row,api({rules:async()=>({rules}),get:async()=>{reads++;throw Error('Unexpected');}}),signal());
  assert.equal(result.rule,null);assert.equal(result.directory,null);assert.equal(reads,0);
 }
 const result=await loadPlannerMediaCatalog({...row,location:{directoryId:'saved',path:'episode.mp4',size:10,modified:2}},api({get:async id=>{assert.equal(id,'saved');return {...directory,id};}}),signal());assert.equal(result.directory?.id,'saved');
});
test('unavailable remembered folder does not discard the catalogue; access failures still propagate',async()=>{
 const result=await loadPlannerMediaCatalog(row,api({get:async()=>{throw Error('Absent');}}),signal());assert.equal(result.directory,null);assert.match(result.warning,/dossier mémorisé/);assert.deepEqual(result.rule,rule);
 for(const status of [401,403])await assert.rejects(loadPlannerMediaCatalog(row,api({get:async()=>{throw Object.assign(Error('Accès'),{status});}}),signal()),/Accès/);
});
test('cancelled catalogue rejects late responses and never loads a folder',async()=>{
 const c=new AbortController();let finish!:(value:{rules:typeof rule[]})=>void,reads=0;
 const result=loadPlannerMediaCatalog(row,api({rules:async()=>new Promise(resolve=>{finish=resolve;}),get:async()=>{reads++;throw Error('Unexpected');}}),c.signal);
 await Promise.resolve();await Promise.resolve();c.abort();await assert.rejects(result);finish({rules:[rule]});await Promise.resolve();assert.equal(reads,0);
});
test('optional team memory failures preserve selection and do not retry/overwrite a concurrent rule',async()=>{
 for(const status of [0,409,429,500]){
  let calls=0;const warning=await rememberPlannerMedia(api({save:async(id,revision,data,s)=>{calls++;assert.equal(id,'rule');assert.equal(revision,2);assert.deepEqual(data,rule.data);assert.ok(s);throw Object.assign(Error('Non confirmé'),{status});}}),'rule',2,rule.data,signal());
  assert.equal(calls,1);assert.match(warning,/Média lié/);assert.match(warning,/n’est pas confirmée/);
 }
});
test('successful memory is silent; auth failure and cancellation cannot be reported as a successful binding',async()=>{
 assert.equal(await rememberPlannerMedia(api(),'rule',2,rule.data,signal()),'');
 for(const status of [401,403])await assert.rejects(rememberPlannerMedia(api({save:async()=>{throw Object.assign(Error('Accès'),{status});}}),'rule',2,rule.data,signal()),/Accès/);
 const c=new AbortController();let calls=0;c.abort();await assert.rejects(rememberPlannerMedia(api({save:async()=>{calls++;return rule;}}),'rule',2,rule.data,c.signal));assert.equal(calls,0);
 const d=new AbortController();await assert.rejects(rememberPlannerMedia(api({save:async()=>{d.abort();return rule;}}),'rule',2,rule.data,d.signal));
});

test('a stalled optional batch write is bounded, aborts transport and suppresses further writes until refresh',async()=>{
 let calls=0,transport:AbortSignal|undefined,late!:(value:typeof rule)=>void;
 const memory=createPlannerBatchMemory(api({save:async(_id,_revision,_data,s)=>{calls++;transport=s;return new Promise(resolve=>{late=resolve;});}}),15);
 const result=await memory.remember('rule',2,rule.data,signal());
 assert.equal(result.saved,null);assert.match(result.warning,/n’est pas confirmée/);assert.equal(transport?.aborted,true);assert.equal(memory.needsRefresh,true);
 late({...rule,revision:3});await Promise.resolve();await Promise.resolve();assert.equal(memory.needsRefresh,true);
 for(let i=0;i<250;i++)assert.equal((await memory.remember('other',0,rule.data,signal())).saved,null);
 assert.equal(calls,1);
});

test('cancelling a stalled batch write releases caller even when transport ignores abort; late success cannot resume it',async()=>{
 const c=new AbortController();let late!:(value:typeof rule)=>void,transport:AbortSignal|undefined,calls=0;
 const memory=createPlannerBatchMemory(api({save:async(_id,_revision,_data,s)=>{calls++;transport=s;return new Promise(resolve=>{late=resolve;});}}));
 const pending=memory.remember('rule',2,rule.data,c.signal);await Promise.resolve();c.abort();await assert.rejects(pending,{name:'AbortError'});
 assert.equal(transport?.aborted,true);assert.equal(memory.needsRefresh,true);late({...rule,revision:3});await Promise.resolve();
 assert.equal((await memory.remember('next',0,rule.data,signal())).saved,null);assert.equal(calls,1);
});

test('batch memory preserves confirmed revisions and requires explicit fresh rules after any uncertain reply',async()=>{
 let calls=0;const memory=createPlannerBatchMemory(api({save:async(_id,revision,data)=>{calls++;if(calls===1)throw Object.assign(Error('Conflict'),{status:409});assert.equal(revision,7);return {...rule,revision:8,data};}}));
 assert.equal((await memory.remember('rule',2,rule.data,signal())).saved,null);
 assert.equal((await memory.remember('rule',2,rule.data,signal())).saved,null);assert.equal(calls,1);
 memory.refreshed();const confirmed=await memory.remember('rule',7,rule.data,signal());assert.equal(confirmed.saved?.revision,8);assert.equal(confirmed.warning,'');assert.equal(memory.needsRefresh,false);assert.equal(calls,2);
});

test('batch auth failures and cancellation before dispatch never continue as optional warnings',async()=>{
 for(const status of [401,403]){
  let calls=0;const memory=createPlannerBatchMemory(api({save:async()=>{calls++;throw Object.assign(Error('Accès'),{status});}}));
  await assert.rejects(memory.remember('rule',2,rule.data,signal()),error=>(error as {status:number}).status===status);assert.equal(calls,1);assert.equal(memory.needsRefresh,true);
 }
 let calls=0;const memory=createPlannerBatchMemory(api({save:async()=>{calls++;return rule;}}));const c=new AbortController();c.abort();await assert.rejects(memory.remember('rule',2,rule.data,c.signal));assert.equal(calls,0);assert.equal(memory.needsRefresh,false);
});

test('index sharing is metadata-only, keeps UUID and revision, and returns the acknowledged record',async()=>{
 let calls=0;
 const saved=await savePlannerDirectory(api({save:async(id,revision,data,s)=>{
  calls++;assert.equal(id,directory.id);assert.equal(revision,2);assert.deepEqual(data,directory.data);assert.ok(s);
  return {...directory,revision:3,data};
 }}),directory.id,2,directory.data,signal());
 assert.equal(calls,1);assert.equal(saved.revision,3);assert.deepEqual(saved.data,directory.data);
});

test('cancelled index sharing settles immediately even if transport ignores abort, and rejects late success',async()=>{
 const c=new AbortController();let late!:(value:typeof directory)=>void,transport:AbortSignal|undefined,continued=false,calls=0;
 const pending=savePlannerDirectory(api({save:async(_id,_revision,_data,s)=>{calls++;transport=s;return new Promise(resolve=>{late=resolve;});}}),directory.id,0,directory.data,c.signal).then(saved=>{continued=true;return saved;});
 await Promise.resolve();c.abort();await assert.rejects(pending,{name:'AbortError'});
 assert.equal(transport?.aborted,true);assert.equal(calls,1);late(directory);await Promise.resolve();await Promise.resolve();assert.equal(continued,false);
 const stopped=new AbortController();stopped.abort();await assert.rejects(savePlannerDirectory(api({save:async()=>{calls++;return directory;}}),directory.id,0,directory.data,stopped.signal));assert.equal(calls,1);
});

test('index sharing timeout and conflicts do not retry or claim a confirmed share',async()=>{
 let calls=0,transport:AbortSignal|undefined;
 await assert.rejects(savePlannerDirectory(api({save:async(_id,_revision,_data,s)=>{calls++;transport=s;return new Promise(()=>{});}}),directory.id,0,directory.data,signal(),15),/partage de l’index n’est pas confirmé/);
 assert.equal(calls,1);assert.equal(transport?.aborted,true);
 for(const status of [401,403,409,429,500]){
  let attempts=0;await assert.rejects(savePlannerDirectory(api({save:async()=>{attempts++;throw Object.assign(Error('Réponse non confirmée'),{status});}}),directory.id,2,directory.data,signal()),error=>(error as {status:number}).status===status);assert.equal(attempts,1);
 }
});
