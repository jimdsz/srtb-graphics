import {env} from 'cloudflare:workers';
import {applyD1Migrations} from 'cloudflare:test';
import {beforeAll,expect,it,inject,vi} from 'vitest';
import worker from '../../server/pages-worker';
import type {Project} from '../../src/studio/domain';
import type {PreparationProfile,PreparationRevisionPage} from '../../src/studio/preparation-profile-model';
import {programmeIdentity,taskKey} from '../../src/studio/day-planner-model';
import type {DirectoryIndex,Plan,PlannerRecord,PlannerTask,PlannerTaskChoice,ProgrammeRule} from '../../src/studio/day-planner-model';

const origin='https://load-test.example',count=60;
const config={...env,AUTH_MODE:'firebase',FIREBASE_PROJECT_ID:'srtb-test-auth',FIREBASE_API_KEY:'AIza'+'x'.repeat(35)};
const context={waitUntil:vi.fn()} as unknown as ExecutionContext;
const cookies:string[]=[];
beforeAll(async()=>{
  await applyD1Migrations(env.DB,inject('migrations'));
  for(let i=0;i<count;i++){
    const token=i.toString(16).padStart(64,'a'),email=`load-${i}@example.test`,uid=`load-${i}`;
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');
    await env.DB.batch([
      env.DB.prepare("INSERT INTO members(email,name,role,active,firebase_uid,updated_by) VALUES(?,?,'designer',1,?,'recette')").bind(email,uid,uid),
      env.DB.prepare('INSERT INTO app_sessions(token_hash,email,firebase_uid,expires_at,created_at) VALUES(?,?,?,?,?)').bind(hash,email,uid,Date.now()+3600000,Date.now()),
    ]);cookies.push('__Host-srtb_session='+token);
  }
});
async function call(index:number,path:string,method='GET',body?:unknown){
  return worker.fetch(new Request(origin+path,{method,headers:{Cookie:cookies[index],Origin:origin,'CF-Connecting-IP':'192.0.2.50','Content-Type':'application/json','X-SRTB-Derivations':'1'},body:body===undefined?undefined:JSON.stringify(body)}),config,context);
}
it('isolates 60 simultaneous identities, projects, saves and export snapshots',async()=>{
  const start=performance.now(),latencies:number[]=[];
  const projects=await Promise.all(cookies.map(async(_,index)=>{
    const before=performance.now();
    const me=await call(index,'/api/me');expect(me.status).toBe(200);expect((await me.json<{email:string}>()).email).toBe(`load-${index}@example.test`);
    const response=await call(index,'/api/graphics/projects','POST',{title:`Charge ${index}`,templateId:'BTV_Relais_Antenne'});expect(response.status).toBeLessThan(300);
    const project=await response.json<Project>();expect(project.created_by).toBe(`load-${index}@example.test`);
    const saved=await call(index,`/api/graphics/projects/${project.id}`,'PUT',{revision:project.revision,title:project.title+' modifié',data:project.data});expect(saved.status).toBe(200);
    const current=await saved.json<Project>();expect(current.updated_by).toBe(`load-${index}@example.test`);
    const exported=await call(index,`/api/graphics/projects/${project.id}/export`,'POST',{title:current.title,revision:current.revision,data:current.data});expect(exported.status).toBe(200);
    latencies.push(performance.now()-before);return current;
  }));
  expect(new Set(projects.map(p=>p.id)).size).toBe(count);
  let target=projects[0];
  const privateReads=await Promise.all(cookies.slice(1).map((_,index)=>call(index+1,`/api/graphics/projects/${target.id}`)));
  expect(privateReads.every(r=>r.status===404)).toBe(true);
  const shared=await call(0,`/api/graphics/projects/${target.id}/sharing`,'POST',{revision:target.revision,visibility:'team'});
  expect(shared.status).toBe(200);target=await shared.json<Project>();
  const collisions=await Promise.all(cookies.map((_,index)=>call(index,`/api/graphics/projects/${target.id}`,'PUT',{revision:target.revision,title:`Concurrent ${index}`,data:target.data})));
  expect(collisions.filter(r=>r.status===200)).toHaveLength(1);expect(collisions.filter(r=>r.status===409)).toHaveLength(count-1);
  const revisions=await (await call(0,`/api/graphics/projects/${target.id}/revisions`)).json<{revision:number}[]>();expect(revisions.map(r=>r.revision)).toEqual([4,3,2,1]);
  latencies.sort((a,b)=>a-b);
  console.info(JSON.stringify({test:'local-workers-concurrency',users:count,requests:361,elapsedMs:Math.round(performance.now()-start),journeyP50Ms:Math.round(latencies[30]),journeyP95Ms:Math.round(latencies[57]),successfulConcurrentSave:1,conflictsSafelyRejected:59}));
});

