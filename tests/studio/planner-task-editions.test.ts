import {env} from 'cloudflare:workers';
import {applyD1Migrations} from 'cloudflare:test';
import {beforeAll,expect,it,inject,vi} from 'vitest';
import {api} from '../../server/router';
import type {Member} from '../../src/studio/domain';
import {plannerProject} from '../../src/studio/day-planner-project';
import {createPlannerQueue} from '../../src/studio/day-planner-queue';
import {taskKey} from '../../src/studio/day-planner-model';
import type {Plan,PlannerRow,PlannerTask,PlannerTaskChoice,PlannerRecord} from '../../src/studio/day-planner-model';
import {weeklyChoices} from '../../src/studio/planner-weekly';

const origin='https://studio.example';
const owner:Member={email:'edition-owner@example.test',name:'Auteur',role:'designer',active:1};
const colleague:Member={email:'edition-colleague@example.test',name:'Collègue',role:'designer',active:1};
const director:Member={email:'edition-director@example.test',name:'Diffusion',role:'broadcaster',active:1};
const admin:Member={email:'admin@example.com',name:'Admin',role:'admin',active:1};
const media=(digit:string,name:string)=>({url:'local-media:'+digit.repeat(64)+':100',name,mimeType:'video/mp4'});
const row=(id='a'):PlannerRow=>({id,sheet:'LUNDI',cell:'B12',raw:'Programme',title:'Titre initial',subtitle:'Épisode 1',category:'Magazine',broadcastDate:'2026-09-07',airDate:'2026-09-07',time:'20:30:00',duration:1800,included:true,kinds:['ba','popup'],formats:['tv'],issues:[],media:media('a','ancien.mp4'),location:null});
const plan=():Plan=>({kind:'plan',name:'Préparation des éditions',source:'test.xlsx',sourceHash:'a'.repeat(64),rows:[row('a'),row('b')]});
const choice:PlannerTaskChoice={kind:'ba',format:'tv',rowIds:['a']};
const call=(path:string,method='GET',body?:unknown,member=owner)=>api(new Request(origin+'/api/graphics'+path,{method,headers:{Origin:origin,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),env,member);
async function save(data=plan()){
 const id=crypto.randomUUID();await call('/planner/'+id,'PUT',{revision:0,data});return id;
}
async function update(id:string,revision:number,data:Plan){return (await call('/planner/'+id,'PUT',{revision,data}))!.json<PlannerRecord<Plan>>();}
async function create(id:string,revision:number,tasks:PlannerTaskChoice[],member=owner){return (await call('/planner/'+id+'/tasks','POST',{revision,tasks,response:'requested'},member))!.json<{tasks:PlannerTask[]}>();}
async function ledger(id:string,member=owner){return (await(await call('/planner/'+id+'/tasks','GET',undefined,member))!.json<{tasks:PlannerTask[]}>()).tasks;}
type StoredProject={id:string;title:string;status:string;revision:number;data_json:string;archived:number;visibility:string;created_by:string};
async function project(id:string){return (await env.DB.prepare('SELECT id,title,status,revision,data_json,archived,visibility,created_by FROM projects WHERE id=?').bind(id).first<StoredProject>())!;}
async function countProjects(){return (await env.DB.prepare('SELECT COUNT(*) AS n FROM projects').first<{n:number}>())!.n;}
beforeAll(async()=>{
 await applyD1Migrations(env.DB,inject('migrations'));
 for(const member of [owner,colleague,director])await env.DB.prepare('INSERT INTO members(email,name,role,active,updated_by) VALUES(?,?,?,?,?)').bind(member.email,member.name,member.role,member.active,member.email).run();
});

it('creates a current private draft from the revised grid without rewriting the original, its sound or history',async()=>{
 const data=plan(),id=await save(data),original=(await create(id,1,[choice])).tasks[0];
 const edited=JSON.parse((await project(original.projectId)).data_json);
 Object.assign(edited,{_audio_voice_enabled:true,_audio_voice_url:{url:'local-media:'+'c'.repeat(64)+':100',name:'voix-retouchee.wav',mimeType:'audio/wav'}});
 await env.DB.prepare("UPDATE projects SET title='Montage validé',data_json=?,status='approved',archived=1,visibility='team',revision=revision+1 WHERE id=?").bind(JSON.stringify(edited),original.projectId).run();
 const before=await project(original.projectId),historyBefore=(await env.DB.prepare('SELECT * FROM revisions WHERE project_id=? ORDER BY revision').bind(original.projectId).all()).results;
 Object.assign(data.rows[0],{title:'Titre corrigé',time:'22:15:00',media:media('b','nouveau.mp4')});await update(id,1,data);
 const refreshed=(await create(id,2,[{...choice,edition:2}])).tasks[0],fresh=await project(refreshed.projectId);
 expect(refreshed).toMatchObject({key:'ba:tv:a:r2',sourceRevision:2,status:'draft',archived:false});expect(refreshed.projectId).not.toBe(original.projectId);
 expect(fresh).toMatchObject({visibility:'private',created_by:owner.email,revision:1,status:'draft',archived:0});
 expect(JSON.parse(fresh.data_json)).toEqual(plannerProject(data,choice).data);
 expect(JSON.parse(fresh.data_json)).toMatchObject({_titre_ligne_1:'Titre corrigé',_heure_1:'22h15',_media_body_url:media('b','nouveau.mp4'),_audio_voice_enabled:false});
 expect(await project(original.projectId)).toEqual(before);
 expect((await env.DB.prepare('SELECT * FROM revisions WHERE project_id=? ORDER BY revision').bind(original.projectId).all()).results).toEqual(historyBefore);
 expect((await create(id,2,[choice])).tasks[0].projectId).toBe(original.projectId);
 expect((await create(id,2,[{...choice,edition:2,signature:true}])).tasks[0].projectId).toBe(refreshed.projectId);
 expect(await project(refreshed.projectId)).toEqual(fresh);
 expect(await ledger(id)).toHaveLength(2);
 data.rows[0].time='23:00:00';await update(id,2,data);
 await expect(create(id,3,[{...choice,edition:2}])).rejects.toMatchObject({status:409});
 const third=(await create(id,3,[{...choice,edition:3}])).tasks[0];
 expect(third.projectId).not.toBe(refreshed.projectId);expect(third.sourceRevision).toBe(3);
 expect(await project(refreshed.projectId)).toEqual(fresh);expect(await project(original.projectId)).toEqual(before);
 expect(await ledger(id)).toHaveLength(3);
});

it('refreshes all seven weekly slots in all three formats and retains every original semainier',async()=>{
 const data=plan();data.rows=Array.from({length:7},(_,i)=>({...row(String(i)),title:'Initial '+i,airDate:`2026-09-${String(7+i).padStart(2,'0')}`}));
 data.weekly={rowIds:data.rows.map(r=>r.id),formats:['tv','portrait','vertical'],startDate:'2026-09-07'};
 const id=await save(data),choices=weeklyChoices(data),originals=(await create(id,1,choices)).tasks,before=await Promise.all(originals.map(task=>project(task.projectId)));
 data.rows.forEach((r,i)=>Object.assign(r,{title:`Corrigé ${i}`,time:`${12+i}:15:00`,media:media(String(i+1),`corrige-${i}.mp4`)}));await update(id,1,data);
 const refreshed=(await create(id,2,choices.map(c=>({...c,edition:2})))).tasks;expect(refreshed).toHaveLength(3);
 for(const task of refreshed){
  const stored=await project(task.projectId),settings=JSON.parse(stored.data_json);
  expect(task.key.endsWith(':r2')).toBe(true);expect(originals.some(old=>old.projectId===task.projectId)).toBe(false);
  expect(stored).toMatchObject({visibility:'private',created_by:owner.email,status:'draft'});
  for(let i=0;i<7;i++){expect(settings[`programme_${i+1}_title`]).toBe(`Corrigé ${i}`);expect(settings[`programme_${i+1}_category`]).toContain(`${12+i}H15`);expect(settings[`_media_programme_${i+1}_url`]).toEqual(data.rows[i].media);}
 }
 expect(await Promise.all(originals.map(task=>project(task.projectId)))).toEqual(before);
 await expect(create(id,2,[{...choices[0],rowIds:[...choices[0].rowIds].reverse(),edition:2}])).rejects.toMatchObject({status:409});
 expect(await ledger(id)).toHaveLength(6);
});

it('serializes two identical edition requests for one actor without duplicates or orphaned projects',async()=>{
 const data=plan(),id=await save(data);await create(id,1,[choice]);data.rows[0].title='Révision deux';await update(id,1,data);
 const before=await countProjects(),requested={...choice,edition:2};
 const results=await Promise.all([create(id,2,[requested]),create(id,2,[requested])]);
 expect(results[0].tasks.map(task=>task.projectId)).toEqual(results[1].tasks.map(task=>task.projectId));
 expect(await ledger(id)).toHaveLength(2);expect(await countProjects()).toBe(before+1);
 expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM projects p WHERE p.created_by=? AND NOT EXISTS(SELECT 1 FROM planner_personal_tasks t WHERE t.project_id=p.id)').bind(owner.email).first<{n:number}>())?.n).toBe(0);
});

it('resumes a committed edition after a lost response without replacing edited originals or editions',async()=>{
 const data=plan(),id=await save(data);await create(id,1,[choice]);data.rows[0].title='Nouvelle version';const record=await update(id,1,data),choices=[{...choice,edition:2}];
 let calls=0,lost=true;
 const transport={tasks:async()=>({tasks:await ledger(id)}),create:async(_id:string,revision:number,requested:PlannerTaskChoice[])=>{calls++;const result=await create(id,revision,requested);if(lost){lost=false;throw Error('Réponse perdue après transaction');}return result;}};
 await expect(createPlannerQueue({record,choices,api:transport,signal:new AbortController().signal,onProgress:()=>{}})).rejects.toThrow('Réponse perdue');
 const saved=(await ledger(id)).find(task=>task.key===taskKey(choices[0]))!;
 await env.DB.prepare("UPDATE projects SET title='Édition relue',revision=revision+1 WHERE id=?").bind(saved.projectId).run();const before=await project(saved.projectId);
 const result=await createPlannerQueue({record,choices,api:transport,signal:new AbortController().signal,onProgress:()=>{}});
 expect(result.completed).toBe(1);expect(calls).toBe(1);expect(await ledger(id)).toHaveLength(2);expect(await project(saved.projectId)).toEqual(before);
});

it('rejects missing predecessors, wrong bases, same-revision originals, stale/future editions and invalid suffix values before writing',async()=>{
 const data=plan(),id=await save(data);await create(id,1,[choice]);await update(id,1,data);await update(id,2,data);
 const before=await countProjects();
 for(const edition of [2,4])await expect(create(id,3,[{...choice,edition}])).rejects.toMatchObject({status:409});
 await expect(create(id,2,[{...choice,edition:2}])).rejects.toMatchObject({status:409});
 for(const other of [{...choice,rowIds:['b']},{...choice,format:'portrait' as const},{...choice,kind:'popup' as const}])await expect(create(id,3,[{...other,edition:3}])).rejects.toMatchObject({status:409});
 // One valid choice before an invalid choice must not produce a partial lot.
 await expect(create(id,3,[{...choice,edition:3},{...choice,rowIds:['b'],edition:3}])).rejects.toMatchObject({status:409});
 for(const edition of [0,1,-1,2.5,Number.MAX_SAFE_INTEGER+1])await expect(create(id,3,[{...choice,edition}])).rejects.toThrow();
 expect(await countProjects()).toBe(before);expect(await ledger(id)).toHaveLength(1);
 const empty=await save(data);await update(empty,1,data);await expect(create(empty,2,[{...choice,edition:2}])).rejects.toMatchObject({status:409});
 await create(empty,2,[choice]);await expect(create(empty,2,[{...choice,edition:2}])).rejects.toMatchObject({status:409});
 expect(await ledger(empty)).toHaveLength(1);
});

it('uses only the requesting actor’s lineage and keeps every refreshed project private even when an original is shared',async()=>{
 const data=plan(),id=await save(data),original=(await create(id,1,[choice])).tasks[0];
 await call('/projects/'+original.projectId+'/sharing','POST',{revision:1,visibility:'team'});
 await update(id,1,data);
 for(const member of [colleague,admin,director]){
  expect(await ledger(id,member)).toHaveLength(0);
  await expect(create(id,2,[{...choice,edition:2}],member)).rejects.toMatchObject({status:409});
 }
 const refreshed=(await create(id,2,[{...choice,edition:2}])).tasks[0];
 expect(await project(refreshed.projectId)).toMatchObject({visibility:'private',created_by:owner.email});
 for(const member of [owner,admin,director])expect((await call('/projects/'+refreshed.projectId,'GET',undefined,member))!.status).toBe(200);
 await expect(call('/projects/'+refreshed.projectId,'GET',undefined,colleague)).rejects.toMatchObject({status:404});
 await expect(call('/projects/'+refreshed.projectId+'/export','POST',{revision:1},colleague)).rejects.toMatchObject({status:404});
 const listing=await(await call('/projects','GET',undefined,colleague))!.json<{projects:{id:string}[]}>();expect(listing.projects.some(p=>p.id===refreshed.projectId)).toBe(false);
 await expect(create(id,2,[choice],colleague)).rejects.toMatchObject({status:409});await update(id,2,data);
 await expect(create(id,3,[{...choice,edition:3}],colleague)).rejects.toMatchObject({status:409});
 expect((await ledger(id,colleague)).some(task=>task.projectId===refreshed.projectId||task.projectId===original.projectId)).toBe(false);
});

it('keeps the 2000-project quota atomic for editions and allows idempotent retries at the limit',async()=>{
 const data=plan(),id=await save(data),second={...choice,rowIds:['b']};await create(id,1,[choice,second]);
 const seed=plannerProject(data,choice),prefix=crypto.randomUUID();
 await env.DB.prepare("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1997) INSERT INTO projects(id,title,template_id,template_version,library_version,data_json,created_by,updated_by) SELECT ?||':'||x,'Quota',?,?,?,?,?,? FROM n").bind(prefix,seed.template.id,seed.template.version,seed.template.libraryVersion,JSON.stringify(seed.data),owner.email,owner.email).run();
 await env.DB.prepare("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1997) INSERT INTO planner_personal_tasks(plan_id,task_key,project_id,source_revision,actor) SELECT ?,'ba:tv:quota-'||x,?||':'||x,1,? FROM n").bind(id,prefix,owner.email).run();
 await update(id,1,data);const before=await countProjects();
 await expect(create(id,2,[{...choice,edition:2},{...second,edition:2}])).rejects.toMatchObject({status:409});
 expect(await countProjects()).toBe(before);expect(await ledger(id)).toHaveLength(1999);
 const final=(await create(id,2,[{...choice,edition:2}])).tasks[0];expect(await ledger(id)).toHaveLength(2000);
 expect((await create(id,2,[{...choice,edition:2}])).tasks[0].projectId).toBe(final.projectId);
 await expect(create(id,2,[{...second,edition:2}])).rejects.toMatchObject({status:409});expect(await countProjects()).toBe(before+1);
},30000);

it('rolls back an edition and its history if the grid changes after validation but before the transaction',async()=>{
 const data=plan(),id=await save(data);await create(id,1,[choice]);await update(id,1,data);const before=await countProjects();
 const runBatch=env.DB.batch.bind(env.DB),spy=vi.spyOn(env.DB,'batch').mockImplementationOnce(async statements=>{
  await env.DB.prepare('UPDATE planner_documents SET revision=revision+1 WHERE id=?').bind(id).run();return runBatch(statements);
 });
 try{await expect(create(id,2,[{...choice,edition:2}])).rejects.toMatchObject({status:409});}finally{spy.mockRestore();}
 expect(await countProjects()).toBe(before);expect(await ledger(id)).toHaveLength(1);
 expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM revisions r WHERE NOT EXISTS(SELECT 1 FROM projects p WHERE p.id=r.project_id)').first<{n:number}>())?.n).toBe(0);
});
