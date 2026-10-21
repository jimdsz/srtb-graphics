import test from 'node:test';
import assert from 'node:assert/strict';
import {readProgrammeResources,programmeVoiceProposal} from '../src/studio/planner-programme-resources';
import type {Programme} from '../src/studio/channel-model';
import type {PreparationProfile} from '../src/studio/preparation-profile-model';
const programme:Programme={id:'11111111-1111-4111-8111-111111111111',channel_id:'benin-tv',name:'Magazine',revision:2,archived:0,updated_at:'2026-09-29',data:{name:'Magazine',aliases:[],category:'',replayUrl:'',recurring:false,recipe:[],notes:'',directoryIds:[],voiceProfileId:null}};
const row={programmeId:programme.id,programmeRevision:2};
const signal=()=>new AbortController().signal;
test('only the explicitly confirmed programme revision offers resources; unknown rows do not fetch',async()=>{
 let calls=0;const get=async()=>{calls++;return programme;};
 assert.equal((await readProgrammeResources({},get,signal())).programme,null);assert.equal(calls,0);
 assert.deepEqual((await readProgrammeResources(row,get,signal())).programme,programme);
 const stale=await readProgrammeResources({...row,programmeRevision:1},get,signal());assert.equal(stale.programme,null);assert.match(stale.warning,/a changé/);
 for(const p of [{...programme,archived:1},{...programme,id:'wrong'}])assert.equal((await readProgrammeResources(row,async()=>p,signal())).programme,null);
});
test('programme failure is advisory; auth and cancellation still stop stale results',async()=>{
 assert.match((await readProgrammeResources(row,async()=>{throw Error('Offline');},signal())).warning,/indisponibles/);
 for(const status of [401,403])await assert.rejects(readProgrammeResources(row,async()=>{throw Object.assign(Error('Accès'),{status});},signal()));
 const c=new AbortController();let finish!:(p:Programme)=>void;
 const pending=readProgrammeResources(row,async()=>new Promise(resolve=>{finish=resolve;}),c.signal);
 await Promise.resolve();c.abort();await assert.rejects(pending,{name:'AbortError'});finish(programme);
});
const voice:PreparationProfile={id:'22222222-2222-4222-8222-222222222222',kind:'voice',name:'Lundi',revision:1,favorite:false,archived:false,template_id:null,template_version:null,library_version:null,created_by:'test',updated_by:'test',created_at:'',updated_at:'',validated_by:'test',validated_at:'2026-09-29',data:{source:{url:'/api/graphics/media/33333333-3333-4333-8333-333333333333/content',name:'lundi.wav',mimeType:'audio/wav'},start:1,end:4,label:'Lundi',cue:{kind:'announcement',value:'Lundi'},humanValidated:true}};
test('usual voice never becomes a wrong-day announcement or an unvalidated automatic selection',()=>{
 assert.deepEqual(programmeVoiceProposal(voice,'Lundi'),voice.data);
 assert.equal(programmeVoiceProposal(voice,'Mardi'),null);assert.equal(programmeVoiceProposal(voice,'Tout de suite'),null);
 assert.equal(programmeVoiceProposal({...voice,archived:true},'Lundi'),null);
 assert.equal(programmeVoiceProposal({...voice,validated_by:null},'Lundi'),null);
 assert.equal(programmeVoiceProposal({...voice,data:{...voice.data,cue:{kind:'time',value:'20:30'}}},'Lundi'),null);
});
