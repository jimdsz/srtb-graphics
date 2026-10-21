import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {chromium,expect} from '@playwright/test';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';

// Built UI and Worker, real isolated D1 and synthetic session. No real login,
// external provider, production database or account is used.
const build=resolve('dist-studio-native'),output=resolve('reports/production-links-release');
const origin='https://studio.example',token='f'.repeat(64),email='dossier-fixture@example.test',colleague='private-fixture@example.test';
const requests=[],errors=[],networkFailures=[];
const runtime=new Miniflare(convertV4MiniflareOptions({
 script:await readFile(resolve(build,'_worker.js'),'utf8'),modules:true,compatibilityDate:'2026-09-21',compatibilityFlags:['nodejs_compat'],
 d1Databases:['DB'],bindings:{AUTH_MODE:'firebase',APP_ENV:'production',FIREBASE_PROJECT_ID:'srtb-test-auth',FIREBASE_API_KEY:'AIza'+'x'.repeat(35)},
 serviceBindings:{ASSETS:async request=>{
  const path=new URL(request.url).pathname,asset=/^\/(assets|fonts|thumbnails|library)\//.test(path),file=asset?resolve(build,'.'+decodeURIComponent(path)):resolve(build,'index.html');
  if(!file.startsWith(build+sep))return new Response(null,{status:404});
  const types={'.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.html':'text/html','.ttf':'font/ttf','.woff2':'font/woff2','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};
  try{return new Response(await readFile(file),{headers:{'Content-Type':types[extname(file)]||'application/octet-stream'}});}catch{return new Response(null,{status:404});}
 }},outboundService:async()=>{throw Error('Unexpected external network in isolated dossier test.');}
}));
let browser;
try{
 const db=await runtime.getD1Database('DB');
 for(const name of (await readdir('migrations')).filter(name=>name.endsWith('.sql')).sort())await db.exec((await readFile(resolve('migrations',name),'utf8')).split(/\r?\n/).filter(line=>!line.trimStart().startsWith('--')).join(' '));
 for(const actor of [email,colleague])await db.prepare("INSERT INTO members(email,name,role,firebase_uid,updated_by) VALUES(?,?,'designer',?,?)").bind(actor,actor===email?'Recette intégrée':'Collègue fictif',actor,actor).run();
 await db.prepare('INSERT INTO app_sessions(token_hash,email,firebase_uid,expires_at,created_at) VALUES(?,?,?,?,?)').bind(createHash('sha256').update(token).digest('hex'),email,email,Date.now()+3600000,Date.now()).run();
 const programmeId=randomUUID(),planId=randomUUID();
 await db.prepare('INSERT INTO programmes(id,channel_id,name,identity,data_json,updated_by) VALUES(?,?,?,?,?,?)').bind(programmeId,'benin-tv','DOSSIER TEST','dossier test',JSON.stringify({name:'DOSSIER TEST'}),email).run();
 const rows=Array.from({length:7},(_,i)=>({id:'row-'+i,title:'DOSSIER TEST',subtitle:'Épisode '+(i+1),category:'Magazine',sheet:'Grille',cell:'B'+(i+2),raw:'DOSSIER TEST',broadcastDate:'2026-09-29',airDate:'2026-09-29',time:`${String(10+i).padStart(2,'0')}:30:00`,duration:1200,included:true,kinds:['ba'],formats:['tv'],issues:[],media:null,location:null,programmeId,programmeRevision:1}));
 const data={kind:'plan',name:'Recette dossier construit',source:'conducteur-fictif.pdf',sourceHash:'d'.repeat(64),rows,weekly:{rowIds:rows.map(row=>row.id),formats:['tv']}};
 await db.prepare("INSERT INTO planner_documents(id,kind,name,data_json,created_by,updated_by) VALUES(?,'plan',?,?,?,?)").bind(planId,data.name,JSON.stringify(data),email,email).run();
 async function makeProject(title,owner=email,template='BTV_BA_1P',format='tv'){
  const id=randomUUID();await db.prepare('INSERT INTO projects(id,title,template_id,template_version,library_version,data_json,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?)').bind(id,title,template,'1.0.0','1.7.0',JSON.stringify({_studio_format:format}),owner,owner).run();return id;
 }
 async function link(key,projectId,actor=email){await db.prepare('INSERT INTO planner_personal_tasks(plan_id,task_key,project_id,source_revision,actor) VALUES(?,?,?,1,?)').bind(planId,key,projectId,actor).run();}
 const own=await makeProject('BA VISIBLE DE RECETTE'),hidden=await makeProject('CONFIDENTIEL COLLEGUE',colleague),weekly=await makeProject('SEMAINIER VISIBLE DE RECETTE',email,'BTV_Semainier'),child=await makeProject('ANNONCE CE SOIR DE RECETTE',email,'BTV_BA_1P','vertical');
 await link('ba:tv:row-0',own);await link('ba:tv:row-0',hidden,colleague);await link('weekly:tv:'+rows.map(row=>row.id).join(','),weekly);
 const batch=randomUUID();
 await db.prepare('INSERT INTO derivation_batches(id,request_id,request_hash,name,source_project_id,source_revision,source_template_id,source_template_version,source_library_version,source_snapshot_json,source_snapshot_sha256,mapping_version,target_count,created_by) VALUES(?,?,?,?,?,1,?,?,?,?,?,?,1,?)').bind(batch,randomUUID(),'1'.repeat(64),'Lot de recette',own,'BTV_BA_1P','1.0.0','1.7.0','{}','2'.repeat(64),'test',email).run();
 await db.prepare("INSERT INTO project_derivations(batch_id,project_id,target_key,label,ordinal,warnings_json,announcement_json) VALUES(?,?,'ba-tonight-vertical','Ce soir · vertical',0,'[]',?)").bind(batch,child,JSON.stringify({key:'tonight',day:'Ce soir',time:'20:30',format:'vertical',voice:{mode:'none',status:'none'}})).run();
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1366,height:768},reducedMotion:'reduce'});
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==origin){networkFailures.push(url.origin);await route.abort();return;}
  requests.push({path:url.pathname,method:request.method()});
  const headers={...request.headers(),Cookie:'__Host-srtb_session='+token};delete headers['content-length'];
  const response=await runtime.dispatchFetch(request.url(),{method:request.method(),headers,...(!['GET','HEAD'].includes(request.method())?{body:request.postDataBuffer()}: {})});
  await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
 });
 await page.goto(origin+'/graphics');
 await page.getByRole('navigation',{name:'Navigation Graphics',exact:true}).getByRole('button',{name:'À faire',exact:true}).click();
 await page.getByLabel('Reprendre une préparation d’équipe').selectOption(planId);await expect(page.locator('.planner-row')).toHaveCount(7);
 await page.getByRole('button',{name:'Préparer DOSSIER TEST',exact:true}).first().click();await page.getByRole('button',{name:'Voir le dossier de l’émission',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Dossier de l’émission',exact:true});await expect(dialog).toBeVisible();await expect(dialog.locator('.programme-dossier-occurrences>li')).toHaveCount(7);
 await dialog.getByRole('button',{name:'Livrables',exact:true}).click();await expect(dialog.getByText('BA VISIBLE DE RECETTE',{exact:true})).toBeVisible();await expect(dialog.getByText('CONFIDENTIEL COLLEGUE',{exact:true})).toHaveCount(0);
 await dialog.getByRole('button',{name:'Semainiers',exact:true}).click();await expect(dialog.getByText('SEMAINIER VISIBLE DE RECETTE',{exact:true})).toBeVisible();await expect(dialog.locator('.programme-dossier-project')).toHaveCount(1);
 await dialog.getByRole('button',{name:'Déclinaisons',exact:true}).click();await expect(dialog.getByText('ANNONCE CE SOIR DE RECETTE',{exact:true})).toBeVisible();await expect(dialog).toContainText('Annonce à la création : Ce soir · 20:30');await expect(dialog).toContainText('Vertical · 9:16');
 await mkdir(output,{recursive:true});await page.screenshot({path:resolve(output,'built-dossier.png'),fullPage:true});
 // Revoke access while the modal is open: the next read removes the child.
 await db.prepare('UPDATE projects SET created_by=?,updated_by=?,revision=revision+1 WHERE id=?').bind(colleague,colleague,child).run();
 await dialog.getByRole('button',{name:'Actualiser le dossier',exact:true}).click();await expect(dialog.getByText('ANNONCE CE SOIR DE RECETTE',{exact:true})).toHaveCount(0);await expect(dialog).toContainText('Aucun lien visible');
 assert.deepEqual(errors,[]);assert.deepEqual(networkFailures,[]);assert.ok(requests.filter(item=>item.path.includes('/production-links')).length>=5);
 assert.ok(!requests.some(item=>/\.(mp4|mov|wav|mp3)$/.test(item.path)),'No video/audio preload in the dossier');
 assert.ok(!requests.some(item=>item.method!=='GET'&&!['/api/graphics/planner/rules'].includes(item.path)),'No browser mutation');
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM projects').first()).n,4);
 await writeFile(resolve(output,'report.json'),JSON.stringify({passed:true,scope:'Built UI → built Worker → isolated real D1, synthetic session. No real account or production data.',occurrences:7,weeklyDeduplicated:true,privateProjectHidden:true,creationAnnouncement:true,revokedChildDisappears:true,noMediaPlayback:true,projectsUnchanged:true,errors,networkFailures},null,2));
 console.log('PASS built dossier: real D1/API, four sections, privacy, revoked sharing, no generation/export/media playback.');
}finally{await browser?.close();await runtime.dispose();}
