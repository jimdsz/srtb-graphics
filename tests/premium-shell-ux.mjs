import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const base=process.argv[2]||'http://127.0.0.1:5221';
const directory=resolve('reports/premium-shell');
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const errors=[],checks=[];
try{
  // Headless keyboard shortcuts do not apply browser chrome zoom. Emulate the
  // geometry of a 1440x900 display at 200%: 720x450 CSS pixels with DPR 2. CSS
  // zoom:2 is NOT equivalent because it does not adjust media queries; separate
  // exploratory screenshots exposed that distinction and are not a pass claim.
  const scenarios=[{width:1440},{width:720,reflow:true},{width:390},{width:320}];
  for(const {width,reflow=false} of scenarios)for(const theme of ['dark','light']){
    const qualification=`${width}${reflow?'-reflow-200pct':''}`;
    const page=await browser.newPage({viewport:{width,height:reflow?450:width>800?900:844},deviceScaleFactor:reflow?2:1,reducedMotion:'reduce'});
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/api/**',route=>{
      if(new URL(route.request().url()).pathname==='/api/graphics/planner-summary')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({plans:0,updatedAt:null})});
      return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Unexpected remote call in UI fixture'})});
    });
    await page.goto(`${base}/tests/premium-shell.html`);
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    await expect(page.getByRole('heading',{name:'Aujourd’hui',exact:true})).toBeVisible();
    await expect(page.locator('.recent-projects .project-row')).toHaveCount(3);
    async function capture(name){
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
      await page.screenshot({path:resolve(directory,`${name}-${theme}-${qualification}.png`),fullPage:true});
      assert.equal(overflow,false,`${name} ${qualification} ${theme}: no horizontal page overflow`);
    }
    async function navigate(name){
      const toggle=page.getByRole('button',{name:'Menu',exact:true});
      if(await toggle.isVisible()&&await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
      await page.getByRole('navigation',{name:'Navigation Graphics',exact:true}).getByRole('button',{name,exact:true}).click();
    }
    async function modalExcludesBackground(){
      await expect(page.getByRole('dialog')).toBeVisible();
      // A native modal must block even an explicit focus() on a background
      // control, not merely have its first field receive initial focus.
      assert.equal(await page.evaluate(()=>{
        document.querySelector('.global-search-trigger')?.focus();
        return document.activeElement?.closest('dialog[open]')!==null;
      }),true,`${qualification} ${theme}: background cannot receive focus`);
      for(const key of ['Tab','Tab','Tab','Tab','Tab','Tab','Shift+Tab','Shift+Tab','Shift+Tab','Shift+Tab','Shift+Tab','Shift+Tab']){
        await page.keyboard.press(key);
        // Chromium may visit browser chrome; then body is reported as active.
        assert.equal(await page.evaluate(()=>document.activeElement===document.body||document.activeElement?.closest('dialog[open]')!==null),true,`${qualification} ${theme}: ${key} never reaches background controls`);
      }
    }
    await capture('home');
    await page.getByRole('button',{name:'Gérer les chaînes',exact:true}).click();
    await expect(page.getByRole('textbox',{name:'Nouvelle chaîne',exact:true})).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('dialog').getByRole('button',{name:'Fermer',exact:true})).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    // Chromium may visit browser chrome (body is reported) while cycling a native
    // dialog. It must never focus a background control, and returns inside.
    if(await page.evaluate(()=>document.activeElement===document.body))await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(()=>document.activeElement?.closest('dialog')!==null),true,'Native modal excludes background controls');
    await capture('channel-dialog');
    await page.getByRole('button',{name:'Équipe · Bénin TV',exact:true}).click();
    await expect(page.getByRole('checkbox',{name:'Poste de recette Accès administrateur',exact:true})).toBeDisabled();
    const teamMember=page.getByRole('checkbox',{name:'Coordination des programmes et de la production régionale coordination.programmes.et.production.regionale@example.test',exact:true});
    await expect(teamMember).toBeChecked();
    await teamMember.uncheck();
    await expect(teamMember).not.toBeChecked();
    await teamMember.check();
    await expect(teamMember).toBeChecked();
    await modalExcludesBackground();
    await capture('channel-team-dialog');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button',{name:'Gérer les chaînes',exact:true})).toBeFocused();
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('searchbox',{name:'Projet, émission ou média',exact:true})).toBeFocused();
    await page.getByRole('searchbox',{name:'Projet, émission ou média',exact:true}).fill('rendez-vous');
    await expect(page.getByRole('button',{name:'Le rendez-vous du soir Brouillon',exact:true})).toBeVisible();
    await modalExcludesBackground();
    await capture('search');
    await page.keyboard.press('Escape');
    await navigate('Émissions');
    await page.getByRole('button',{name:'Nouvelle émission',exact:true}).click();
    await expect(page.getByRole('textbox',{name:'Titre officiel',exact:true})).toBeFocused();
    await page.getByRole('textbox',{name:'Titre officiel',exact:true}).fill('Émission non enregistrée');
    await capture('programme');
    await navigate('Accueil');
    await expect(page.getByRole('dialog',{name:'Conserver cette fiche ouverte ?',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Rester sur la fiche',exact:true}).click();
    await expect(page.getByRole('textbox',{name:'Titre officiel',exact:true})).toHaveValue('Émission non enregistrée');
    // Changing the actual selector must obey the same guard as navigation.
    await page.getByRole('combobox',{name:'Chaîne de travail',exact:true}).selectOption('nouvelle-chaine');
    await page.getByRole('button',{name:'Rester sur la fiche',exact:true}).click();
    await expect(page.getByRole('combobox',{name:'Chaîne de travail',exact:true})).toHaveValue('benin-tv');
    await expect(page.getByRole('textbox',{name:'Titre officiel',exact:true})).toHaveValue('Émission non enregistrée');
    await navigate('Accueil');
    await page.getByRole('button',{name:'Quitter sans enregistrer',exact:true}).click();
    await navigate('Bibliothèque');
    await expect(page.getByRole('button',{name:'Créer un projet',exact:true})).toBeVisible();
    assert.equal(await page.locator('video,audio').count(),0,'Catalogue loads no audio/video before an explicit request');
    await capture('catalogue');
    await page.getByRole('searchbox',{name:'Rechercher un modèle',exact:true}).fill('introuvable');
    await expect(page.getByRole('heading',{name:'Aucun modèle trouvé',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Effacer les filtres',exact:true}).click();
    await page.getByRole('button',{name:'Créer un projet',exact:true}).click();
    await expect(page.getByRole('textbox',{name:'Nom du projet',exact:true})).toBeFocused();
    await modalExcludesBackground();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button',{name:'Créer un projet',exact:true})).toBeFocused();
    await page.evaluate(async()=>{const {selectChannel}=await import('/src/studio/channel-context.ts');selectChannel('nouvelle-chaine');});
    await expect(page.getByRole('heading',{name:'Votre espace est prêt',exact:true})).toBeVisible();
    await expect(page.locator('.recent-projects .project-row')).toHaveCount(0);
    await navigate('Bibliothèque');
    await expect(page.getByRole('heading',{name:'La bibliothèque de cette chaîne est vide',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Créer un projet',exact:true})).toHaveCount(0);
    await capture('empty-channel');
    checks.push(`${qualification} ${theme}: layout, catalogue filters, on-demand preview, native-dialog keyboard isolation and focus restoration, team dialog stub updates, keyboard search, programme dirty navigation/channel guards, channel isolation and empty catalogue`);
    await page.close();
  }
  assert.deepEqual(errors,[],'No browser runtime errors');
  const report={scope:'Isolated UI fixtures only: no real authentication, persistence, production API or accounts. 200% qualification emulates a 1440x900 display with 720x450 CSS pixels and DPR 2; native browser chrome zoom is not claimed. CSS zoom:2 was exploratory only (it does not recalculate media queries) and showed catalogue/header degradation; it is not part of the passed reflow qualification.',checks,errors};
  await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