it('keeps 50 preparation writers isolated and atomically resolves an edit/favorite collision',async()=>{
  // Local D1 correctness exercise, not a production latency or capacity benchmark.
  const clients=cookies.slice(0,50),base='/api/graphics/preparation-profiles';
  const profiles=await Promise.all(clients.map(async(_,index)=>{
    const response=await call(index,base,'POST',{kind:'programme',name:`Fiche ${index}`,data:{title:`Programme ${index}`,logo:null,palette:['#f0b900','#ffffff'],appointments:[],voice:null}});
    expect(response.status).toBe(201);
    const created=await response.json<PreparationProfile>();
    expect(created.created_by).toBe(`load-${index}@example.test`);
    const saved=await call(index,`${base}/${created.id}`,'PUT',{revision:created.revision,name:`Fiche modifiée ${index}`,data:created.data});
    expect(saved.status).toBe(200);
    const current=await saved.json<PreparationProfile>();
    expect(current).toMatchObject({revision:2,created_by:`load-${index}@example.test`,updated_by:`load-${index}@example.test`});
    return current;
  }));
  expect(new Set(profiles.map(profile=>profile.id)).size).toBe(50);
  const target=profiles[0];
  const collisions=await Promise.all(clients.map((_,index)=>index%2
    ?call(index,`${base}/${target.id}/favorite`,'POST',{revision:2,favorite:true})
    :call(index,`${base}/${target.id}`,'PUT',{revision:2,name:`Édition concurrente ${index}`,data:target.data})));
  expect(collisions.filter(response=>response.status===200)).toHaveLength(1);
  expect(collisions.filter(response=>response.status===409)).toHaveLength(49);
  const winner=await collisions.find(response=>response.status===200)!.json<PreparationProfile>();
  const current=await (await call(0,`${base}/${target.id}`)).json<PreparationProfile>();
  expect(current).toEqual(winner);expect(current.created_by).toBe('load-0@example.test');expect(current.revision).toBe(3);
  const history=await (await call(0,`${base}/${target.id}/revisions`)).json<PreparationRevisionPage>();
  expect(history.revisions.map(revision=>revision.revision)).toEqual([3,2,1]);
  const audit=await env.DB.prepare('SELECT actor,action FROM activity WHERE target=? ORDER BY id').bind(target.id).all();
  expect(audit.results).toHaveLength(3);
  expect(audit.results[2]).toEqual({actor:winner.updated_by,action:winner.favorite?'preparation_profile.favorite':'preparation_profile.saved'});
});

