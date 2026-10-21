import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const base=process.argv[2]||'http://127.0.0.1:5221',directory=resolve('reports/programme-voice-resources');
await mkdir(directory,{recursive:true});
const id=n=>`22222222-2222-4222-8222-${String(n).padStart(12,'0')}`,url=n=>`/api/graphics/media/${id(n)}/content`;
const rate=48000,length=rate*3,wav=Buffer.alloc(44+length*2);
wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(length*2,40);
const browser=await chromium.launch({channel:'msedge',headless:true}),errors=[],unexpected=[],checks=[];
const audit=page=>page.evaluate(()=>window.programmeVoiceFixture.evidence);
async function open(width,theme,parameters={}){
  const page=await browser.newPage({viewport:{width,height:width===720?450:width===1366?768:844},deviceScaleFactor:width===720?2:1,reducedMotion:'reduce'});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{
    const request=route.request(),target=new URL(request.url());
    if(target.origin!==new URL(base).origin){unexpected.push(request.url());return route.abort();}
    if(target.pathname.startsWith('/api/')){
      if(request.method()==='GET'&&/^\/api\/graphics\/media\/22222222-2222-4222-8222-00000000002[123]\/content$/.test(target.pathname))return route.fulfill({status:200,contentType:'audio/wav',body:wav});
      unexpected.push(`${request.method()} ${target.pathname}`);return route.fulfill({status:500,body:'Unexpected API call in fixture'});
    }
    return route.continue();
  });
  await page.goto(`${base}/tests/programme-voice-resources.html?${new URLSearchParams(parameters)}`);
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  await expect.poll(()=>page.evaluate(()=>window.programmeVoiceFixture?.ready)).toBe(true);
  await page.getByRole('button',{name:'Ouvrir la voix de recette',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  return page;
}
const proposal=page=>page.getByRole('button',{name:'Proposer cette voix',exact:true});
const source=page=>page.getByRole('combobox',{name:'Audio privé partagé',exact:true});
const confirm=page=>page.getByRole('checkbox',{name:/J’ai écouté ce passage/});
const save=page=>page.getByRole('button',{name:'Conserver la voix et le calage',exact:true});
async function capture(page,name){
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1||[...document.querySelectorAll('dialog[open]')].some(node=>node.scrollWidth>node.clientWidth+1));
  await page.screenshot({path:resolve(directory,`${name}.png`)});assert.equal(overflow,false,`${name}: no horizontal overflow`);
}
try{
  for(const width of [1366,720,320])for(const theme of ['dark','light']){
    const page=await open(width,theme),name=`${theme}-${width}`;
    await expect(proposal(page)).toBeEnabled();await expect(source(page)).toHaveValue('');
    assert.equal(await page.locator('audio').count(),0,'No player before explicit proposal');
    assert.equal((await audit(page)).playCalls,0);assert.equal((await audit(page)).changes.length,0);
    await capture(page,`proposal-${name}`);
    await proposal(page).focus();await page.keyboard.press('Enter');
    await expect(source(page)).toHaveValue(url(21));await expect(save(page)).toBeDisabled();await expect(confirm(page)).toBeDisabled();
    await expect(page.getByRole('button',{name:'Écouter le passage',exact:true})).toBeDisabled();
    assert.equal((await audit(page)).decodeCalls,0,'Proposal never starts measurement');
    await page.getByRole('button',{name:'Mesurer le fichier entier',exact:true}).click();
    await expect(page.getByText(/3 s mesurées/)).toBeVisible();
    await page.locator('.planner-voice-range>summary').click();
    await expect(page.getByRole('spinbutton',{name:'Début dans le fichier (s)',exact:true})).toHaveValue('1.25');
    await expect(page.getByRole('spinbutton',{name:'Fin dans le fichier (s)',exact:true})).toHaveValue('2.75');
    assert.equal((await audit(page)).decodeCalls,1);await expect(confirm(page)).toBeDisabled();await expect(save(page)).toBeDisabled();
    await page.evaluate(()=>window.programmeVoiceFixture.finishAudition(2.75));await expect(confirm(page)).toBeDisabled();
    await page.getByRole('button',{name:'Écouter le passage',exact:true}).click();
    await expect(confirm(page)).toBeDisabled();
    await page.evaluate(()=>window.programmeVoiceFixture.finishAudition(2.75));await expect(confirm(page)).toBeEnabled();await expect(save(page)).toBeDisabled();
    await confirm(page).check();await expect(save(page)).toBeEnabled();
    await capture(page,`confirmed-${name}`);
    assert.equal((await audit(page)).changes.length,0,'Attestation does not save automatically');
    await save(page).click();await expect(page.getByRole('dialog')).toHaveCount(0);
    const result=await audit(page);assert.equal(result.changes.length,1);assert.equal(result.changes[0].source.url,url(21));assert.equal(result.changes[0].sourceDuration,3);assert.equal(result.changes[0].start,1.25);assert.equal(result.changes[0].end,2.75);assert.equal(result.changes[0].cue,'Mardi');assert.equal(result.changes[0].confirmed,true);
    await expect(page.getByRole('button',{name:'Ouvrir la voix de recette',exact:true})).toBeFocused();
    checks.push(`${name}: explicit proposal, real synthetic WAV decoding preserves bounds, simulated audition then attestation then save, keyboard/reflow`);await page.close();
  }
  for(const scenario of ['wrong-day','revision-mismatch','archived','voice-archived','unvalidated','unavailable','no-voice']){
    const page=await open(320,'light',{case:scenario,existing:'1'});
    await expect(source(page)).toHaveValue(url(23));
    if(scenario!=='no-voice')await expect(page.getByRole('button',{name:'Actualiser la fiche',exact:true})).toBeVisible();
    else await expect.poll(async()=>(await audit(page)).programmeCalls.length).toBe(1);
    await expect(proposal(page)).toHaveCount(0);await expect(save(page)).toBeEnabled();
    assert.equal((await audit(page)).changes.length,0);assert.equal((await audit(page)).playCalls,0);
    if(['revision-mismatch','archived','unavailable','no-voice'].includes(scenario))assert.equal((await audit(page)).profileCalls.length,0);
    checks.push(`${scenario}: no proposal, manual saved choice preserved, no automatic write/play`);await page.close();
  }
  {
    const page=await open(1366,'dark',{existing:'1',hold:'profile-1'});
    await expect.poll(async()=>(await audit(page)).profileCalls.length).toBe(1);
    await expect(source(page)).toHaveValue(url(23));await expect(save(page)).toBeEnabled();
    await page.evaluate(()=>window.programmeVoiceFixture.changeProgramme(2));
    await expect(page.getByText(/Voix fiche B/)).toBeVisible();
    await page.evaluate(()=>window.programmeVoiceFixture.release('profile-1'));
    await expect(page.getByText(/Voix fiche A/)).toHaveCount(0);await expect(source(page)).toHaveValue(url(23));await expect(save(page)).toBeEnabled();
    assert.equal((await audit(page)).changes.length,0);checks.push('Late profile A after programme B cannot replace the newer proposal or the saved manual choice');await page.close();
  }
  {
    const page=await open(1366,'light',{hold:'programme-1'});
    await expect(source(page)).toBeEnabled();await source(page).selectOption(url(23));
    await page.evaluate(()=>window.programmeVoiceFixture.release('programme-1'));await expect(proposal(page)).toBeEnabled();
    await expect(source(page)).toHaveValue(url(23));assert.equal((await audit(page)).changes.length,0);assert.equal((await audit(page)).playCalls,0);
    await page.evaluate(()=>window.programmeVoiceFixture.changeProgramme(1,4,'2026-09-30'));
    await expect(proposal(page)).toHaveCount(0);await expect(page.getByText(/n’est pas validée pour cette annonce/)).toBeVisible();await expect(source(page)).toHaveValue(url(23));
    checks.push('Delayed programme response preserves a manual choice; a later air-date change removes the incompatible proposal');await page.close();
  }
  {
    const page=await open(320,'dark',{case:'media-error',existing:'1'});
    await expect(page.getByText('Catalogue audio indisponible en recette',{exact:true})).toBeVisible();await expect(page.getByText(/Aucun audio partagé prêt/)).toHaveCount(0);await expect(save(page)).toBeDisabled();
    await page.getByRole('button',{name:'Réessayer la liste',exact:true}).click();await expect(save(page)).toBeEnabled();await expect(source(page)).toHaveValue(url(23));
    assert.equal((await audit(page)).changes.length,0);checks.push('Audio catalogue failure is not empty state; retry retains saved choice');await page.close();
  }
  {
    const page=await open(320,'light',{case:'missing-media'});await expect(proposal(page)).toBeDisabled();await expect(source(page)).toHaveValue('');assert.equal((await audit(page)).changes.length,0);checks.push('Missing shared source disables proposal without creating a reference');await page.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
  const report={scope:'Isolated local UI APIs. Synthetic silent WAV is genuinely decoded; play/timeupdate are deliberately simulated only to test gates, not real listening or voice content. No account, backend permissions, real programme resource or production qualification. 720×450 is reflow emulation, not native browser zoom.',checks,errors,unexpected};
  await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
