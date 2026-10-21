import {env} from 'cloudflare:workers';
import {applyD1Migrations} from 'cloudflare:test';
import {beforeAll,expect,it,inject} from 'vitest';
import {api} from '../../server/router';
import type {Member} from '../../src/studio/domain';
import type {Plan,PlannerRecord,ProgrammeRule} from '../../src/studio/day-planner-model';

const origin='https://studio.example';
const admin:Member={email:'admin@example.com',name:'Admin',role:'admin',active:1};
const reviewer:Member={email:'recipe-reviewer@example.test',name:'Relecture',role:'broadcaster',active:1};
const designer:Member={email:'recipe-designer@example.test',name:'Graphiste',role:'designer',active:1};
const call=(path:string,method='GET',body?:unknown,member=reviewer,channel='benin-tv')=>api(new Request(origin+'/api/graphics'+path,{method,headers:{Origin:origin,'Content-Type':'application/json','X-SRTB-Channel':channel},body:body===undefined?undefined:JSON.stringify(body)}),env,member);
const rule=(programme:string):ProgrammeRule=>({kind:'rule',name:programme,programme,keywords:programme,directoryId:null,preferredPath:null,kinds:['ba','popup']});
const read=async(id:string,member=reviewer,channel='benin-tv')=>(await call('/planner/'+id,'GET',undefined,member,channel))!.json<PlannerRecord<ProgrammeRule>>();
const save=(id:string,data:ProgrammeRule,revision=0,member=reviewer,channel='benin-tv')=>call('/planner/'+id,'PUT',{revision,data},member,channel);
let otherChannel:string;
beforeAll(async()=>{
 await applyD1Migrations(env.DB,inject('migrations'));
 for(const member of [reviewer,designer])await env.DB.prepare('INSERT INTO members(email,name,role,active,updated_by) VALUES(?,?,?,?,?)').bind(member.email,member.name,member.role,member.active,admin.email).run();
 otherChannel=(await(await call('/channels','POST',{name:'Recettes autre chaîne',accent:'#AA2233',timezone:'Africa/Porto-Novo'},admin))!.json<{id:string}>()).id;
 await call(`/channels/${otherChannel}/members`,'POST',{email:reviewer.email,allowed:true},admin);
});

it('narrows an emission rule to the exact episode without losing its folder, path or history',async()=>{
 const id=crypto.randomUUID(),data={...rule('magazine episode 17'),family:'magazine',preferredPath:'episodes/17.mp4'};
 await save(id,data);
 const {family:_,...episode}=data;
 await save(id,{...episode,kinds:[]},1);
 const current=await read(id);expect(current.revision).toBe(2);expect(current.data).toEqual({...episode,kinds:[]});
 const inherited=await(await call('/planner/rules','POST',{programmes:['magazine episode 18'],families:['magazine']}))!.json<{rules:unknown[]}>();expect(inherited.rules).toEqual([]);
 const exact=await(await call('/planner/rules','POST',{programmes:[episode.programme],families:[]}))!.json<{rules:PlannerRecord<ProgrammeRule>[]}>();expect(exact.rules[0].id).toBe(id);
 const old=await env.DB.prepare('SELECT data_json FROM planner_revisions WHERE document_id=? AND revision=1').bind(id).first<{data_json:string}>();expect(JSON.parse(old!.data_json)).toEqual(data);
});

it('stores a manually chosen emission scope without inventing observed confirmations or touching projects',async()=>{
 const before=await env.DB.prepare('SELECT COUNT(*) AS n FROM projects').first();
 const id=crypto.randomUUID(),data={...rule('choix editorial episode 2'),family:'choix editorial',kinds:['tds'] as ProgrammeRule['kinds']};
 await save(id,data);
 expect((await read(id)).data).toEqual(data);
 expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM habit_observations WHERE programme=?').bind(data.family).first()).toEqual({n:0});
 expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM habit_decisions WHERE programme=?').bind(data.family).first()).toEqual({n:0});
 expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM projects').first()).toEqual(before);
});

it('rejects designer writes even after a successful rule read, keeping the approved data',async()=>{
 const id=crypto.randomUUID(),data=rule('lecture sans approbation');await save(id,data);
 expect((await read(id,designer)).data).toEqual(data);
 await expect(save(id,{...data,kinds:[]},1,designer)).rejects.toMatchObject({status:403});
 await expect(save(crypto.randomUUID(),rule('regle refusee'),0,designer)).rejects.toMatchObject({status:403});
 await expect(call('/planner/'+id+'/archive','POST',{revision:1,archived:true},designer)).rejects.toMatchObject({status:403});
 expect((await read(id)).revision).toBe(1);
});

