import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const origin='http://127.0.0.1:5198',output=resolve('reports/ui-refinement-2026-09-30');
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const errors=[],checks=[];
async function open(width,height,theme,query=''){
 const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==origin||url.pathname.startsWith('/api/'))return route.abort('blockedbyclient');return route.continue();});
 await page.goto(`${origin}/tests/ui-refinement.html${query}`);
 await page.evaluate(value=>{document.documentElement.dataset.theme=value;},theme);
 await expect(page.locator('vite-error-overlay')).toHaveCount(0);
 return page;
}
async function capture(page,name){
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
 assert.equal(overflow,false,`${name}: viewport overflow`);
 await page.screenshot({path:resolve(output,`${name}.png`),fullPage:true});
}
try{
 for(const [width,height,label] of [[1366,768,'desktop'],[683,384,'200-percent-equivalent'],[320,640,'narrow']])for(const theme of ['dark','light']){
  const page=await open(width,height,theme,'?deletion');
  await expect(page.getByRole('heading',{name:'Contenus à supprimer'})).toBeVisible();
  const confirm=page.getByRole('button',{name:'Supprimer définitivement'});
  await expect(confirm).toBeDisabled();
  const measurements=await page.locator('.deletion-warning').evaluate(element=>{const icon=element.querySelector('svg').getBoundingClientRect(),text=element.querySelector('p').getBoundingClientRect(),dialog=element.closest('dialog');return {gap:text.left-icon.right,dialogOverflow:dialog.scrollWidth>dialog.clientWidth+1};});
  assert.ok(measurements.gap>=10);assert.equal(measurements.dialogOverflow,false);
  await page.locator('.deletion-body').evaluate(element=>{element.scrollTop=0;});
  await capture(page,`deletion-top-${theme}-${label}`);
  await page.getByLabel('J’ai vérifié les contenus et les conséquences pour l’équipe.').check();
  await page.getByLabel('Recopiez l’adresse e-mail').fill('wrong@example.test');await expect(confirm).toBeDisabled();
  await page.getByLabel('Recopiez l’adresse e-mail').fill('qualification.interface@example.test');await expect(confirm).toBeEnabled();
  await page.keyboard.press('Tab');await confirm.focus();assert.equal(await confirm.evaluate(element=>element.matches(':focus-visible')),true);
  await capture(page,`deletion-confirm-${theme}-${label}`);
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
  checks.push({component:'deletion',width,height,theme,measurements,validation:true,keyboardEscape:true});await page.close();
 }
 for(const [width,height,label] of [[1366,768,'desktop'],[683,384,'200-percent-equivalent'],[320,640,'narrow']])for(const theme of ['dark','light']){
  const page=await open(width,height,theme);
  await page.getByRole('button',{name:'Cadrer pour les réseaux'}).click();
  await expect(page.getByRole('button',{name:'Suivre un sujet'})).toBeVisible({timeout:20000});
  const cropRatio=await page.locator('.crop-output').evaluate(element=>{const bounds=element.getBoundingClientRect();return {actual:bounds.width/bounds.height,expected:parseFloat(element.style.aspectRatio)};});
  assert.ok(Math.abs(cropRatio.actual-cropRatio.expected)<.01,'The visible crop preserves the renderer aspect ratio.');
  await capture(page,`crop-ready-${theme}-${label}`);
  await page.getByRole('button',{name:'Suivre un sujet'}).click();
  await expect(page.getByRole('button',{name:'Proposer un cadrage'})).toBeEnabled({timeout:20000});
  await capture(page,`crop-selection-${theme}-${label}`);
  await page.getByText('Ajuster la zone au clavier',{exact:true}).click();
  await page.getByLabel('Gauche (%)').fill('35');await page.getByLabel('Largeur (%)').fill('30');
  await expect(page.getByRole('button',{name:'Proposer un cadrage'})).toBeEnabled();
  await page.getByRole('button',{name:'Fermer le suivi du sujet'}).click();
  await expect(page.getByRole('button',{name:'Suivre un sujet'})).toBeVisible();
  await page.getByText('Cadrage manuel',{exact:true}).click();
  await expect(page.getByRole('button',{name:'Créer des repères'})).toBeVisible();
  checks.push({component:'crop',width,height,theme,selectionKeyboard:true,close:true});await page.close();
 }
 const page=await open(1366,900,'dark');
 const follow=async()=>{await page.getByRole('button',{name:'Suivre un sujet'}).click();await expect(page.getByRole('button',{name:'Proposer un cadrage'})).toBeEnabled({timeout:20000});};
 const calculate=async()=>{await page.getByRole('button',{name:'Proposer un cadrage'}).click();await expect(page.getByRole('button',{name:'Proposition',exact:true})).toBeVisible({timeout:90000});};
 await page.getByRole('button',{name:'Cadrer pour les réseaux'}).click();await follow();
 // Real local MP4 → subject rectangle → worker analysis → preview → apply.
 await calculate();await capture(page,'crop-proposal-real-video');
 await page.getByRole('button',{name:'Avant',exact:true}).click();await expect(page.getByRole('button',{name:'Avant',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Proposition',exact:true}).click();await page.getByRole('button',{name:'Lire l’aperçu'}).click();await expect(page.getByRole('button',{name:'Pause',exact:true})).toBeVisible();await page.getByRole('button',{name:'Pause',exact:true}).click();
 const partial=page.getByLabel('J’ai vérifié la suite et j’accepte ce cadrage partiel.');if(await partial.count())await partial.check();
 await page.getByRole('button',{name:'Appliquer ce cadrage'}).click();await expect(page.locator('#fixture-motion')).not.toHaveText('');
 await expect(page.getByRole('button',{name:'Annuler le dernier cadrage'})).toBeVisible();
 await capture(page,'crop-applied-real-video');
 await page.getByRole('button',{name:'Annuler le dernier cadrage'}).click();await expect(page.locator('#fixture-motion')).toHaveText('{}');
 await follow();await page.getByRole('button',{name:'Proposer un cadrage'}).click();await expect(page.getByRole('button',{name:'Annuler le calcul'})).toBeVisible();await page.getByRole('button',{name:'Annuler le calcul'}).click();await expect(page.getByRole('button',{name:'Proposer un cadrage'})).toBeEnabled({timeout:20000});await expect(page.getByRole('button',{name:'Appliquer ce cadrage'})).toHaveCount(0);
 await calculate();
 for(const trigger of ['Changer IN','Changer OUT','Changer le média','Changer le format']){
  await page.getByRole('button',{name:trigger,exact:true}).click();await expect(page.getByRole('button',{name:'Appliquer ce cadrage'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Suivre un sujet'})).toBeVisible({timeout:20000});
  await follow();await calculate();
 }
 await page.getByRole('button',{name:'Fermer le suivi du sujet'}).click();
 checks.push({component:'real-local-video-follow',analysis:true,beforeProposal:true,playback:true,apply:true,undo:true,cancel:true,invalidation:['IN','OUT','source','format']});await page.close();
 for(const trigger of ['Changer IN','Changer OUT','Changer le média','Changer le format']){
  const pending=await open(1366,768,'dark');
  await pending.getByRole('button',{name:'Cadrer pour les réseaux'}).click();await pending.getByRole('button',{name:'Suivre un sujet'}).click();
  await expect(pending.getByRole('button',{name:'Proposer un cadrage'})).toBeEnabled({timeout:20000});await pending.getByRole('button',{name:'Proposer un cadrage'}).click();
  await expect(pending.getByRole('button',{name:'Annuler le calcul'})).toBeVisible();await pending.getByRole('button',{name:trigger,exact:true}).click();
  await expect(pending.getByRole('button',{name:'Suivre un sujet'})).toBeVisible({timeout:20000});await expect(pending.getByRole('button',{name:'Appliquer ce cadrage'})).toHaveCount(0);await expect(pending.getByRole('button',{name:'Annuler le calcul'})).toHaveCount(0);
  await pending.getByRole('button',{name:'Suivre un sujet'}).click();await expect(pending.getByRole('button',{name:'Proposer un cadrage'})).toBeEnabled({timeout:20000});await expect(pending.getByRole('button',{name:'Appliquer ce cadrage'})).toHaveCount(0);
  checks.push({component:'pending-analysis-invalidation',trigger,passed:true});await pending.close();
 }
 assert.deepEqual(errors,[]);
 await writeFile(resolve(output,'report.json'),JSON.stringify({scope:'Local fixture only. Edge Chromium, dark/light, 683×384 CSS viewport equivalent to 200% at 1366×768; no Safari claim. Real local MP4 tracking flow.',checks,errors},null,2));
 console.log(JSON.stringify({passed:checks.length,errors}));
}finally{await browser.close();}
