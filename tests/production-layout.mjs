import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const base=process.argv[2]||'http://127.0.0.1:5199';
const directory=resolve('reports/ui-production-layout');await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const observations=[],errors=[],writes=[],unhandled=[],reads=[],mediaChecks=[];
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    if(request.method()!=='GET'){writes.push(request.method()+' '+path);return route.fulfill({status:405,contentType:'application/json',body:'{"error":"Écriture interdite sur ce banc UI"}'});}
    reads.push(path);
    const projects=await page.evaluate(()=>window.layoutAuditProjects||[]);
    let body;
    if(path==='/api/graphics/projects')body={projects,next:null};
    else if(path==='/api/graphics/projects/ui-audit-popup')body=projects[0];
    else if(path==='/api/graphics/media'||path.endsWith('/comments')||path.endsWith('/revisions'))body=[];
    else{unhandled.push(path);return route.fulfill({status:404,contentType:'application/json',body:'{"error":"Route absente du banc UI"}'});}
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  async function navigate(name){
    const nav=page.getByRole('navigation',{name:'Navigation Graphics'});
    if(!await nav.isVisible())await page.getByRole('button',{name:'Menu',exact:true}).click();
    await nav.getByRole('button',{name,exact:true}).click();
  }
  async function audit(name,theme,width){
    await page.evaluate(()=>window.scrollTo(0,0));
    // Motion starts on the next frame. Wait for that start and the real resting
    // opacity so screenshots never mistake an entry transition for low contrast.
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await expect.poll(()=>page.locator('.surface-transition').evaluate(el=>Number(getComputedStyle(el).opacity))).toBe(1);
    const metrics=await page.evaluate(()=>{
      const visible=el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(el).visibility!=='hidden';};
      const composition=document.querySelector('.presentation-settings');
      return {compositionPadding:composition?parseFloat(getComputedStyle(composition).paddingLeft):null,pageOverflow:document.documentElement.scrollWidth>innerWidth+1,overflowControls:[...document.querySelectorAll('button,.button-link,input,select,textarea')].filter(visible).filter(el=>el.getBoundingClientRect().right>innerWidth+1||el.getBoundingClientRect().left< -1).map(el=>el.getAttribute('aria-label')||el.textContent||el.tagName),textClips:[...document.querySelectorAll('button,.button-link')].filter(visible).filter(el=>el.scrollWidth>el.clientWidth+2).map(el=>el.getAttribute('aria-label')||el.textContent),emptyButtons:[...document.querySelectorAll('button')].filter(visible).filter(el=>!el.textContent.trim()&&!el.getAttribute('aria-label')&&!el.getAttribute('title')).length};
    });
    observations.push({name,theme,width,...metrics});
    await page.screenshot({path:resolve(directory,`${name}-${theme}-${width}.png`),fullPage:true,animations:'disabled'});
  }
  for(const theme of ['dark','light'])for(const width of [1440,768,390,320]){
    const initialMediaReads=reads.filter(path=>path==='/api/graphics/media').length;
    await page.setViewportSize({width,height:1000});await page.goto(base+'/tests/production-layout.html');
    await expect(page.getByRole('heading',{name:'Votre studio de création.',exact:true})).toBeVisible();
    await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;window.dispatchEvent(new Event('srtb:interface-theme'));},theme);
    await audit('home',theme,width);
    await navigate('Bibliothèque');await expect(page.getByRole('heading',{name:'Le bon habillage.',exact:true})).toBeVisible();await audit('library',theme,width);
    if(width<801){await page.getByRole('button',{name:'Menu',exact:true}).click();await audit('navigation',theme,width);await page.getByRole('button',{name:'Menu',exact:true}).click();}
    expect(reads.filter(path=>path==='/api/graphics/media').length-initialMediaReads).toBe(0);
    await navigate('Projets');await page.getByRole('button',{name:'Exporter : Magazine · contrôle visuel',exact:true}).click();
    await expect(page.getByRole('radio',{name:'MOV · ProRes 4444 · Transparence alpha',exact:true})).toBeVisible();await page.getByRole('radio',{name:'MOV · ProRes 4444 · Transparence alpha',exact:true}).check();
    await expect(page.getByRole('button',{name:'Lire l’aperçu',exact:true})).toBeEnabled({timeout:30000});await audit('export',theme,width);
    await page.getByRole('button',{name:'Réglages',exact:true}).click();await expect(page.getByRole('button',{name:'Textes et dates',exact:true})).toBeVisible();await audit('editor',theme,width);
    const projectMediaReads=reads.filter(path=>path==='/api/graphics/media').length-initialMediaReads;
    expect(projectMediaReads).toBe(1);mediaChecks.push({theme,width,homeAndLibrary:0,project:projectMediaReads});
  }
  await writeFile(resolve(directory,'observations.json'),JSON.stringify({observations,pageErrors:errors,networkWrites:writes,unhandledApi:unhandled,mediaChecks},null,2));
  const failures=observations.filter(o=>o.pageOverflow||o.overflowControls.length||o.textClips.length||o.emptyButtons||(o.compositionPadding!==null&&o.compositionPadding<16));
  console.log(JSON.stringify({views:observations.length,failures,errors,writes,unhandled,mediaChecks}));
  if(failures.length||errors.length||writes.length||unhandled.length)process.exitCode=1;
}finally{await browser.close();}
