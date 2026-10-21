import {env} from 'cloudflare:workers';
import {applyD1Migrations} from 'cloudflare:test';
import {beforeAll,it,expect,inject} from 'vitest';
import {api} from '../../server/router';
import type {Member} from '../../src/studio/domain';
import type {Plan,PlannerRecord} from '../../src/studio/day-planner-model';
const origin='https://studio.example',reviewer:Member={email:'reviewer@example.test',name:'Relecture',role:'broadcaster',active:1},a:Member={email:'a@example.test',name:'A',role:'designer',active:1},b:Member={email:'b@example.test',name:'B',role:'designer',active:1};
const call=(path:string,method='GET',body?:unknown,member=a)=>api(new Request(origin+'/api/graphics'+path,{method,headers:{Origin:origin,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),env,member);
const base=(name='MAGAZINE',hash='a'.repeat(64)):Plan=>({kind:'plan',name:'Journée',source:'conducteur.pdf',sourceHash:hash,rows:[{id:'row-1',title:name,subtitle:'Épisode 17',category:'Magazine',sheet:'Lundi',cell:'B2',raw:name,broadcastDate:'2026-09-28',airDate:'2026-09-28',time:'23:30:00',duration:1200,included:true,kinds:['ba','popup'],formats:['tv'],issues:[],media:null,location:null}]});
async function save(data=base()){return await(await call('/planner/'+crypto.randomUUID(),'PUT',{revision:0,data}))!.json<PlannerRecord<Plan>>();}
type Suggestion={programme:string;candidate:{name:string;kinds:string[];directoryId:string|null};confirmations:number;revision:number|null;state:string|null;ruleId:string|null};
async function suggestions(){return(await(await call('/habits'))!.json<{suggestions:Suggestion[]}>()).suggestions;}
async function learn(name:string){for(let i=1;i<=3;i++){const record=await save(base(name,String(i).repeat(64)));await call('/habits/confirm','POST',{planId:record.id,revision:1});}return(await suggestions()).find(s=>s.candidate.name===name)!;}
const decide=(s:Suggestion,action='approve',member=reviewer)=>call('/habits/decide','POST',{programme:s.programme,candidate:s.candidate,revision:s.revision??0,action},member);
beforeAll(async()=>{await applyD1Migrations(env.DB,inject('migrations'));for(const m of [a,b,reviewer])await env.DB.prepare('INSERT INTO members(email,name,role,active,updated_by) VALUES(?,?,?,?,?)').bind(m.email,m.name,m.role,m.active,m.email).run();});
it('allows exactly one concurrent claim and does not expose private projects in the team board',async()=>{
 const p=await save(),body={key:'ba:tv:row-1',revision:0,planRevision:1};
 const results=await Promise.allSettled([call(`/planner/${p.id}/assignments`,'POST',{...body,owner:a.email}),call(`/planner/${p.id}/assignments`,'POST',{...body,owner:b.email},b)]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected').map(r=>(r as PromiseRejectedResult).reason.status)).toEqual([409]);
 const assignment=await env.DB.prepare('SELECT owner FROM planner_assignments WHERE plan_id=?').bind(p.id).first<{owner:string}>(),owner=assignment!.owner===a.email?a:b,other=owner.email===a.email?b:a;
 const bodyTasks={revision:1,tasks:[{rowIds:['row-1'],kind:'ba',format:'tv'}]};
 await expect(call(`/planner/${p.id}/tasks`,'POST',bodyTasks,other)).rejects.toMatchObject({status:409});
 const created=await(await call(`/planner/${p.id}/tasks`,'POST',bodyTasks,owner))!.json<{tasks:{projectId:string}[]}>();
 const team=await(await call(`/planner/${p.id}/assignments`,'GET',undefined,other))!.json<{tasks:unknown[]}>();expect(JSON.stringify(team)).not.toContain(created.tasks[0].projectId);
 await expect(call('/projects/'+created.tasks[0].projectId,'GET',undefined,other)).rejects.toMatchObject({status:404});
 await expect(call(`/planner/${p.id}/assignments`,'POST',{...body,revision:1,owner:other.email},reviewer)).rejects.toMatchObject({status:409});
});
it('rejects stale plans and cross-user assignments, and permits releasing an unstarted task',async()=>{
 const p=await save(),path=`/planner/${p.id}/assignments`,body={key:'ba:tv:row-1',revision:0,planRevision:1};
 await expect(call(path,'POST',{...body,owner:b.email})).rejects.toMatchObject({status:403});
 await expect(call(path,'POST',{...body,owner:a.email,planRevision:2})).rejects.toMatchObject({status:409});
 await call(path,'POST',{...body,owner:a.email});await call(path,'POST',{...body,revision:1,owner:null});
 expect((await(await call(path))!.json<{tasks:unknown[]}>()).tasks).toEqual([]);
});
it('does not allow claiming a format or deliverable absent from the reviewed recipe',async()=>{
 const p=await save(),path=`/planner/${p.id}/assignments`;
 for(const key of ['ba:vertical:row-1','tds:tv:row-1','ba:tv:row-1:r2'])await expect(call(path,'POST',{key,revision:0,planRevision:1,owner:a.email})).rejects.toMatchObject({status:422});
});
it('transactional ownership guard understands row IDs beginning with r and encoded percent signs',async()=>{
 for(const rowId of ['row-1','r2','épisode%2']){
  const p=await save({...base(),rows:base().rows.map(row=>({...row,id:rowId}))}),key=`ba:tv:${encodeURIComponent(rowId)}`;
  await call(`/planner/${p.id}/assignments`,'POST',{key,revision:0,planRevision:1,owner:a.email});
  const projectId=crypto.randomUUID();
  await expect(env.DB.batch([
   env.DB.prepare("INSERT INTO projects(id,title,template_id,template_version,library_version,data_json,created_by,updated_by) VALUES(?,'test','BTV_BA_1P','1','1','{}',?,?)").bind(projectId,b.email,b.email),
   env.DB.prepare('INSERT INTO planner_personal_tasks(plan_id,task_key,project_id,source_revision,actor) VALUES(?,?,?,?,?)').bind(p.id,key+':r2',projectId,1,b.email),
  ])).rejects.toThrow('planner_assignment_conflict');
  expect(await env.DB.prepare('SELECT id FROM projects WHERE id=?').bind(projectId).first()).toBeNull();
 }
});
it('requires three distinct confirmed conductors, not three clicks or copies',async()=>{
 const p=await save(base('MÉMOIRE A'));for(let i=0;i<3;i++)await call('/habits/confirm','POST',{planId:p.id,revision:1});
 const clone=await save(base('MÉMOIRE A'));await call('/habits/confirm','POST',{planId:clone.id,revision:1});expect((await suggestions()).some(s=>s.candidate.name==='MÉMOIRE A')).toBe(false);
 for(const hash of ['b','c']){const next=await save(base('MÉMOIRE A',hash.repeat(64)));await call('/habits/confirm','POST',{planId:next.id,revision:1});}
 const s=(await suggestions()).find(s=>s.candidate.name==='MÉMOIRE A')!;expect(s.confirmations).toBe(3);expect(s.state).toBeNull();
 await expect(decide(s,'approve',a)).rejects.toMatchObject({status:403});
 await decide(s);const approved=(await suggestions()).find(i=>i.programme===s.programme)!;expect(approved.state).toBe('approved');
 const rule=await env.DB.prepare('SELECT data_json FROM planner_documents WHERE id=?').bind(approved.ruleId).first<{data_json:string}>();expect(JSON.parse(rule!.data_json)).toMatchObject({family:'memoire a',preferredPath:null,kinds:['ba','popup']});
 expect(JSON.stringify(approved.candidate)).not.toContain('Épisode');
});
it('skips inconsistent choices within one preparation and rejects stale confirmations',async()=>{
 const data=base('AMBIGU');data.rows.push({...data.rows[0],id:'autre',kinds:['tds']});const p=await save(data);
 expect(await(await call('/habits/confirm','POST',{planId:p.id,revision:1}))!.json()).toEqual({confirmed:0,ambiguous:1});
 await call(`/planner/${p.id}`,'PUT',{revision:1,data:{...data,name:'Modifiée'}});await expect(call('/habits/confirm','POST',{planId:p.id,revision:1})).rejects.toMatchObject({status:409});
});
it('serializes reviewer approval without leaving partial or duplicate rules',async()=>{
 const s=await learn('CONCURRENCE'),outcomes=await Promise.allSettled([decide(s),decide(s)]);
 expect(outcomes.filter(o=>o.status==='fulfilled')).toHaveLength(1);expect(outcomes.filter(o=>o.status==='rejected').map(o=>(o as PromiseRejectedResult).reason.status)).toEqual([409]);
 expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM planner_documents WHERE kind='rule' AND json_extract(data_json,'$.family')='concurrence'").first()).toEqual({n:1});
 expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM habit_write_guards').first()).toEqual({n:0});
});
it('disables, reapproves and forgets habits without editing existing projects or discarding manual rule changes',async()=>{
 let s=await learn('RÉVERSIBLE');await decide(s);s=(await suggestions()).find(i=>i.programme===s.programme)!;
 const projectCount=await env.DB.prepare('SELECT COUNT(*) AS n FROM projects').first();await decide(s,'disable');s=(await suggestions()).find(i=>i.programme===s.programme)!;expect(s.state).toBe('disabled');
 expect(await env.DB.prepare('SELECT archived FROM planner_documents WHERE id=?').bind(s.ruleId).first()).toEqual({archived:1});await decide(s);s=(await suggestions()).find(i=>i.programme===s.programme)!;
 await decide(s,'forget');expect((await suggestions()).some(i=>i.programme===s.programme)).toBe(false);expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM projects').first()).toEqual(projectCount);
 let manual=await learn('MANUELLE');await decide(manual);manual=(await suggestions()).find(i=>i.programme===manual.programme)!;
 await env.DB.prepare("UPDATE planner_documents SET revision=revision+1,name='Choix humain' WHERE id=?").bind(manual.ruleId).run();await expect(decide(manual)).rejects.toMatchObject({status:409});expect(await env.DB.prepare('SELECT name FROM planner_documents WHERE id=?').bind(manual.ruleId).first()).toEqual({name:'Choix humain'});
});
