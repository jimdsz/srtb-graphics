import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const base=process.argv[2]||'http://127.0.0.1:5199';
const directory=resolve('reports/ui-delivery-workbench');await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});const results=[];
try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[],writes=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(!['GET','HEAD'].includes(request.method()))writes.push(request.method()+' '+request.url());});
  await page.goto(base+'/tests/delivery-workbench.html');
  const mp4=page.getByRole('radio',{name:'MP4 · H.264 · Fond opaque',exact:true});const mov=page.getByRole('radio',{name:'MOV · ProRes 4444 · Transparence alpha',exact:true});
  await expect(mp4).toBeChecked();await expect(page.getByRole('button',{name:'Télécharger la vidéo',exact:true})).toBeDisabled();
  await mov.check();await expect(page.getByRole('button',{name:'Télécharger le MOV',exact:true})).toBeDisabled();
  await page.getByRole('checkbox',{name:'Sans voix off pour cet export',exact:false}).check();await expect(page.getByRole('button',{name:'Télécharger le MOV',exact:true})).toBeEnabled();
  results.push('Voix manquante : aucun export sans décision explicite, choix de format toujours accessible');
  await page.getByText('Options · fond et son',{exact:false}).click();
  const audio=page.getByRole('checkbox',{name:'Inclure les pistes sonores activées dans le projet',exact:true});await audio.uncheck();
  await page.getByRole('checkbox',{name:'Retirer les médias de fond plein écran',exact:true}).check();
  await mp4.focus();await page.keyboard.press('Space');await expect(mp4).toBeChecked();await page.keyboard.press('ArrowRight');await expect(mov).toBeChecked();await expect(audio).not.toBeChecked();
  await page.getByRole('radio',{name:'PNG · Séquence · ZIP · Transparence alpha',exact:true}).check();await expect(page.getByRole('button',{name:'Télécharger la séquence PNG',exact:true})).toBeEnabled();
  await expect(page.getByRole('spinbutton',{name:'Déclencher OUT après (secondes)',exact:true})).toHaveValue('12');results.push('Formats au clavier, options conservées, PNG distinct et sortie 12 s intacte');
  await page.getByText('Autres formats · HTML / réglages',{exact:true}).click();await page.getByRole('button',{name:'Sauvegarder les réglages (.json)',exact:true}).click();await expect(page.getByLabel('Sauvegardes de recette')).toHaveText('1');
  await expect(page.getByRole('button',{name:'Télécharger le paquet HTML (.zip)',exact:true})).toBeEnabled();results.push('Livraison HTML distincte et sauvegarde JSON câblée');
  await page.getByText('Autres formats · HTML / réglages',{exact:true}).click();await page.getByText('Options · fond et son',{exact:false}).click();
  await page.getByRole('checkbox',{name:'Voix à associer (recette)',exact:true}).uncheck();await mov.check();
  for(const [theme,width,height] of [['dark',1440,1100],['light',1440,1100],['dark',390,844],['light',390,844]]){
    await page.setViewportSize({width,height});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    const overflow=await page.evaluate(()=>({page:document.documentElement.scrollWidth>innerWidth+1,controls:[...document.querySelectorAll('.delivery-panel button,.delivery-format,.delivery-panel .button-link')].filter(el=>el.scrollWidth>el.clientWidth+2).map(el=>el.textContent)}));
    if(overflow.page||overflow.controls.length)throw Error('Overflow '+JSON.stringify({theme,width,...overflow}));
    const durationHeight=await page.getByRole('spinbutton',{name:'Déclencher OUT après (secondes)',exact:true}).evaluate(el=>el.getBoundingClientRect().height);if(durationHeight>52)throw Error('Oversized duration control '+durationHeight);
    await page.locator('.editor-sidebar').screenshot({path:resolve(directory,`export-${theme}-${width}.png`),animations:'disabled'});
    results.push(`${theme} ${width}px : aucun débordement horizontal`);
  }
  await page.setViewportSize({width:1440,height:1100});await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  await page.getByLabel('État de contrôle').selectOption('working');await expect(page.getByRole('progressbar',{name:'Calcul des images · recette'})).toHaveAttribute('aria-valuenow','61');
  await page.locator('[aria-label="États de recette"]').screenshot({path:resolve(directory,'progress-dark.png')});
  await page.getByLabel('État de contrôle').selectOption('warning');await expect(page.getByRole('alert')).toContainText('Recette : le débit mesuré est inférieur');await expect(page.getByLabel('Rapport du fichier exporté')).toContainText('24,12 Mb/s');
  await page.locator('[aria-label="États de recette"]').screenshot({path:resolve(directory,'report-warning-dark.png')});
  await page.emulateMedia({reducedMotion:'reduce'});const transition=await mov.locator('..').evaluate(el=>getComputedStyle(el).transitionDuration);if(transition!=='0s')throw Error('Reduced-motion not respected: '+transition);
  results.push('Progression réelle fournie, avertissement débit visible, mesure lisible et mouvement réduit');
  if(errors.length)throw Error(errors.join('\n'));if(writes.length)throw Error('Unexpected writes '+writes.join('\n'));
  await writeFile(resolve(directory,'results.json'),JSON.stringify({passed:true,results,pageErrors:errors,networkWrites:writes},null,2));console.log(JSON.stringify({passed:true,results}));
}finally{await browser.close();}
