import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const base=process.argv[2]||'http://127.0.0.1:5194';
const query=process.argv[3]||'';
const directory=resolve('reports/fade-encoded-current');
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const result={completed:false,status:'',records:[],pageErrors:[]};
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  page.on('pageerror',error=>result.pageErrors.push(error.message));
  await page.goto(base+'/tests/social-qualification.html'+query);
  const button=page.getByRole('button',{name:'Exporter et contrôler les dernières images · 6 modèles ciblés',exact:true});
  await expect(button).toBeVisible();
  await button.click();
  const status=page.locator('#status');
  await expect(status).toHaveText(/^(PASS|ÉCHEC)/,{timeout:1_200_000});
  result.status=(await status.textContent())||'';
  const details=(await page.locator('#results').textContent())||'[]';
  try{result.records=JSON.parse(details);}catch{result.records=[{raw:details}];}
  const expected=query?1:12;
  expect(result.status).toMatch(new RegExp(`^PASS · ${expected} cas exécutés`));
  expect(result.records).toHaveLength(expected);
  expect(result.records.every(record=>record.result==='PASS')).toBe(true);
  expect(result.pageErrors).toEqual([]);
  result.completed=true;
  console.log(JSON.stringify({passed:true,status:result.status,records:result.records.length,pageErrors:result.pageErrors}));
}catch(error){result.failure=String(error);throw error;}
finally{
  await writeFile(resolve(directory,'results.json'),JSON.stringify(result,null,2));
  await browser.close();
}
