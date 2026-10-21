import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

// Existing premium-shell fixture: real Studio/header/queue, synthetic fixture APIs.
// No module replacement, server lifecycle, renderer or real export in this runner.
const base=process.argv.find(value=>/^https?:/.test(value))||'http://127.0.0.1:5198';
const baseline=process.argv.includes('--baseline'),directory=resolve('reports/export-queue-shell');
const checks=[],errors=[],unexpectedRequests=[],prefix=baseline?'before':'after';
const queue=page=>page.getByRole('button',{name:/^Exports · \d+ dans la file$/});
const panel=page=>page.getByRole('region',{name:'File d’exports',exact:true});
const menu=page=>page.getByRole('button',{name:'Menu',exact:true});
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
async function geometry(page){return page.evaluate(()=>{
 const selectors={identity:'.graphics-identity',channel:'.graphics-channel',search:'.global-search-trigger',exports:'.export-queue-trigger',profile:'.profile',menu:'.mobile-nav-toggle'};
 const rect=node=>{const value=node.getBoundingClientRect();return {x:value.x,y:value.y,width:value.width,height:value.height,right:value.right,bottom:value.bottom};};
 const visible=node=>node&&node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden';
 const masthead=document.querySelector('.graphics-masthead'),boxes=Object.fromEntries(Object.entries(selectors).flatMap(([name,selector])=>{const node=masthead.querySelector(selector);return visible(node)?[[name,rect(node)]]:[];}));
 const overlaps=[];for(const [a,A] of Object.entries(boxes))for(const [b,B] of Object.entries(boxes))if(a<b){const width=Math.min(A.right,B.right)-Math.max(A.x,B.x),height=Math.min(A.bottom,B.bottom)-Math.max(A.y,B.y);if(width>1&&height>1)overlaps.push({a,b,width,height});}
 const controls=[...masthead.querySelectorAll('button,a,select')].filter(visible).map(node=>({name:node.getAttribute('aria-label')||node.getAttribute('title')||node.textContent.trim(),...rect(node)}));
 const header=rect(masthead),outOfBounds=controls.filter(box=>box.x<-.5||box.right>innerWidth+.5||box.y<header.y-.5||box.bottom>header.bottom+.5);
 const manage=masthead.querySelector('.channel-manage'),range=document.createRange();range.selectNodeContents(manage);const manageTextLines=[...new Set([...range.getClientRects()].map(box=>Math.round(box.y)))].length;
 const select=masthead.querySelector('select[aria-label="Chaîne de travail"]'),style=getComputedStyle(select),measure=document.createElement('canvas').getContext('2d');measure.font=style.font;const channelLabelWidth=measure.measureText(select.selectedOptions[0].text).width,channelLabelRoom=select.getBoundingClientRect().width-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)-parseFloat(style.borderLeftWidth)-parseFloat(style.borderRightWidth);
 return {viewport:{width:innerWidth,height:innerHeight},header,boxes,controls,overlaps,outOfBounds,manageTextLines,channelLabelWidth,channelLabelRoom,headerOverflow:masthead.scrollWidth>masthead.clientWidth+1,bodyOverflow:document.documentElement.scrollWidth>innerWidth+1};
});}
async function capture(page,label){await page.screenshot({path:resolve(directory,`${prefix}-${label}.png`),fullPage:true});}
function validate(result,label){
 assert.deepEqual(result.overlaps,[],`${label}: header controls overlap`);assert.deepEqual(result.outOfBounds,[],`${label}: controls must stay inside masthead/viewport`);assert.equal(result.headerOverflow,false,`${label}: header overflow`);assert.equal(result.bodyOverflow,false,`${label}: body overflow`);assert.ok(result.boxes.exports.width>=44&&result.boxes.exports.height>=44,`${label}: export button target`);assert.equal(result.manageTextLines,1,`${label}: Gérer stays on one line`);
 const {width}=result.viewport,{exports,profile,channel,search,menu}=result.boxes;
 assert.ok(result.channelLabelRoom>=result.channelLabelWidth,`${label}: the short channel name fits without truncation`);if(width>=801&&width<=1199)assert.ok(result.controls.find(control=>control.name==='Chaîne de travail').width>=90,`${label}: channel selector is at least 90px`);
 if(width<=800){assert.ok(Math.abs(exports.y-profile.y)<=1,`${label}: Exports and account share a row`);assert.ok(search.height>=44&&menu.height>=44,`${label}: search/menu targets`);if(width>600){assert.ok(Math.abs(exports.y-channel.y)<=1,`${label}: two-row header with channel, exports, profile together`);assert.ok(result.header.height<=130,`${label}: two-row height`);}else{assert.ok(exports.y>=channel.bottom,`${label}: exports/account below channel`);assert.ok(result.header.height<=182,`${label}: three-row height`);}}
}
try{
 for(const width of baseline?[1366,1024,900,800,683,390,320]:[1366,1051,1050,1024,900,801,800,683,603,600,390,320])for(const theme of ['dark','light']){
  const reflow=width===683,label=`${theme}-${width}${reflow?'-reflow-200':''}`;
  const context=await browser.newContext({viewport:{width,height:reflow?384:width>800?768:844},deviceScaleFactor:reflow?2:1,reducedMotion:'reduce'}),page=await context.newPage();
  page.on('pageerror',error=>errors.push({label,message:error.message}));
  await page.route('**/*',route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin===base&&url.pathname==='/api/graphics/planner-summary'&&request.method()==='GET')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({plans:0,updatedAt:null})});
   if(url.origin!==base||url.pathname.startsWith('/api/')||!['GET','HEAD'].includes(request.method())||request.resourceType()==='media'){
    unexpectedRequests.push({label,path:url.pathname,method:request.method()});return route.abort();
   }
   return route.continue();
  });
  await page.goto(`${base}/tests/premium-shell.html`,{waitUntil:'domcontentloaded'});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  await expect(page.getByRole('heading',{name:'Aujourd’hui',exact:true})).toBeVisible();await expect(page.locator('.recent-projects .project-row')).toHaveCount(3);await expect(queue(page)).toBeVisible();await page.evaluate(()=>document.fonts.ready);
  const initial=await geometry(page);await capture(page,`header-${label}`);let badgeGeometry;
  if(!baseline){
   validate(initial,label);await expect(panel(page)).toHaveCount(0);
   // Geometry-only stress: real store remains empty and no job is enqueued.
   await queue(page).evaluate(button=>{const badge=document.createElement('span');badge.className='export-queue-count';badge.dataset.fixtureBadge='true';badge.setAttribute('aria-hidden','true');badge.textContent='8';button.append(badge);});badgeGeometry=await geometry(page);validate(badgeGeometry,`${label} synthetic badge8`);await capture(page,`header-badge8-${label}`);await page.locator('[data-fixture-badge]').evaluate(node=>node.remove());
   await queue(page).focus();await page.keyboard.press('Enter');await expect(panel(page)).toBeVisible();await expect(panel(page).getByRole('heading',{name:'File d’exports',exact:true})).toBeFocused();await expect(panel(page)).not.toHaveAttribute('aria-modal','true');await page.keyboard.press('Escape');await expect(panel(page)).toHaveCount(0);await expect(queue(page)).toBeFocused();
   if(width<=800){
    await expect(menu(page)).toBeVisible();await menu(page).focus();await page.keyboard.press('Space');await expect(menu(page)).toHaveAttribute('aria-expanded','true');await expect(page.getByRole('navigation',{name:'Navigation Graphics',exact:true})).toBeVisible();validate(await geometry(page),`${label} menu open`);await capture(page,`menu-${label}`);
    await menu(page).focus();await page.keyboard.press('Enter');await expect(menu(page)).toHaveAttribute('aria-expanded','false');await expect(page.getByRole('navigation',{name:'Navigation Graphics',exact:true})).not.toBeVisible();await expect(menu(page)).toBeFocused();
   }else await expect(page.getByRole('navigation',{name:'Navigation Graphics',exact:true})).toBeVisible();
   await page.locator('.global-search-trigger').focus();await page.keyboard.press('Enter');await expect(page.getByRole('searchbox',{name:'Projet, émission ou média',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(page.locator('.global-search-trigger')).toBeFocused();
   await queue(page).focus();await page.keyboard.press('Space');await expect(panel(page)).toBeVisible();await panel(page).getByRole('button',{name:'Fermer la file d’exports',exact:true}).focus();await page.keyboard.press('Enter');await expect(panel(page)).toHaveCount(0);await expect(queue(page)).toBeFocused();await expect(page.locator('video,audio')).toHaveCount(0);
  }
  checks.push({label,phase:prefix,reflowCSSOnly:reflow,geometry:initial,...(badgeGeometry?{syntheticBadge8Geometry:badgeGeometry}:{}),keyboard:!baseline});await context.close();
 }
}catch(error){errors.push({message:error.stack||String(error)});throw error;}
finally{
 await writeFile(resolve(directory,baseline?'baseline.json':'report.json'),JSON.stringify({scope:'Existing premium-shell.html unchanged, real Studio and empty real export queue; fixture API mocks plus planner-summary HTTP response. Badge8 is a geometry-only DOM addition removed before keyboard checks, not 8 real jobs. No actual account, export, playback or server mutation. 683×384 CSS pixels with DPR2 qualifies the reflow area of 1366×768 at 200%, not native browser zoom. Baseline is diagnostic only, not a pass claim.',phase:prefix,checks,errors,unexpectedRequests},null,2));await browser.close();console.log(JSON.stringify({phase:prefix,checks:checks.length,errors,unexpectedRequests,issues:checks.filter(check=>check.geometry.overlaps.length||check.geometry.outOfBounds.length||check.geometry.headerOverflow||check.geometry.bodyOverflow).map(check=>({label:check.label,geometry:check.geometry}))},null,2));
}
assert.deepEqual(errors,[]);assert.deepEqual(unexpectedRequests,[]);
