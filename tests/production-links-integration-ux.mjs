import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const base=process.argv[2]||'http://127.0.0.1:5221',directory=resolve('reports/production-links-integration'),checks=[],errors=[];
await mkdir(directory,{recursive:true});const browser=await chromium.launch({channel:'msedge',headless:true});
const planId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',projectId='99999999-9999-4999-8999-999999999999';
const occurrence=id=>({rowId:id,title:`Programme ${Number(id)+1}`,subtitle:`Épisode ${31+Number(id)}`,airDate:'2026-09-07',broadcastDate:'2026-09-07',time:'20:30:00',included:true,sourceRemoved:false,programmeRevision:null});
try{
 for(const width of [1366,320])for(const theme of ['dark','light']){
  const page=await browser.newPage({viewport:{width,height:768},reducedMotion:'reduce'}),writes=[],reads=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',route=>{
   const request=route.request(),url=new URL(request.url()),path=url.pathname;let body;
   if(request.method()!=='GET')writes.push(path);
   if(path.endsWith('/production-links')){
    reads.push(Object.fromEntries(url.searchParams));const section=url.searchParams.get('section'),rowId=url.searchParams.get('rowId');
    const context={channelId:'benin-tv',planId,planRevision:1,planName:'Semaine · recette locale',rowId,scope:'programme',programmeId:'99999999-9999-4999-8999-999999999998',title:occurrence(rowId).title,snapshot:'a'.repeat(64)};
    const project={id:projectId,title:'Projet accessible fictif',templateId:'BTV_BA_1P',templateVersion:'1.0.0',libraryVersion:'1.7.0',revision:1,status:'draft',archived:false,format:'tv'};
    body={context,section,next:null,items:section==='occurrences'?['0','21'].map(id=>({type:'occurrence',id,occurrence:occurrence(id),coordination:[]})):section==='deliverables'?[{type:'project',id:projectId,relation:'direct',taskKey:'ba:tv:0',kind:'ba',format:'tv',sourceRevision:1,edition:null,linkage:'same-programme',project,origins:[{rowId:'0',linkage:'same-programme',occurrence:occurrence('0')}]}]:[]};
   }else body=path.endsWith('/channels')?[{id:'benin-tv',name:'Bénin TV',logo:'',accent:'#efbd32',timezone:'Africa/Porto-Novo',revision:1,archived:0}]:path.endsWith('/planner-summary')?{plans:1,updatedAt:null}:path.endsWith('/assignments')?{tasks:[],members:[]}:path.endsWith('/habits')?{suggestions:[]}:null;
   return route.fulfill({status:body?200:500,contentType:'application/json',body:JSON.stringify(body||{error:'Appel inattendu'})});
  });
  await page.goto(`${base}/tests/day-planner-workbench.html?seed=1&large=1`);await page.addStyleTag({content:'#planner-fixture-audit{display:none}'});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  if(width<1000)await page.getByRole('button',{name:'Menu',exact:true}).click();await page.getByRole('navigation',{name:'Navigation Graphics',exact:true}).getByRole('button',{name:'À faire',exact:true}).click();
  await page.locator('.planner-entry select').selectOption(planId);await expect(page.locator('.planner-row')).toHaveCount(20);
  if(width===1366){await page.evaluate(()=>scrollTo(0,0));assert.ok(await page.locator('.planner-item').evaluateAll(items=>items.filter(item=>{const box=item.getBoundingClientRect();return box.top>=0&&box.bottom<=innerHeight;}).length)>=6);}
  await page.getByRole('button',{name:'Préparer Programme 1',exact:true}).click();let inspector=page.getByRole('dialog',{name:'Programme 1',exact:true});await inspector.locator('input[name="subtitle"]').fill('Retouche locale à conserver');
  await inspector.getByRole('button',{name:'Voir le dossier de l’émission',exact:true}).click();let dossier=page.getByRole('dialog',{name:'Dossier de l’émission',exact:true});await expect(dossier.locator('.programme-dossier-occurrences>li')).toHaveCount(2);await expect(dossier).toContainText('Vos retouches locales restent intactes');await expect(dossier.locator('img,video,audio,canvas,iframe')).toHaveCount(0);
  await dossier.getByRole('button',{name:'Livrables',exact:true}).click();await dossier.getByRole('button',{name:'Ouvrir le projet · Projet accessible fictif',exact:true}).click();const guard=page.getByRole('dialog',{name:'Conserver votre préparation ?',exact:true});await expect(guard).toBeVisible();await guard.getByRole('button',{name:'Rester ici',exact:true}).click();await expect(inspector.locator('input[name="subtitle"]')).toHaveValue('Retouche locale à conserver');
  await inspector.getByRole('button',{name:'Voir le dossier de l’émission',exact:true}).click();dossier=page.getByRole('dialog',{name:'Dossier de l’émission',exact:true});await dossier.getByRole('button',{name:'Ouvrir la ligne · Programme 22 · Épisode 52',exact:true}).click();await expect(page.getByRole('dialog',{name:'Programme 22',exact:true})).toBeVisible();await expect(page.locator('.planner-pagination')).toContainText('21–32');
  inspector=page.getByRole('dialog',{name:'Programme 22',exact:true});await inspector.getByRole('button',{name:'Voir le dossier de l’émission',exact:true}).click();dossier=page.getByRole('dialog',{name:'Dossier de l’émission',exact:true});await dossier.getByRole('button',{name:'Ouvrir la ligne · Programme 1 · Épisode 31',exact:true}).click();inspector=page.getByRole('dialog',{name:'Programme 1',exact:true});await expect(inspector.locator('input[name="subtitle"]')).toHaveValue('Retouche locale à conserver');await page.screenshot({path:resolve(directory,`navigation-retouches-${theme}-${width}.png`),fullPage:true});
  await inspector.getByRole('button',{name:'Revenir à la liste',exact:true}).click();assert.deepEqual(writes,[]);const audit=JSON.parse(await page.locator('#planner-fixture-audit').textContent());assert.equal(audit.count,0);assert.equal(audit.plans[0].revision,1);assert.ok(reads.every(read=>read.revision==='1'));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  checks.push({width,theme,realDayPlanner:true,dirtyProjectNavigationGuard:true,crossPageOccurrenceNavigation:true,retouchesPreserved:true,noSaveCreationExportOrSharing:true,sixRows:width===1366});await page.close();
 }
}catch(error){errors.push(error.stack||String(error));throw error;}
finally{await writeFile(resolve(directory,'report.json'),JSON.stringify({checks,errors,scope:'Real Studio and DayPlanner UI with existing isolated in-memory preparation fixture and intercepted dossier HTTP responses. No real accounts, shared server state, generated projects or exports.'},null,2));await browser.close();}
assert.deepEqual(errors,[]);console.log(JSON.stringify({checks:checks.length,errors},null,2));
