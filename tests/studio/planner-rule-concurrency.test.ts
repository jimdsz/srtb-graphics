import {env} from 'cloudflare:workers';
import {applyD1Migrations} from 'cloudflare:test';
import {beforeAll,expect,it,inject} from 'vitest';
import {api} from '../../server/router';
import type {Member} from '../../src/studio/domain';
import type {PlannerRecord,ProgrammeRule} from '../../src/studio/day-planner-model';

const people:Member[]=Array.from({length:2},(_,i)=>({email:`rule-editor-${i}@example.test`,name:`Editor ${i}`,role:'broadcaster',active:1}));
const call=(id:string,method='GET',body?:unknown,actor=0)=>api(new Request(`https://studio.example/api/graphics/planner/${id}`,{method,headers:{Origin:'https://studio.example','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),env,people[actor]);
const rule=(programme:string,path='programme.mp4'):ProgrammeRule=>({kind:'rule',name:programme,programme,keywords:programme,directoryId:null,preferredPath:path,kinds:['ba','popup']});
const save=(id:string,data:ProgrammeRule,revision=0,actor=0)=>call(id,'PUT',{revision,data},actor);
const read=async(id:string)=>(await call(id))!.json<PlannerRecord<ProgrammeRule>>();
beforeAll(async()=>{await applyD1Migrations(env.DB,inject('migrations'));for(const m of people)await env.DB.prepare('INSERT INTO members(email,name,role,active,updated_by) VALUES(?,?,?,?,?)').bind(m.email,m.name,m.role,m.active,m.email).run();});

it('persists an empty individual recipe and shares it unchanged without changing old choices',async()=>{
 const id=crypto.randomUUID(),data={...rule('semainier seul episode 1','episode-1.mp4'),family:'semainier seul',kinds:[]};
 await save(id,data);
 expect((await read(id)).data).toEqual(data);
 const found=await(await call('rules','POST',{programmes:['semainier seul episode 2'],families:['semainier seul']},1))!.json<{rules:PlannerRecord<ProgrammeRule>[]}>();
 expect(found.rules).toHaveLength(1);expect(found.rules[0].data).toEqual(data);
 const changed={...data,kinds:['ba'] as ProgrammeRule['kinds']};
 await save(id,changed,1,1);
 await expect(save(id,data,1)).rejects.toMatchObject({status:409});
 expect((await read(id)).data).toEqual(changed);
 const old=await env.DB.prepare('SELECT data_json FROM planner_revisions WHERE document_id=? AND revision=1').bind(id).first<{data_json:string}>();
 expect(JSON.parse(old!.data_json)).toEqual(data);
});

it('allows one programme association among fifty simultaneous creations with different ids',async()=>{
 const programme='bonjour le benin',ids=Array.from({length:50},()=>crypto.randomUUID());
 const results=await Promise.allSettled(ids.map((id,i)=>save(id,rule(programme,`choice-${i}.mp4`),0,i%2)));
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 expect(results.filter(r=>r.status==='rejected'&&r.reason.status===409)).toHaveLength(49);
 const rows=await env.DB.prepare("SELECT id FROM planner_documents WHERE kind='rule' AND json_extract(data_json,'$.programme')=?").bind(programme).all<{id:string}>();
 expect(rows.results).toHaveLength(1);
 const winner=await read(rows.results[0].id),i=ids.indexOf(winner.id);
 expect(winner.data.preferredPath).toBe(`choice-${i}.mp4`);expect(winner.revision).toBe(1);
 expect((await save(winner.id,winner.data,0,i%2))!.status).toBe(200);
 expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM planner_revisions WHERE document_id=?').bind(winner.id).first<{n:number}>())!.n).toBe(1);
});

it('protects renamed associations and restores, while keeping normal revision updates and archives',async()=>{
 const a=crypto.randomUUID(),b=crypto.randomUUID();await save(a,rule('magazine a'));await save(b,rule('magazine b'));
 await expect(save(b,rule('magazine a'),1,1)).rejects.toMatchObject({status:409});expect((await read(b)).revision).toBe(1);
 await save(a,rule('magazine a','approved.mp4'),1,1);
 await expect(save(a,rule('magazine a','stale.mp4'),1)).rejects.toMatchObject({status:409});
 await call(a+'/archive','POST',{revision:2,archived:true});
 await save(b,rule('magazine a'),1,1);
 await expect(call(a+'/archive','POST',{revision:3,archived:false})).rejects.toMatchObject({status:409});
 expect((await read(a)).archived).toBe(true);expect((await read(a)).revision).toBe(3);
 await call(b+'/archive','POST',{revision:2,archived:true});
 await call(a+'/archive','POST',{revision:3,archived:false});
 expect((await read(a)).data.preferredPath).toBe('approved.mp4');expect((await read(a)).revision).toBe(4);
});

it('returns historical duplicates for explicit review instead of silently picking a winner',async()=>{
 const programme='historical duplicate',ids=[crypto.randomUUID(),crypto.randomUUID()];
 for(const [i,id] of ids.entries())await env.DB.prepare('INSERT INTO planner_documents(id,kind,name,data_json,created_by,updated_by) VALUES(?,?,?,?,?,?)').bind(id,'rule',programme,JSON.stringify(rule(programme,`old-${i}.mp4`)),people[i].email,people[i].email).run();
 const result=await(await call('rules','POST',{programmes:[programme]}))!.json<{rules:PlannerRecord<ProgrammeRule>[]}>();expect(result.rules.map(r=>r.id).sort()).toEqual([...ids].sort());
 await expect(save(ids[0],rule(programme,'arbitrary.mp4'),1)).rejects.toMatchObject({status:409});
 // No automatic cleanup. The author may archive their obsolete choice.
 await call(ids[1]+'/archive','POST',{revision:1,archived:true},1);
 await save(ids[0],rule(programme,'reviewed.mp4'),1);
 expect((await read(ids[1])).archived).toBe(true);expect((await read(ids[0])).data.preferredPath).toBe('reviewed.mp4');
});

it('retrieves opt-in programme recipes for another episode without changing earlier records or exposing unrelated rules',async()=>{
 const one=crypto.randomUUID(),two=crypto.randomUUID(),unrelated=crypto.randomUUID(),family='magazine du matin';
 const data={...rule(family+' episode 1','episode-1.mp4'),family};
 await save(one,data);await save(two,rule(family+' episode 2','episode-2.mp4'));await save(unrelated,{...rule('autre magazine episode 1'),family:'autre magazine'});
 const found=await(await call('rules','POST',{programmes:[family+' episode 3'],families:[family]},1))!.json<{rules:PlannerRecord<ProgrammeRule>[]}>();
 expect(found.rules.map(r=>r.id)).toEqual([one]);expect(found.rules[0].data.preferredPath).toBe('episode-1.mp4');
 const oldClient=await(await call('rules','POST',{programmes:[family+' episode 3']},1))!.json<{rules:PlannerRecord<ProgrammeRule>[]}>();expect(oldClient.rules).toEqual([]);
 const exact=await(await call('rules','POST',{programmes:[family+' episode 2'],families:[family]},1))!.json<{rules:PlannerRecord<ProgrammeRule>[]}>();expect(exact.rules.map(r=>r.id).sort()).toEqual([one,two].sort());
 expect((await read(one)).revision).toBe(1);expect((await read(two)).revision).toBe(1);
 await expect(call('rules','POST',{programmes:[],families:Array(601).fill(family)})).rejects.toBeDefined();
 await call(one+'/archive','POST',{revision:1,archived:true});
 const archived=await(await call('rules','POST',{programmes:[],families:[family]},1))!.json<{rules:PlannerRecord<ProgrammeRule>[]}>();expect(archived.rules).toEqual([]);
});
