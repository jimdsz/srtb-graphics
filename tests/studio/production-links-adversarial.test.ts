import {env} from 'cloudflare:workers';
import {applyD1Migrations} from 'cloudflare:test';
import {beforeAll,expect,it,inject} from 'vitest';
import {api} from '../../server/router';
import type {Member} from '../../src/studio/domain';
import type {Plan,PlannerRow} from '../../src/studio/day-planner-model';
import type {ProductionLinksPage,ProductionLinksSection,ProductionProjectItem} from '../../src/studio/production-links-model';

// Independent real-D1 fixtures. No shared browser mocks or production records.
const origin='https://studio.example';
const a:Member={email:'links-a@example.test',name:'Graphiste A',role:'designer',active:1};
const b:Member={email:'links-b@example.test',name:'Graphiste B',role:'designer',active:1};
const reviewer:Member={email:'links-review@example.test',name:'Diffusion',role:'broadcaster',active:1};
const call=(path:string,member=a,channel='benin-tv',method='GET')=>api(new Request(origin+'/api/graphics'+path,{method,headers:{Origin:origin,'X-SRTB-Channel':channel}}),env,member);
const row=(id:string,programmeId?:string):PlannerRow=>({id,title:'MÊME TITRE',subtitle:'Épisode '+id,category:'Magazine',sheet:'Journée',cell:'B2',raw:'RAW-SOURCE-SECRET',broadcastDate:'2026-09-28',airDate:'2026-09-29',time:'01:15:00',duration:600,included:true,kinds:['ba'],formats:['tv'],issues:[],media:null,location:null,...(programmeId?{programmeId,programmeRevision:1}:{})});
async function programme(channel='benin-tv'){
 const id=crypto.randomUUID();await env.DB.prepare('INSERT INTO programmes(id,channel_id,name,identity,data_json,updated_by) VALUES(?,?,?,?,?,?)').bind(id,channel,'MÊME TITRE',id,JSON.stringify({name:'MÊME TITRE'}),a.email).run();return id;
}
async function plan(rows:PlannerRow[],weekly?:Plan['weekly'],channel='benin-tv'){
 const id=crypto.randomUUID(),data:Plan={kind:'plan',name:'Préparation indépendante',source:'conducteur.pdf',sourceHash:'b'.repeat(64),rows,...(weekly?{weekly}:{})};
 await env.DB.prepare("INSERT INTO planner_documents(id,kind,name,data_json,created_by,updated_by,channel_id) VALUES(?,'plan',?,?,?,?,?)").bind(id,data.name,JSON.stringify(data),a.email,a.email,channel).run();return {id,data,revision:1};
}
async function project(owner=a,visibility='private',channel='benin-tv',template='BTV_BA_1P'){
 const id=crypto.randomUUID();await env.DB.prepare('INSERT INTO projects(id,title,template_id,template_version,library_version,data_json,created_by,updated_by,visibility,channel_id) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,'PROJECT-'+id,template,'v-approved','library-approved',JSON.stringify({secret:'PROJECT-DATA-SECRET',media:'Y:/private/episode.mp4'}),owner.email,owner.email,visibility,channel).run();return id;
}
async function link(p:Awaited<ReturnType<typeof plan>>,key:string,owner=a,visibility='private',template='BTV_BA_1P'){
 const id=await project(owner,visibility,'benin-tv',template);await env.DB.prepare('INSERT INTO planner_personal_tasks(plan_id,task_key,project_id,source_revision,actor) VALUES(?,?,?,?,?)').bind(p.id,key,id,p.revision,owner.email).run();return id;
}
async function revise(p:Awaited<ReturnType<typeof plan>>,rows:PlannerRow[]){
 p.data={...p.data,rows};p.revision++;
 await env.DB.prepare('UPDATE planner_documents SET data_json=?,revision=?,updated_by=? WHERE id=?').bind(JSON.stringify(p.data),p.revision,a.email,p.id).run();
}
async function read(p:Awaited<ReturnType<typeof plan>>,section:ProductionLinksSection='deliverables',member=a,rowId=p.data.rows[0].id,cursor?:string){
 return(await call(`/planner/${p.id}/production-links?`+new URLSearchParams({rowId,revision:String(p.revision),section,...(cursor?{cursor}:{})}),member))!.json<ProductionLinksPage>();
}
const projects=(page:ProductionLinksPage)=>page.items.filter((item):item is ProductionProjectItem=>item.type==='project');
async function batch(source:string,child:string,owner=a,key='ba-vertical',announcement:unknown=null){
 const id=crypto.randomUUID(),p=await env.DB.prepare('SELECT template_id,template_version,library_version,revision FROM projects WHERE id=?').bind(source).first<{template_id:string;template_version:string;library_version:string;revision:number}>();
 await env.DB.prepare('INSERT INTO derivation_batches(id,request_id,request_hash,name,source_project_id,source_revision,source_template_id,source_template_version,source_library_version,source_snapshot_json,source_snapshot_sha256,mapping_version,target_count,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,crypto.randomUUID(),'a'.repeat(64),'Lot-'+id,source,p!.revision,p!.template_id,p!.template_version,p!.library_version,JSON.stringify({secret:'SNAPSHOT-SECRET'}),'b'.repeat(64),'test',1,owner.email).run();
 await env.DB.prepare("INSERT INTO project_derivations(batch_id,project_id,target_key,label,ordinal,warnings_json,announcement_json) VALUES(?,?,?,'Déclinaison',0,'[]',?)").bind(id,child,key,announcement===null?null:JSON.stringify(announcement)).run();return id;
}
beforeAll(async()=>{
 await applyD1Migrations(env.DB,inject('migrations'));
 for(const member of [a,b,reviewer])await env.DB.prepare('INSERT INTO members(email,name,role,active,updated_by) VALUES(?,?,?,?,?)').bind(member.email,member.name,member.role,1,member.email).run();
});

it('groups only durable programme ids, never identical labels, and keeps after-midnight dates',async()=>{
 const same=await programme(),other=await programme(),p=await plan([row('one',same),row('two',same),row('other',other),row('unlinked')]);
 const page=await read(p,'occurrences');expect(page.context).toMatchObject({scope:'programme',programmeId:same,planRevision:1});
 expect(page.items.map(item=>item.type==='occurrence'?item.occurrence.rowId:'')).toEqual(['one','two']);
 expect(page.items[0]).toMatchObject({occurrence:{airDate:'2026-09-29',broadcastDate:'2026-09-28',time:'01:15:00'}});
 const single=await read(p,'occurrences',a,'unlinked');expect(single.context.scope).toBe('line');expect(single.items).toHaveLength(1);
 expect(JSON.stringify(page)).not.toContain('RAW-SOURCE-SECRET');
});

it('reconstructs the creation identity after a row is reassigned without borrowing current labels',async()=>{
 const old=await programme(),current=await programme(),p=await plan([row('anchor',old)]),previous=await link(p,'ba:tv:anchor');
 await revise(p,[{...row('anchor',current),title:'NOUVELLE ÉMISSION'}]);const recent=await link(p,'ba:tv:anchor:r2');
 const page=projects(await read(p));
 expect(page.find(item=>item.project.id===previous)).toMatchObject({linkage:'different-programme',sourceRevision:1,origins:[{linkage:'different-programme',occurrence:{title:'MÊME TITRE'}}]});
 expect(page.find(item=>item.project.id===recent)).toMatchObject({linkage:'same-programme',sourceRevision:2});
 expect(page.find(item=>item.project.id===previous)?.origins[0].occurrence?.title).not.toBe('NOUVELLE ÉMISSION');
});

it('marks undocumented and missing creation snapshots instead of silently binding them',async()=>{
 const p=await plan([row('anchor')]),id=await link(p,'ba:tv:anchor');
 await revise(p,[row('anchor',await programme())]);
 expect(projects(await read(p)).find(item=>item.project.id===id)?.linkage).toBe('undocumented');
 await env.DB.prepare('DELETE FROM planner_revisions WHERE document_id=? AND revision=1').bind(p.id).run();
 const item=projects(await read(p)).find(item=>item.project.id===id);expect(item?.linkage).toBe('missing-history');expect(item?.origins[0].occurrence).toBeNull();
});

it('filters private drafts before the response and exposes no project payload, path or owner email',async()=>{
 const p=await plan([row('anchor',await programme())]),privateId=await link(p,'ba:tv:anchor',b),ownId=await link(p,'popup:tv:anchor',a);
 await env.DB.prepare('INSERT INTO planner_assignments(plan_id,task_key,owner,updated_by) VALUES(?,?,?,?)').bind(p.id,'ba:tv:anchor',b.email,b.email).run();
 const page=await read(p),serialized=JSON.stringify(page);expect(projects(page).map(item=>item.project.id)).toEqual([ownId]);
 for(const value of [privateId,'PROJECT-DATA-SECRET','episode.mp4',b.email])expect(serialized).not.toContain(value);
 const coordination=JSON.stringify(await read(p,'occurrences'));expect(coordination).toContain(b.name);expect(coordination).not.toContain(privateId);expect(coordination).not.toContain(b.email);
 expect(projects(await read(p,'deliverables',reviewer)).map(item=>item.project.id).sort()).toEqual([ownId,privateId].sort());
 await env.DB.prepare("UPDATE projects SET visibility='team',revision=revision+1 WHERE id=?").bind(privateId).run();
 expect(projects(await read(p)).map(item=>item.project.id).sort()).toEqual([ownId,privateId].sort());
});

it('requires simultaneous source, child and batch access and never walks grandchildren',async()=>{
 const p=await plan([row('anchor',await programme())]);
 const privateSource=await link(p,'ba:tv:anchor',b),sharedChild=await project(b,'team');await batch(privateSource,sharedChild,b);
 const sharedSource=await link(p,'popup:tv:anchor',b,'team'),childOfPrivateBatch=await project(b,'team');await batch(sharedSource,childOfPrivateBatch,b);
 const ownSource=await link(p,'tds:tv:anchor'),hiddenChild=await project(b),ownChild=await project(a,'private','benin-tv','BTV_EVENEMENT');await batch(ownSource,hiddenChild);await batch(ownSource,ownChild,a,'ba-vertical',{key:'today',day:'Lundi',time:'20:30',format:'vertical',voice:{secret:'VOICE-SECRET'}});
 const grandchild=await project(a);await batch(ownChild,grandchild);
 const page=await read(p,'derivations'),visible=projects(page);expect(visible.map(item=>item.project.id)).toEqual([ownChild]);expect(visible[0].project).toMatchObject({templateId:'BTV_EVENEMENT',templateVersion:'v-approved',libraryVersion:'library-approved'});
 for(const value of [privateSource,sharedChild,childOfPrivateBatch,hiddenChild,grandchild,'SNAPSHOT-SECRET','VOICE-SECRET','PROJECT-DATA-SECRET'])expect(JSON.stringify(page)).not.toContain(value);
 expect(projects(await read(p,'derivations',reviewer)).map(item=>item.project.id).sort()).toEqual([sharedChild,childOfPrivateBatch,hiddenChild,ownChild].sort());
});

it('includes a seven-programme weekly once with all historical contributions and actual template',async()=>{
 const programmeId=await programme(),rows=Array.from({length:7},(_,i)=>row('day-'+i,i<2?programmeId:undefined)),p=await plan(rows,{rowIds:rows.map(item=>item.id),formats:['tv']});
 const weeklyId=await link(p,'weekly:tv:'+rows.map(item=>item.id).join(','),a,'private','BTV_SEMAINIER');
 const page=projects(await read(p,'weekly'));expect(page).toHaveLength(1);expect(page[0]).toMatchObject({relation:'weekly',project:{id:weeklyId,templateId:'BTV_SEMAINIER'}});expect(page[0].origins).toHaveLength(7);expect(page[0].origins.filter(item=>item.linkage==='same-programme')).toHaveLength(2);
 expect(projects(await read(p,'deliverables'))).toEqual([]);
});

it('binds paginated snapshots to caller, section, anchor and revision without private-activity side channels',async()=>{
 const same=await programme(),rows=Array.from({length:65},(_,i)=>row('r'+String(i).padStart(2,'0'),same)),p=await plan(rows);
 for(const item of rows)await link(p,'ba:tv:'+item.id,a,'team');
 const first=await read(p);expect(first.next).not.toBeNull();
 const all=[...first.items];let next=first.next,iterations=0;
 while(next&&iterations++<10){const page=await read(p,'deliverables',a,rows[0].id,next);all.push(...page.items);next=page.next;}
 expect(next).toBeNull();expect(all).toHaveLength(65);expect(new Set(all.map(item=>item.id)).size).toBe(65);
 await expect(read(p,'deliverables',b,rows[0].id,first.next!)).rejects.toMatchObject({status:409});
 await expect(read(p,'weekly',a,rows[0].id,first.next!)).rejects.toMatchObject({status:409});
 await expect(read(p,'deliverables',a,rows[1].id,first.next!)).rejects.toMatchObject({status:409});
 const secret=await link(p,'popup:tv:'+rows[0].id,b);await env.DB.prepare("UPDATE projects SET title='PRIVATE CHANGE',revision=revision+1 WHERE id=?").bind(secret).run();
 expect((await read(p)).context.snapshot).toBe(first.context.snapshot);expect((await read(p,'deliverables',a,rows[0].id,first.next!)).items.length).toBeGreaterThan(0);
 const visible=projects(first)[0].project.id;await env.DB.prepare("UPDATE projects SET title='CHANGED VISIBLE',revision=revision+1 WHERE id=?").bind(visible).run();
 await expect(read(p,'deliverables',a,rows[0].id,first.next!)).rejects.toMatchObject({status:409});
 await revise(p,p.data.rows);await expect(read(p,'deliverables',a,rows[0].id,first.next!)).rejects.toThrow();
});

it('refuses writes, stale plans, suspended callers, removed memberships and foreign ledgers',async()=>{
 const p=await plan([row('anchor',await programme())]),id=await link(p,'ba:tv:anchor'),path=`/planner/${p.id}/production-links?rowId=anchor&revision=1&section=deliverables`;
 await expect(call(path,a,'benin-tv','POST')).rejects.toMatchObject({status:405});
 await expect(call(path,{...a,active:0})).rejects.toMatchObject({status:403});
 await expect(call(path.replace('revision=1','revision=2'))).rejects.toMatchObject({status:409});
 await env.DB.prepare("DELETE FROM channel_members WHERE channel_id='benin-tv' AND email=?").bind(b.email).run();await expect(call(path,b)).rejects.toMatchObject({status:404});
 await env.DB.prepare("INSERT INTO channel_members(channel_id,email) VALUES('benin-tv',?)").bind(b.email).run();
 const channel='links-'+crypto.randomUUID();await env.DB.prepare('INSERT INTO channels(id,name,created_by) VALUES(?,?,?)').bind(channel,'Autre',a.email).run();const foreign=await project(a,'team',channel);
 await env.DB.prepare('UPDATE planner_personal_tasks SET project_id=? WHERE project_id=?').bind(foreign,id).run();expect(projects(await read(p,'deliverables',reviewer))).toEqual([]);
 expect(JSON.stringify(await read(p,'occurrences',reviewer))).not.toContain(foreign);
 await env.DB.prepare('UPDATE planner_documents SET archived=1,revision=revision+1 WHERE id=?').bind(p.id).run();await expect(call(path)).rejects.toMatchObject({status:404});
});

it('keeps historical programme links when another row is removed and rejects revoked sharing mid-pagination',async()=>{
 const programmeId=await programme(),rows=Array.from({length:35},(_,i)=>row('edition-'+i,programmeId)),p=await plan(rows);
 const ids:string[]=[];for(const item of rows)ids.push(await link(p,'ba:tv:'+item.id,b,'team'));
 await revise(p,[rows[0]]);
 const first=await read(p);expect(first.next).not.toBeNull();const second=await read(p,'deliverables',a,rows[0].id,first.next!);
 const all=[...projects(first),...projects(second)];expect(all).toHaveLength(35);expect(all.every(item=>item.linkage==='same-programme')).toBe(true);
 expect(all.find(item=>item.project.id===ids[1])?.origins[0].occurrence?.subtitle).toBe('Épisode edition-1');
 const removed=projects(second)[0].project.id;await env.DB.prepare("UPDATE projects SET visibility='private',revision=revision+1 WHERE id=?").bind(removed).run();
 await expect(read(p,'deliverables',a,rows[0].id,first.next!)).rejects.toMatchObject({status:409});expect(JSON.stringify(await read(p))).not.toContain(removed);
});

it('enforces the visible ceiling without using inaccessible projects to deny the dossier',async()=>{
 const p=await plan([row('anchor',await programme())]);
 for(let start=0;start<2001;start+=50){
  const statements:D1PreparedStatement[]=[];
  for(let i=start;i<Math.min(start+50,2001);i++){
   const id=crypto.randomUUID(),owner=i%2?a:b;
   statements.push(env.DB.prepare("INSERT INTO projects(id,title,template_id,template_version,library_version,data_json,created_by,updated_by) VALUES(?,'Borne','BTV_BA_1P','1','1','{}',?,?)").bind(id,owner.email,owner.email));
   statements.push(env.DB.prepare('INSERT INTO planner_personal_tasks(plan_id,task_key,project_id,source_revision,actor) VALUES(?,?,?,?,?)').bind(p.id,'ba:tv:anchor:r'+(i+2),id,1,owner.email));
  }
  await env.DB.batch(statements);
 }
 expect(projects(await read(p)).length).toBeGreaterThan(0);
 await expect(read(p,'deliverables',reviewer)).rejects.toMatchObject({status:413});
},30000);

it('checks live membership state instead of trusting a stale authenticated role or active flag',async()=>{
 const p=await plan([row('anchor',await programme())]);
 await env.DB.prepare('UPDATE members SET active=0 WHERE email=?').bind(b.email).run();
 await expect(read(p,'occurrences',b)).rejects.toMatchObject({status:403});
 await env.DB.prepare("UPDATE members SET active=1,role='broadcaster' WHERE email=?").bind(b.email).run();
 await expect(read(p,'occurrences',b)).rejects.toMatchObject({status:403});
 await env.DB.prepare("UPDATE members SET role='designer' WHERE email=?").bind(b.email).run();
 expect((await read(p,'occurrences',b)).items).toHaveLength(1);
});