it('shares a planner across 60 users, assigns each requested task once and keeps the eight drafts private and retry-safe',async()=>{
  // Real local Worker authentication, routing and D1 transactions. This does not
  // simulate 60 browsers decoding video or measure Cloudflare production capacity.
  const base='/api/graphics/planner',planId=crypto.randomUUID(),directoryId=crypto.randomUUID(),ruleId=crypto.randomUUID();
  const directory:DirectoryIndex={kind:'directory',name:'Programmes de recette',scannedAt:'2026-09-25T09:00:00.000Z',partial:false,
    files:Array.from({length:7},(_,i)=>({path:`programme-${i}/Magazine ${i}.mp4`,name:`Magazine ${i}.mp4`,size:1024+i,modified:1790313600000}))};
  const plan:Plan={kind:'plan',name:'Semaine partagée · recette isolée',source:'grille-test.xlsx',sourceHash:'b'.repeat(64),rows:directory.files.map((file,i)=>{
    const source=`local-media:${String(i+1).repeat(64)}:${file.size}`;
    return {id:`row-${i}`,sheet:'Grille semaine',cell:`B${i+10}`,raw:`MAGAZINE : Magazine ${i} N°${i+1}`,title:`Magazine ${i}`,subtitle:`N°${i+1}`,category:'Magazine',
      broadcastDate:`2026-09-${7+i<10?'0':''}${7+i}`,airDate:`2026-09-${7+i<10?'0':''}${7+i}`,time:'20:30:00',duration:1800,
      included:true,kinds:['ba','popup','tds','renvoi','event'],formats:['tv','portrait','vertical'],issues:[],
      media:{url:source,name:file.name,mimeType:'video/mp4'},location:{directoryId,path:file.path,size:file.size,modified:file.modified},
      excerpt:{source,start:12+i,end:20+i,duration:1800}};
  })};
  plan.weekly={rowIds:plan.rows.map(row=>row.id),formats:['tv','portrait','vertical']};
  const rule:ProgrammeRule={kind:'rule',name:'Magazine 0',programme:programmeIdentity(plan.rows[0]),keywords:'Magazine 0',directoryId,preferredPath:directory.files[0].path,kinds:['ba','popup','tds']};
  // Shared rules now require an explicit reviewer; restore the creator role
  // before testing private project visibility for the 60 operators.
  await env.DB.prepare("UPDATE members SET role='broadcaster' WHERE email='load-0@example.test'").run();
  for(const [id,data] of [[directoryId,directory],[ruleId,rule],[planId,plan]] as const){
    const saved=await call(0,`${base}/${id}`,'PUT',{revision:0,data});expect(saved.status).toBe(201);
  }
  await env.DB.prepare("UPDATE members SET role='designer' WHERE email='load-0@example.test'").run();
  const choices:PlannerTaskChoice[]=[
    {kind:'ba',format:'tv',rowIds:['row-0'],signature:true},
    {kind:'popup',format:'tv',rowIds:['row-0']},
    {kind:'tds',format:'tv',rowIds:['row-0']},
    {kind:'renvoi',format:'portrait',rowIds:['row-0']},
    {kind:'event',format:'vertical',rowIds:['row-0']},
    ...plan.weekly.formats.map(format=>({kind:'weekly' as const,format,rowIds:plan.weekly!.rowIds})),
  ];
  const request={revision:1,tasks:choices,response:'requested'},expectedKeys=choices.map(taskKey).sort();
  const mediaBefore=await env.DB.prepare('SELECT COUNT(*) AS n FROM media').first();
  const start=performance.now();
  const journeys=await Promise.all(cookies.map(async(_,index)=>{
    const documents=await Promise.all([call(index,`${base}/${planId}`),call(index,`${base}/${directoryId}`),call(index,`${base}/rules`,'POST',{programmes:[rule.programme]})]);
    for(const response of documents){expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toBe('private, no-store');}
    expect((await documents[0].json<PlannerRecord<Plan>>()).data).toEqual(plan);
    expect((await documents[1].json<PlannerRecord<DirectoryIndex>>()).data).toEqual(directory);
    expect((await documents[2].json<{rules:PlannerRecord<ProgrammeRule>[]}>()).rules.map(item=>item.data)).toEqual([rule]);
    // All operators request the same batch. One owner wins atomically; retries
    // from that owner return the same drafts, not a private copy per colleague.
    const deliveries=await Promise.all([call(index,`${base}/${planId}/tasks`,'POST',request),call(index,`${base}/${planId}/tasks`,'POST',request)]);
    if(deliveries.every(response=>response.status===409)){
      expect((await(await call(index,`${base}/${planId}/tasks`)).json<{tasks:PlannerTask[]}>()).tasks).toEqual([]);
      return [];
    }
    for(const response of deliveries)expect(response.status).toBe(200);
    const sets=await Promise.all(deliveries.map(response=>response.json<{tasks:PlannerTask[]}>()));
    expect(sets[0]).toEqual(sets[1]);expect(sets[0].tasks.map(task=>task.key)).toEqual(expectedKeys);
    const ledger=await call(index,`${base}/${planId}/tasks`);
    expect(await ledger.json()).toEqual(sets[0]);
    const projects=await Promise.all(sets[0].tasks.map(async task=>{
      const response=await call(index,`/api/graphics/projects/${task.projectId}`);expect(response.status).toBe(200);
      const project=await response.json<Project>();expect(project.created_by).toBe(`load-${index}@example.test`);expect(project.visibility).toBe('private');expect(project.status).toBe('draft');
      return {task,project};
    }));
    const ba=projects.find(item=>item.task.key==='ba:tv:row-0')!.project;
    expect(ba.data).toMatchObject({_titre_ligne_1:'Magazine 0',_jour_1:'lundi',_heure_1:'20h30',_media_body_url:plan.rows[0].media,_media_body_start_seconds:12,_media_body_end_seconds:20,_audio_bed_enabled:true,_audio_voice_enabled:false});
    for(const {project} of projects.filter(item=>item.task.key.startsWith('weekly:'))){
      expect(project.template_id).toBe('BTV_Semainier');
      plan.rows.forEach((row,i)=>{expect(project.data[`programme_${i+1}_title`]).toBe(row.title);expect(project.data[`_media_programme_${i+1}_url`]).toEqual(row.media);expect(project.data[`_media_programme_${i+1}_start_seconds`]).toBe(12+i);});
    }
    return sets[0].tasks;
  }));
  const ids=journeys.flatMap(tasks=>tasks.map(task=>task.projectId));expect(new Set(ids).size).toBe(8);
  const winner=journeys.findIndex(tasks=>tasks.length>0);expect(journeys.filter(tasks=>tasks.length>0)).toHaveLength(1);
  await Promise.all(cookies.map(async(_,index)=>{
    const mine=await (await call(index,'/api/graphics/projects?scope=mine')).json<{projects:Project[]}>();
    expect(mine.projects.every(project=>project.created_by===`load-${index}@example.test`)).toBe(true);
    expect(journeys[index].every(task=>mine.projects.some(project=>project.id===task.projectId))).toBe(true);
    if(index!==winner){
      const other=journeys[winner][0];
      expect((await call(index,`/api/graphics/projects/${other.projectId}`)).status).toBe(404);
      expect((await call(index,`/api/graphics/projects/${other.projectId}/revisions`)).status).toBe(404);
      const board=await(await call(index,`${base}/${planId}/assignments`)).json<{tasks:Array<{owner:string}>}>();
      expect(board.tasks).toHaveLength(8);expect(board.tasks.every(task=>task.owner===`load-${winner}@example.test`)).toBe(true);expect(JSON.stringify(board)).not.toContain(other.projectId);
    }
  }));
  const counts=await env.DB.prepare("SELECT COUNT(*) AS tasks,COUNT(DISTINCT t.project_id) AS projects,COUNT(DISTINCT t.actor) AS users,SUM(CASE WHEN p.created_by<>t.actor OR p.visibility<>'private' THEN 1 ELSE 0 END) AS wrongOwner FROM planner_personal_tasks t JOIN projects p ON p.id=t.project_id WHERE t.plan_id=?").bind(planId).first();
  expect(counts).toEqual({tasks:8,projects:8,users:1,wrongOwner:0});
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM media').first()).toEqual(mediaBefore);
  // A shared schedule change never rewrites somebody's already-edited draft.
  const revised={...plan,name:plan.name+' · nouvelle heure',rows:plan.rows.map(row=>({...row,time:'21:00:00'}))};
  expect((await call(1,`${base}/${planId}`,'PUT',{revision:1,data:revised})).status).toBe(200);
  const stale=await Promise.all(cookies.map((_,index)=>call(index,`${base}/${planId}/tasks`,'POST',request)));
  expect(stale.every(response=>response.status===409)).toBe(true);
  const repeated=await call(winner,`${base}/${planId}/tasks`,'POST',{...request,revision:2});
  expect((await repeated.json<{tasks:PlannerTask[]}>()).tasks.map(task=>task.projectId)).toEqual(journeys[winner].map(task=>task.projectId));
  const unchanged=await (await call(winner,`/api/graphics/projects/${journeys[winner].find(task=>task.key==='ba:tv:row-0')!.projectId}`)).json<Project>();
  expect(unchanged.data._heure_1).toBe('20h30');
  console.info(JSON.stringify({test:'local-planner-authenticated-concurrency',users:count,privateDrafts:ids.length,duplicateDeliveries:count,wrongOwner:0,staleRequestsRejected:stale.length,elapsedMs:Math.round(performance.now()-start),productionLoadTest:false}));
},60000);
