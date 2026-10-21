import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const base=process.argv[2]||'http://127.0.0.1:5221',phase=process.argv[3]||'before';
assert.ok(['before','after'].includes(phase));
const directory=resolve('reports/operator-shell-ux',phase);await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true}),errors=[],requests=[],results=[],checks=[];
try{
 for(const width of [1440,390])for(const theme of ['dark','light']){
  const page=await browser.newPage({viewport:{width,height:width===390?844:1000},reducedMotion:'reduce'});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',route=>{
   const request=route.request();requests.push({method:request.method(),url:request.url()});
   if(request.method()==='GET'&&request.url().endsWith('/media/image/content'))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#315434"/><text x="32" y="188" fill="#fff" font-family="sans-serif" font-size="36">Tour du Bénin</text></svg>'});
   return route.fulfill({status:500,body:'Unexpected API request in isolated fixture'});
  });
  await page.goto(base+'/tests/operator-shell.html');await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  await expect(page.getByRole('heading',{name:'Votre studio de création.',exact:true})).toBeVisible();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await expect(page.locator('.recent-projects .project-row')).toHaveCount(3);
  const capture=async name=>{
   await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:resolve(directory,`${name}-${theme}-${width}.png`),fullPage:true,animations:'disabled'});
   const metrics=await page.evaluate(()=>{const root=document.querySelector('dialog[open]')||document;return {width:innerWidth,pageWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,text:document.body.innerText.length,smallTargets:[...root.querySelectorAll('button,input:not([type=checkbox]):not([type=radio]),select,summary')].filter(el=>el.checkVisibility()&&el.getBoundingClientRect().height<43.5).map(el=>({label:el.getAttribute('aria-label')||el.textContent||el.tagName,height:el.getBoundingClientRect().height})),overflowing:[...root.querySelectorAll('button')].filter(el=>el.checkVisibility()&&el.scrollWidth>el.clientWidth+2).map(el=>el.textContent)};});
   results.push({name,theme,...metrics});if(phase==='after'){assert.ok(metrics.pageWidth<=width+1,JSON.stringify({name,...metrics}));assert.deepEqual(metrics.overflowing,[],JSON.stringify({name,...metrics}));assert.deepEqual(metrics.smallTargets,[],JSON.stringify({name,...metrics}));}
  };
  const navigate=async name=>{if(width===390)await page.getByRole('button',{name:'Menu',exact:true}).click();await page.getByRole('navigation',{name:'Navigation Graphics',exact:true}).getByRole('button',{name,exact:true}).click();await expect(page.locator('#graphics-main')).toBeFocused();};
  await capture('home');
  if(width===390){await page.getByRole('button',{name:'Menu',exact:true}).click();await capture('navigation');await page.getByRole('button',{name:'Menu',exact:true}).click();}
  await navigate('Projets');await expect(page.getByRole('heading',{name:'Les projets de l’équipe.',exact:true})).toBeVisible();await capture('projects');
  if(phase==='after'){
   await page.getByRole('searchbox',{name:'Rechercher un projet',exact:true}).fill('introuvable');await expect(page.getByRole('heading',{name:'Aucun projet correspondant',exact:true})).toBeVisible();
   await page.getByRole('searchbox',{name:'Rechercher un projet',exact:true}).fill('');await expect(page.locator('.project-row')).toHaveCount(3);
   await page.getByRole('checkbox',{name:'Corbeille et archives',exact:true}).check();await expect(page.getByRole('heading',{name:'La corbeille est vide',exact:true})).toBeVisible();await page.getByRole('checkbox',{name:'Corbeille et archives',exact:true}).uncheck();await expect(page.locator('.project-row')).toHaveCount(3);
  }
  await navigate('À valider');await expect(page.locator('.project-row')).toHaveCount(1);await capture('validation');
  await navigate('Équipe & accès');await expect(page.locator('.member-row')).toHaveCount(3);await capture('team');
  if(phase==='after'){
   await page.getByRole('button',{name:'Modifier : Coordination des programmes et de la production régionale (coordination.programmes.et.production.regionale@example.test)',exact:true}).click();
   const name=page.getByRole('textbox',{name:'Nom',exact:true});await expect(name).toBeFocused();await expect(name).toHaveValue('Coordination des programmes et de la production régionale');await expect(page.getByRole('combobox',{name:'Rôle',exact:true})).toHaveValue('broadcaster');await expect(page.getByRole('checkbox',{name:'Accès actif',exact:true})).toBeChecked();
   const visible=await name.evaluate(el=>{const rect=el.getBoundingClientRect(),header=document.querySelector('.graphics-header').getBoundingClientRect();return rect.top>=Math.min(header.bottom,150)&&rect.bottom<=innerHeight;});assert.equal(visible,true,'Member name focus must remain in the viewport, below the header');
   await page.getByRole('button',{name:'Effacer le formulaire',exact:true}).click();await expect(name).toHaveValue('');
  }
  await navigate('Médias');await expect(page.locator('.media-card')).toHaveCount(3);await expect(page.getByText('Aucun transfert en attente pour votre compte.',{exact:true})).toBeAttached();await capture('media');
  if(phase==='after'){
   const search=page.getByRole('searchbox',{name:'Rechercher un média',exact:true});await search.fill('introuvable');await expect(page.getByRole('heading',{name:'Aucun média correspondant',exact:true})).toBeVisible();await expect(page.locator('.media-filter [role=status]')).toHaveText('0 médias');await capture('media-empty');
   await page.getByRole('button',{name:'Effacer la recherche',exact:true}).click();await expect(search).toBeFocused();await expect(page.locator('.media-card')).toHaveCount(3);
   const disclosure=page.locator('.media-upload-disclosure'),summary=disclosure.locator(':scope>summary');await summary.focus();await page.keyboard.press('Enter');await expect(page.getByRole('heading',{name:'Ajouter un média privé',exact:true})).toBeVisible();
   const filename='recette'.repeat(32)+'.png';await page.getByLabel('Fichier à partager',{exact:true}).setInputFiles({name:filename,mimeType:'image/png',buffer:Buffer.from('local UI fixture only')});
   const consent=page.getByRole('checkbox',{name:'Partager ce fichier dans l’espace cloud privé SRTB, accessible aux membres autorisés.',exact:true}),share=page.getByRole('button',{name:'Partager ce média',exact:true});await expect(consent).not.toBeChecked();await expect(share).toBeDisabled();await consent.check();await expect(share).toBeEnabled();
   await summary.click();await summary.click();await expect(consent).toBeChecked();await expect(disclosure).toContainText(filename);await capture('media-upload');
  }
  await navigate('Bibliothèque');await page.getByRole('button',{name:'Créer un projet',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await capture('create');
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('button',{name:'Créer un projet',exact:true})).toBeFocused();
  if(phase==='after'){
   await page.getByRole('button',{name:'Créer un projet',exact:true}).click();await expect(page.getByRole('textbox',{name:'Nom du projet',exact:true})).toBeFocused();
   for(let i=0;i<7;i++){await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement===document.body||!!document.activeElement?.closest('dialog')),true,'Native modal prevents background controls receiving keyboard focus');}
   await page.getByRole('textbox',{name:'Nom du projet',exact:true}).fill('Projet créé en recette');await page.getByRole('button',{name:'Créer le projet',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('textbox',{name:'Nom du projet',exact:true})).toHaveValue('Projet créé en recette');
   await page.getByRole('textbox',{name:'Nom du projet',exact:true}).fill('Brouillon à conserver');
   if(width===390)await page.getByRole('button',{name:'Menu',exact:true}).click();const mediaNav=page.getByRole('navigation',{name:'Navigation Graphics',exact:true}).getByRole('button',{name:'Médias',exact:true});await mediaNav.click();await expect(page.getByRole('dialog',{name:'Conserver vos modifications ?',exact:true})).toBeVisible();
   await page.getByRole('button',{name:'Rester sur le projet',exact:true}).click();await expect(mediaNav).toBeFocused();await expect(page.getByRole('textbox',{name:'Nom du projet',exact:true})).toHaveValue('Brouillon à conserver');
   await mediaNav.click();await page.getByRole('button',{name:'Quitter sans enregistrer',exact:true}).click();await expect(page.locator('#graphics-main')).toBeFocused();await expect(page.getByRole('heading',{name:'Les médias de l’équipe',exact:true})).toBeVisible();
   if(width===390)await expect(page.getByRole('button',{name:'Menu',exact:true})).toHaveAttribute('aria-expanded','false');
   checks.push(`${theme} ${width}: project filtering/archives, contextual member edit/focus, media empty state/clear focus, explicit sharing consent without transfer, modal initial focus/inert background/create, cancelled and accepted dirty navigation`);
   await page.goto(base+'/tests/operator-shell.html?stress');await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await expect(page.locator('.recent-projects .project-row')).toHaveCount(3);
   await navigate('Équipe & accès');await expect(page.locator('.member-row')).toHaveCount(3);await capture('team-long');
   await navigate('Médias');await expect(page.locator('.media-card')).toHaveCount(3);await page.locator('.media-card').first().click();await expect(page.locator('.media-inspector')).toBeVisible();await capture('media-long');
   checks.push(`${theme} ${width}: unbroken 96-character member name, 134-character email and 224-character image filename fit without page overflow`);
  }
  await page.close();
 }
 assert.deepEqual(errors,[]);assert.ok(requests.every(request=>request.method==='GET'&&request.url.endsWith('/media/image/content')));
 const report={phase,passed:true,results,checks,errors,requests};await writeFile(resolve(directory,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({phase,passed:true,captures:results.length,checks,errors,requests:requests.length},null,2));
}catch(error){
 const page=browser.contexts().flatMap(context=>context.pages()).at(-1);
 if(page){await page.screenshot({path:resolve(directory,'failure.png'),fullPage:true});console.error(await page.locator('body').innerText());}
 console.error(JSON.stringify({errors,requests},null,2));throw error;
}finally{await browser.close();}
