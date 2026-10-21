import {env} from 'cloudflare:workers';
import {applyD1Migrations} from 'cloudflare:test';
import {beforeAll,beforeEach,it,expect,inject} from 'vitest';
import {api} from '../../server/router';
import type {Member} from '../../src/studio/domain';
import type {Plan,PlannerRecord,PlannerRow,PlannerTask} from '../../src/studio/day-planner-model';
import type {ProductionOverviewPage,ProductionOverviewView} from '../../src/studio/production-overview-model';
const origin='https://studio.example';let date='2026-10-01',day=0;
beforeEach(()=>{date=`2026-10-${String(++day).padStart(2,'0')}`;});
const a:Member={email:'overview-a@example.test',name:'A',role:'designer',active:1},b:Member={email:'overview-b@example.test',name:'B',role:'designer',active:1},reviewer:Member={email:'overview-review@example.test',name:'Relecture',role:'broadcaster',active:1};
const call=(path:string,method='GET',body?:unknown,member=a,channel='benin-tv')=>api(new Request(origin+'/api/graphics'+path,{method,headers:{Origin:origin,'Content-Type':'application/json','X-SRTB-Channel':channel},body:body===undefined?undefined:JSON.stringify(body)}),env,member);
const baseRow=(id='row'):PlannerRow=>({id,title:'LE MAGAZINE',subtitle:'',category:'Magazine',sheet:'Journée',cell:'B2',raw:'Texte brut confidentiel',broadcastDate:date,airDate:date,time:'23:30:00',duration:1200,included:true,kinds:['ba'],formats:['tv'],issues:[],media:null,location:null});
async function save(rows=[baseRow()],weekly?:Plan['weekly']){const data:Plan={kind:'plan',name:'Préparation test',source:'conducteur.pdf',sourceHash:'a'.repeat(64),rows,...(weekly?{weekly}:{})};return(await(await call('/planner/'+crypto.randomUUID(),'PUT',{revision:0,data}))!.json<PlannerRecord<Plan>>());}
async function overview(view:ProductionOverviewView,member=a,cursor?:string,channel='benin-tv'){return(await(await call('/planner/overview?'+new URLSearchParams({view,date,...(cursor?{cursor}:{})}),'GET',undefined,member,channel))!.json<ProductionOverviewPage>());}
const claim=(p:PlannerRecord<Plan>,key='ba:tv:row',member=a)=>call(`/planner/${p.id}/assignments`,'POST',{key,revision:0,planRevision:p.revision,owner:member.email},member);
async function create(p:PlannerRecord<Plan>,member=a){return(await(await call(`/planner/${p.id}/tasks`,'POST',{revision:p.revision,tasks:[{rowIds:[p.data.rows[0].id],kind:'ba',format:'tv'}]},member))!.json<{tasks:PlannerTask[]}>()).tasks[0];}
beforeAll(async()=>{await applyD1Migrations(env.DB,inject('migrations'));for(const m of [a,b,reviewer])await env.DB.prepare('INSERT INTO members(email,name,role,active,updated_by) VALUES(?,?,?,?,?)').bind(m.email,m.name,m.role,m.active,m.email).run();});
it('lists only the caller assignments and keeps after-midnight dates distinct from the conductor day',async()=>{
 const p=await save([{...baseRow(),airDate:'2026-10-02',time:'01:15:00'}]);await claim(p);
 expect((await overview('mine')).items).toEqual([expect.objectContaining({planId:p.id,rowId:'row',date:'2026-10-02',broadcastDate:date,time:'01:15:00',ownerName:'A',state:'assigned'})]);
 expect((await overview('mine',b)).items).toEqual([]);
 const serialized=JSON.stringify(await overview('mine'));expect(serialized).not.toContain('Texte brut');expect(serialized).not.toContain(a.email);
});
it('shows missing choices, not already selected local files, recurrent blocks or removed rows',async()=>{
 const p=await save([baseRow('missing'),{...baseRow('recurring'),kinds:[]},{...baseRow('excluded'),included:false},{...baseRow('removed'),sourceRemoved:true},{...baseRow('located'),location:{directoryId:crypto.randomUUID(),path:'secret/private-episode.mp4',size:1,modified:1}}]);
 const page=await overview('missing-media');expect(page.items.map(i=>i.rowId)).toEqual(['missing']);expect(page.items[0]).toMatchObject({planId:p.id,state:'missing-media',kind:null,format:null});expect(JSON.stringify(page)).not.toContain('private-episode');
});
it('review never reveals another designer’s private project but honors explicit sharing and reviewer access',async()=>{
 const p=await save(),task=await create(p);
 await env.DB.prepare("UPDATE projects SET status='submitted',revision=revision+1 WHERE id=?").bind(task.projectId).run();
 expect((await overview('review',a)).items[0].projectId).toBe(task.projectId);
 expect((await overview('review',b)).items).toEqual([]);
 expect((await overview('review',reviewer)).items[0].projectId).toBe(task.projectId);
 await env.DB.prepare("UPDATE projects SET visibility='team',revision=revision+1 WHERE id=?").bind(task.projectId).run();
 expect((await overview('review',b)).items[0].projectId).toBe(task.projectId);
});
it('archived drafts are not ready to validate and are labelled archived on the existing team board',async()=>{
 const p=await save(),task=await create(p);
 await env.DB.prepare("UPDATE projects SET status='submitted',archived=1,revision=revision+1 WHERE id=?").bind(task.projectId).run();
 expect((await overview('review')).items).toEqual([]);expect((await overview('mine')).items[0].state).toBe('archived');
 const board=await(await call(`/planner/${p.id}/assignments`))!.json<{tasks:{state:string}[]}>();expect(board.tasks[0].state).toBe('archived');
});
it('keeps only current reviewed recipes and exact encoded row identities',async()=>{
 const p=await save([baseRow('épisode%:r2'),baseRow('r2')]);await claim(p,'ba:tv:'+encodeURIComponent('épisode%:r2'));
 expect((await overview('mine')).items.map(i=>i.rowId)).toEqual(['épisode%:r2']);
 await call('/planner/'+p.id,'PUT',{revision:1,data:{...p.data,rows:p.data.rows.map(r=>({...r,kinds:[]}))}});
 expect((await overview('mine')).items).toEqual([]);
});
it('pages bounded results without duplicates and refuses a cursor from another view or chain',async()=>{
 const p=await save(Array.from({length:35},(_,i)=>baseRow('row-'+String(i).padStart(2,'0'))));
 const first=await overview('missing-media');expect(first.items).toHaveLength(30);expect(first.next).not.toBeNull();
 const next=await overview('missing-media',a,first.next!);expect(next.items).toHaveLength(5);expect(next.next).toBeNull();expect(new Set([...first.items,...next.items].map(i=>i.id)).size).toBe(35);
 await expect(overview('mine',a,first.next!)).rejects.toMatchObject({status:400});
 const changed=encodeURIComponent(JSON.stringify({...JSON.parse(decodeURIComponent(first.next!)),channel:'other'}));await expect(overview('missing-media',a,changed)).rejects.toMatchObject({status:400});
 expect(first.items.every(item=>item.planId===p.id)).toBe(true);
});
it('isolates channels and rejects invalid calendar dates, unwanted params and mutations',async()=>{
 await save();await env.DB.prepare("INSERT INTO channels(id,name,created_by) VALUES('overview-other','Autre',?)").bind(reviewer.email).run();
 await expect(overview('missing-media',a,undefined,'overview-other')).rejects.toMatchObject({status:404});
 await env.DB.prepare("INSERT INTO channel_members(channel_id,email) VALUES('overview-other',?)").bind(a.email).run();expect((await overview('missing-media',a,undefined,'overview-other')).items).toEqual([]);
 await expect(call('/planner/overview?view=mine&date=2026-02-30')).rejects.toThrow();
 await expect(call('/planner/overview?view=mine&date='+date+'&email='+b.email)).rejects.toThrow();
 await expect(call('/planner/overview','POST',{})).rejects.toMatchObject({status:405});
});
it('represents a weekly assignment once and includes weekly-only missing media',async()=>{
 const rows=Array.from({length:7},(_,i)=>({...baseRow('day-'+i),airDate:`2026-09-${String(23+i).padStart(2,'0')}`,kinds:[]})),ids=rows.map(row=>row.id),p=await save(rows,{rowIds:ids,formats:['tv']});
 await claim(p,'weekly:tv:'+ids.join(','));
 const mine=await overview('mine');expect(mine.items).toHaveLength(1);expect(mine.items[0]).toMatchObject({kind:'weekly',title:'Semainier',time:''});
 expect((await overview('missing-media')).items).toHaveLength(7);
});
it('can continue past a page of obsolete assignments without losing the remaining current task',async()=>{
 const rows=Array.from({length:31},(_,i)=>baseRow('row-'+String(i).padStart(2,'0'))),p=await save(rows);
 await env.DB.batch(rows.map(row=>env.DB.prepare('INSERT INTO planner_assignments(plan_id,task_key,owner,updated_by) VALUES(?,?,?,?)').bind(p.id,'ba:tv:'+row.id,a.email,a.email)));
 await call('/planner/'+p.id,'PUT',{revision:1,data:{...p.data,rows:rows.map((row,i)=>({...row,kinds:i===30?row.kinds:[]}))}});
 const first=await overview('mine');expect(first.items).toEqual([]);expect(first.next).not.toBeNull();
 const second=await overview('mine',a,first.next!);expect(second.items.map(item=>item.rowId)).toEqual(['row-30']);expect(second.next).toBeNull();
});
it('selects the latest numeric edition at the same source revision, never a superseded submitted project',async()=>{
 const p=await save();await create(p);
 await env.DB.prepare('UPDATE planner_documents SET revision=10 WHERE id=?').bind(p.id).run();
 const ids:Record<number,string>={};
 for(const edition of [2,10]){
  ids[edition]=crypto.randomUUID();
  await env.DB.batch([
   env.DB.prepare("INSERT INTO projects(id,title,template_id,template_version,library_version,data_json,created_by,updated_by) VALUES(?,'Test version','BTV_BA_1P','1','1','{}',?,?)").bind(ids[edition],a.email,a.email),
   env.DB.prepare('INSERT INTO planner_personal_tasks(plan_id,task_key,project_id,source_revision,actor) VALUES(?,?,?,?,?)').bind(p.id,`ba:tv:row:r${edition}`,ids[edition],10,a.email),
  ]);
 }
 await env.DB.prepare("UPDATE projects SET status='submitted',revision=revision+1 WHERE id=?").bind(ids[2]).run();
 const mine=await overview('mine');expect(mine.items).toHaveLength(1);expect(mine.items[0]).toMatchObject({projectId:ids[10],state:'draft'});
 expect((await overview('review',reviewer)).items).toEqual([]);
});
it('omits archived preparations and never returns a wrong-channel project from a damaged legacy ledger',async()=>{
 const p=await save(),task=await create(p);
 await env.DB.prepare("INSERT INTO channels(id,name,created_by) VALUES('overview-legacy','Autre chaîne',?)").bind(reviewer.email).run();
 const unrelated=crypto.randomUUID();
 await env.DB.prepare("INSERT INTO projects(id,channel_id,title,template_id,template_version,library_version,data_json,created_by,updated_by,status) VALUES(?,'overview-legacy','Privé','BTV_BA_1P','1','1','{}',?,?,'submitted')").bind(unrelated,a.email,a.email).run();
 await env.DB.prepare('UPDATE planner_personal_tasks SET project_id=? WHERE project_id=?').bind(unrelated,task.projectId).run();
 expect((await overview('mine')).items[0]).not.toHaveProperty('projectId');expect((await overview('review',reviewer)).items).toEqual([]);
 await env.DB.prepare('UPDATE planner_documents SET archived=1,revision=revision+1 WHERE id=?').bind(p.id).run();
 expect((await overview('mine')).items).toEqual([]);expect((await overview('missing-media')).items).toEqual([]);
});
