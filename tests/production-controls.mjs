import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const base=process.argv[2]||'http://127.0.0.1:5199';
const directory=resolve('reports/ui-production-controls');await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const results=[];
try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/tests/preview-reliability.html');
  await page.addStyleTag({path:resolve('src/studio/workbench.css')});
  await page.addStyleTag({path:resolve('src/studio/production-controls.css')});
  const play=()=>page.getByRole('button',{name:'Lire l’aperçu',exact:true});
  await expect(play()).toBeEnabled({timeout:30000});
  await play().click();
  const pause=page.getByRole('button',{name:'Mettre l’aperçu en pause',exact:true});
  await expect(pause).toBeEnabled();
  await expect(page.locator('.timeline-phase')).toHaveClass(/is-playing/);
  await pause.click();
  const resume=page.getByRole('button',{name:'Reprendre l’aperçu',exact:true});await expect(resume).toBeEnabled();
  const position=()=>page.getByRole('slider',{name:'Position dans l’aperçu',exact:true}).inputValue();
  const held=await position();await page.waitForTimeout(300);if(await position()!==held)throw Error('Pause moved the playhead');
  await resume.click();await expect.poll(position).not.toBe(held);
  await page.getByRole('button',{name:'Effacer l’aperçu',exact:true}).click();await expect(play()).toBeEnabled();
  results.push('Lire → Pause (position figée) → Reprendre (position avance) → Effacer');
  await page.getByRole('slider',{name:'Position dans l’aperçu',exact:true}).focus();await page.keyboard.press('ArrowRight');
  await expect(resume).toBeEnabled();results.push('Déplacement au clavier sur la réglette puis reprise disponible');
  await page.getByRole('button',{name:'Recommencer l’aperçu (IN)',exact:true}).click();await expect(pause).toBeEnabled();
  await pause.click();await page.getByText('Précision',{exact:true}).click();await expect(page.getByRole('spinbutton',{name:'Temps d’inspection en secondes'})).toBeVisible();
  await page.getByRole('button',{name:'Médias',exact:true}).click();await expect(page.getByRole('button',{name:'Médias',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Textes et dates',exact:true}).click();results.push('Recherche/familles et détails de précision accessibles');
  await page.getByRole('radio',{name:'Vertical 9:16',exact:true}).check();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await expect(page.locator('.preview-loading')).toHaveCount(0,{timeout:30000});
  await expect(play()).toBeEnabled({timeout:30000});
  await expect(page.locator('.preview-screen')).toHaveClass(/social-screen/);
  await page.getByRole('radio',{name:'Télévision 16:9',exact:true}).check();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await expect(page.locator('.preview-loading')).toHaveCount(0,{timeout:30000});await expect(play()).toBeEnabled({timeout:30000});
  results.push('Formats visuels : passage TV → 9:16 → TV, chargement terminé');
  for(const [theme,width,height]of [['dark',1440,1100],['light',1440,1100],['dark',390,844]]){
    await page.setViewportSize({width,height});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    const overflow=await page.evaluate(()=>({page:document.documentElement.scrollWidth>innerWidth+1,transport:[...document.querySelectorAll('.monitor-transport button')].filter(b=>b.scrollWidth>b.clientWidth+1).map(b=>b.getAttribute('aria-label')||b.textContent),category:[...document.querySelectorAll('.settings-categories button')].filter(b=>b.scrollWidth>b.clientWidth+1).map(b=>b.textContent)}));
    if(overflow.page||overflow.transport.length||overflow.category.length)throw Error('Overflow '+JSON.stringify({theme,width,...overflow}));
    await page.locator('.preview-panel').screenshot({path:resolve(directory,`monitor-${theme}-${width}.png`)});results.push(`${theme} ${width}px : aucun débordement page/commandes/catégories`);
    if(width===390){await page.locator('.presentation-settings').screenshot({path:resolve(directory,'format-chooser-mobile.png')});await page.locator('.inspector-toolbox').screenshot({path:resolve(directory,'inspector-mobile.png')});}
  }
  if(errors.length)throw Error(errors.join('\n'));
  await writeFile(resolve(directory,'results.json'),JSON.stringify({passed:true,results,pageErrors:errors},null,2));
  console.log(JSON.stringify({passed:true,results}));
}finally{await browser.close();}
