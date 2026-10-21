import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const base=process.argv[2]||'http://127.0.0.1:5199';
const directory=resolve('reports/ui-production-layout');await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const errors=[],writes=[],mediaReads=[];
let releasePreview=()=>{};
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    if(request.method()!=='GET'){writes.push(request.method()+' '+path);return route.fulfill({status:405,body:'{}'});}
    if(path==='/api/graphics/media')mediaReads.push(path);
    return route.fulfill({contentType:'application/json',body:JSON.stringify(path==='/api/graphics/projects'?{projects:[],next:null}:[])});
  });
  const heldPreview=new Promise(resolve=>{releasePreview=resolve;});
  await page.route('**/src/studio/Preview.tsx*',async route=>{await heldPreview;await route.continue();});
  await page.goto(base+'/tests/production-layout.html');
  await page.getByRole('navigation',{name:'Navigation Graphics'}).getByRole('button',{name:'Bibliothèque',exact:true}).click();
  await page.getByRole('button',{name:'Charger l’aperçu',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'Ouverture de l’aperçu…'})).toBeVisible();
  await expect(page.getByRole('progressbar',{name:'Ouverture de l’aperçu…'})).not.toHaveAttribute('value');
  for(const theme of ['dark','light'])for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});
    await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;window.dispatchEvent(new Event('srtb:interface-theme'));},theme);
    await page.locator('.preview-gate-loading').screenshot({path:resolve(directory,`loading-${theme}-${width}.png`)});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    expect(await page.locator('.surface-transition').evaluate(el=>el.getAnimations().length)).toBe(0);
  }
  releasePreview();
  await expect(page.getByRole('button',{name:'Lire l’aperçu',exact:true})).toBeEnabled({timeout:30000});
  await expect(page.getByText('Cliquez sur Lire pour voir l’entrée du modèle.',{exact:false})).toBeVisible();
  await page.keyboard.press('Tab');
  await page.getByRole('button',{name:'Lire l’aperçu',exact:true}).focus();
  expect(await page.getByRole('button',{name:'Lire l’aperçu',exact:true}).evaluate(el=>el.matches(':focus-visible'))).toBe(true);
  expect(mediaReads).toEqual([]);expect(writes).toEqual([]);expect(errors).toEqual([]);
  await writeFile(resolve(directory,'loading-results.json'),JSON.stringify({passed:true,states:4,reducedMotion:true,keyboardFocus:true,indeterminateProgress:true,mediaReads,writes,errors},null,2));
  console.log('PASS: loading states dark/light desktop/mobile; real indeterminate progress; reduced motion; keyboard focus; no media API or writes.');
}finally{releasePreview();await browser.close();}
