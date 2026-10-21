import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const base=process.argv[2]||'http://127.0.0.1:5227';
const directory=resolve('reports/graphics-help');
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const errors=[],apiRequests=[],checks=[];
async function selectTopic(page,title){
  const picker=page.getByRole('combobox',{name:'Rubrique',exact:true});
  if(await picker.isVisible())await picker.selectOption({label:title});
  else await page.getByRole('navigation',{name:'Rubriques du guide'}).getByRole('button',{name:title,exact:true}).click();
}
async function noOverflow(page){
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  assert.equal(await page.locator('dialog[open]').evaluate(node=>node.scrollWidth>node.clientWidth+1),false);
  assert.equal(await page.locator('dialog[open] .graphics-help-content').evaluate(node=>node.scrollWidth>node.clientWidth+1),false);
}
async function primaryContrast(page){
  const button=page.locator('dialog[open] .graphics-help-primary');await button.hover();
  return button.evaluate(node=>{
    const luminance=value=>value.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);
    const style=getComputedStyle(node),a=luminance(style.backgroundColor),b=luminance(style.color);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  });
}
try{
  for(const width of [1366,683,320])for(const theme of ['dark','light']){
    const page=await browser.newPage({viewport:{width,height:width===1366?768:width===683?384:740},reducedMotion:'reduce'});
    page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.url().includes('/api/'))apiRequests.push(request.url());});
    await page.goto(`${base}/tests/graphics-help.html`);
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Prise en main',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Plus tard',exact:true}).click();
    await page.getByRole('button',{name:'Simuler le changement de chaîne',exact:true}).click();
    await expect(page.locator('.graphics-help-invitation')).toHaveCount(0);
    await page.getByRole('button',{name:'Guide',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Une fiche pour toute l’émission',exact:true})).toBeVisible();
    await noOverflow(page);
    assert.ok(await primaryContrast(page)>=4.5);
    await expect(page.locator('video,audio,canvas')).toHaveCount(0);
    await page.getByRole('button',{name:'Suivant',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Chaque épisode garde ses détails',exact:true})).toBeVisible();
    assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'Chaque épisode garde ses détails');
    await page.screenshot({path:resolve(directory,`programmes-${theme}-${width}.png`),fullPage:true});
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Guide',exact:true})).toBeFocused();
    await page.reload();await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    await expect(page.locator('.graphics-help-invitation')).toHaveCount(0);
    await page.getByRole('button',{name:'Guide',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Chaque épisode garde ses détails',exact:true})).toBeVisible();
    await selectTopic(page,'Qui voit quoi ?');
    await page.getByRole('button',{name:'Suivant',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Tâche collective, projet privé',exact:true})).toBeVisible();
    await noOverflow(page);
    await page.screenshot({path:resolve(directory,`partage-${theme}-${width}.png`),fullPage:true});
    for(const topic of ['Textes & typographie','Logos & sponsors','Son & voix','Recadrage','Exporter','Prise en main']){await selectTopic(page,topic);await noOverflow(page);if(topic==='Textes & typographie'||topic==='Logos & sponsors')await page.screenshot({path:resolve(directory,`${topic.startsWith('Textes')?'texte':'logo'}-${theme}-${width}.png`),fullPage:true});}
    await expect(page.getByRole('button',{name:'Ouvrir Équipe & accès',exact:true})).toHaveCount(0);
    for(let i=0;i<14;i++){await page.keyboard.press('Tab');assert.ok(await page.evaluate(()=>!!document.activeElement?.closest('dialog[open]')));}
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Aide : Émissions',exact:true}).click();
    await expect(page.locator('.graphics-help-bubble:popover-open')).toBeVisible();
    const box=await page.locator('.graphics-help-bubble').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1);
    await page.keyboard.press('Escape');await expect(page.locator('.graphics-help-bubble:popover-open')).toHaveCount(0);
    await page.getByRole('button',{name:'Aide : Émissions',exact:true}).click();
    await page.getByRole('button',{name:'Voir pas à pas',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Une fiche pour toute l’émission',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Ouvrir Émissions',exact:true}).click();
    await expect(page.getByText('Vue actuelle : programmes',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Aide du son',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Choisir la bonne source',exact:true})).toBeVisible();
    assert.equal(await page.locator('.graphics-help-playhead').evaluate(node=>getComputedStyle(node).animationName),'none');
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Demande administration',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Choisir votre espace de travail',exact:true})).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Changer de membre',exact:true}).click();
    await expect(page.locator('.graphics-help-invitation')).toBeVisible();
    await page.keyboard.press('Escape');await expect(page.locator('.graphics-help-invitation')).toHaveCount(0);
    checks.push({width,theme,resume:true,keyboard:true,overflow:false});await page.close();
  }
  const page=await browser.newPage({viewport:{width:1366,height:768}});
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${base}/tests/graphics-help.html?role=admin`);
  await page.getByRole('button',{name:'Plus tard',exact:true}).click();
  await page.getByRole('button',{name:'Aide du son',exact:true}).click();
  await page.waitForTimeout(2300);
  assert.equal(await page.locator('.graphics-help-playhead').evaluate(node=>node.getAnimations().some(animation=>animation.playState==='running')),false);
  await page.getByRole('button',{name:'Rejouer la démonstration',exact:true}).click();
  assert.equal(await page.locator('.graphics-help-playhead').evaluate(node=>node.getAnimations().some(animation=>animation.playState==='running')),true);
  await selectTopic(page,'Équipe & accès');
  await expect(page.getByRole('button',{name:'Ouvrir Équipe & accès',exact:true})).toBeVisible();
  await page.evaluate(()=>document.documentElement.style.zoom='2');await noOverflow(page);
  await page.screenshot({path:resolve(directory,'zoom-200-percent.png'),fullPage:true});
  await page.close();
  const denied=await browser.newPage();
  await denied.addInitScript(()=>{Object.defineProperty(window,'localStorage',{get(){throw Error('Storage denied');}});});
  await denied.goto(`${base}/tests/graphics-help.html`);await denied.getByRole('button',{name:'Prise en main',exact:true}).click();
  await expect(denied.getByText(/Le navigateur ne permet pas de la conserver/)).toBeVisible();
  for(let i=0;i<6;i++)await denied.getByRole('button',{name:'Suivant',exact:true}).click();
  await denied.getByRole('button',{name:'Terminer ce parcours',exact:true}).click();await expect(denied.getByText('Vous avez les repères.',{exact:true})).toBeVisible();
  await denied.getByRole('button',{name:'Revenir à mon travail',exact:true}).click();
  await denied.close();
  const legacy=await browser.newPage();
  await legacy.addInitScript(()=>{delete HTMLElement.prototype.showPopover;delete HTMLElement.prototype.hidePopover;});
  await legacy.goto(`${base}/tests/graphics-help.html`);
  await expect(legacy.locator('.graphics-help-bubble')).toBeHidden();
  await legacy.getByRole('button',{name:'Plus tard',exact:true}).click();
  await legacy.getByRole('button',{name:'Aide : Émissions',exact:true}).click();await expect(legacy.locator('.graphics-help-bubble')).toBeVisible();
  await legacy.keyboard.press('Escape');await expect(legacy.locator('.graphics-help-bubble')).toBeHidden();
  await legacy.getByRole('button',{name:'Aide : Émissions',exact:true}).click();await legacy.getByRole('button',{name:'Voir pas à pas',exact:true}).click();
  await expect(legacy.getByRole('heading',{name:'Une fiche pour toute l’émission',exact:true})).toBeVisible();await legacy.close();
  assert.deepEqual(errors,[]);assert.deepEqual(apiRequests,[]);
  await writeFile(resolve(directory,'report.json'),JSON.stringify({checks,errors,apiRequests},null,2));
  console.log(JSON.stringify({checks:checks.length+3,errors,apiRequests}));
}finally{await browser.close();}