it('isolates manual rules with identical identities between channels and refuses foreign references',async()=>{
 const one=crypto.randomUUID(),two=crypto.randomUUID(),data=rule('meme identite episode');
 await save(one,data);await save(two,{...data,kinds:[]},0,reviewer,otherChannel);
 expect((await read(two,reviewer,otherChannel)).data.kinds).toEqual([]);
 await expect(read(one,reviewer,otherChannel)).rejects.toMatchObject({status:404});
 await expect(save(one,data,1,reviewer,otherChannel)).rejects.toMatchObject({status:404});
 const directory=crypto.randomUUID();
 await call('/planner/'+directory,'PUT',{revision:0,data:{kind:'directory',name:'Localisé BTV',files:[],scannedAt:'2026-09-29T10:00:00Z',partial:false}});
 await expect(save(two,{...data,directoryId:directory},1,reviewer,otherChannel)).rejects.toMatchObject({status:422});
 expect((await read(one)).revision).toBe(1);expect((await read(two,reviewer,otherChannel)).revision).toBe(1);
});

it('rechecks channel access between review and confirmation',async()=>{
 const id=crypto.randomUUID(),data=rule('droits revoques');await save(id,data,0,reviewer,otherChannel);
 expect((await read(id,reviewer,otherChannel)).revision).toBe(1);
 await call(`/channels/${otherChannel}/members`,'POST',{email:reviewer.email,allowed:false},admin);
 await expect(save(id,{...data,kinds:[]},1,reviewer,otherChannel)).rejects.toMatchObject({status:404});
 expect((await read(id,admin,otherChannel)).data).toEqual(data);
 await call(`/channels/${otherChannel}/members`,'POST',{email:reviewer.email,allowed:true},admin);
});

it('refuses stale revision and suspended accounts without partially changing the recipe',async()=>{
 const id=crypto.randomUUID(),data=rule('confirmation tardive');await save(id,data);
 await save(id,{...data,kinds:['renvoi']},1,admin);
 await expect(save(id,{...data,kinds:[]},1)).rejects.toMatchObject({status:409});
 await expect(save(id,{...data,kinds:[]},2,{...reviewer,active:0})).rejects.toMatchObject({status:403});
 expect((await read(id)).data.kinds).toEqual(['renvoi']);expect((await read(id)).revision).toBe(2);
});

it('keeps the observed habit candidate intact after a manual edit and blocks stale habit decisions',async()=>{
 const title='OBSERVATION DISTINCTE',programme='observation distincte';
 for(let i=1;i<=3;i++){
  const id=crypto.randomUUID(),data:Plan={kind:'plan',name:'Journée',source:'conducteur.pdf',sourceHash:String(i).repeat(64),rows:[{id:'row',title,subtitle:'Épisode 1',category:'',sheet:'Lundi',cell:'A1',raw:title,broadcastDate:'2026-09-28',airDate:'2026-09-28',time:'20:30',duration:null,included:true,kinds:['ba','popup'],formats:['tv'],issues:[],media:null,location:null}]};
  await call('/planner/'+id,'PUT',{revision:0,data});await call('/habits/confirm','POST',{planId:id,revision:1});
 }
 type Suggestion={programme:string;candidate:{name:string;kinds:string[];directoryId:null};revision:number|null;confirmations:number;ruleId:string;ruleRevision:number|null};
 const list=async()=>(await(await call('/habits'))!.json<{suggestions:Suggestion[]}>()).suggestions;
 const observed=(await list()).find(s=>s.programme===programme)!;
 expect(observed.ruleRevision).toBeNull();
 await call('/habits/decide','POST',{programme,candidate:observed.candidate,revision:0,action:'approve'});
 const approved=(await list()).find(s=>s.programme===programme)!,prior=await read(approved.ruleId);
 expect(approved.ruleRevision).toBe(prior.revision);
 await save(prior.id,{...prior.data,kinds:[]},prior.revision);
 const after=(await list()).find(s=>s.programme===programme)!;
 expect(after.candidate).toEqual(observed.candidate);expect(after.confirmations).toBe(3);expect(after.revision).toBe(approved.revision);
 expect(after.ruleRevision).toBe(approved.ruleRevision);expect(after.ruleRevision).not.toBe((await read(prior.id)).revision);
 for(const action of ['approve','disable','forget'])await expect(call('/habits/decide','POST',{programme,candidate:observed.candidate,revision:approved.revision,action})).rejects.toMatchObject({status:409});
 expect((await read(prior.id)).data.kinds).toEqual([]);
 await expect(call('/habits/decide','POST',{programme,candidate:{...observed.candidate,kinds:['tds']},revision:approved.revision,action:'approve'})).rejects.toMatchObject({status:409});
});
