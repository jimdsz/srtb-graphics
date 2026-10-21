import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const base=new URL(process.argv[2]||'https://srtb-graphics.pages.dev');
if(base.protocol!=='https:'||!/(^|\.)srtb-graphics\.pages\.dev$/.test(base.hostname))throw Error('Cible SRTB Graphics HTTPS requise.');
const browser=await chromium.launch({channel:'msedge',headless:true});
const pageErrors=[],consoleErrors=[],unauthorizedResponses=[];
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror',error=>pageErrors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
  page.on('response',response=>{if(response.status()===401)unauthorizedResponses.push(response.url());});
  await page.addInitScript(()=>{
    const state={lcp:0,cls:0,longTasks:0,longTaskMs:0};
    Object.defineProperty(window,'__srtbPerformance',{value:state});
    try{new PerformanceObserver(list=>{for(const entry of list.getEntries())state.lcp=Math.max(state.lcp,entry.startTime);}).observe({type:'largest-contentful-paint',buffered:true});}catch{}
    try{new PerformanceObserver(list=>{for(const entry of list.getEntries())if(!entry.hadRecentInput)state.cls+=entry.value;}).observe({type:'layout-shift',buffered:true});}catch{}
    try{new PerformanceObserver(list=>{for(const entry of list.getEntries()){state.longTasks++;state.longTaskMs+=entry.duration;}}).observe({type:'longtask',buffered:true});}catch{}
  });
  const started=Date.now();
  const response=await page.goto(new URL('/graphics',base).href,{waitUntil:'networkidle',timeout:30000});
  assert.equal(response?.status(),200);
  await page.waitForTimeout(300);
  const metrics=await page.evaluate(()=>{
    const navigation=performance.getEntriesByType('navigation')[0];
    const resources=performance.getEntriesByType('resource').map(entry=>({name:new URL(entry.name).pathname,initiatorType:entry.initiatorType,transferSize:entry.transferSize,encodedBodySize:entry.encodedBodySize,duration:entry.duration}));
    const js=resources.filter(entry=>entry.name.endsWith('.js'));
    const css=resources.filter(entry=>entry.name.endsWith('.css'));
    return {wallMs:0,domContentLoaded:navigation.domContentLoadedEventEnd,load:navigation.loadEventEnd,transferBytes:resources.reduce((sum,entry)=>sum+entry.transferSize,0),encodedBytes:resources.reduce((sum,entry)=>sum+entry.encodedBodySize,0),jsTransferBytes:js.reduce((sum,entry)=>sum+entry.transferSize,0),cssTransferBytes:css.reduce((sum,entry)=>sum+entry.transferSize,0),requests:resources.length,jsRequests:js.length,cssRequests:css.length,largest:resources.sort((a,b)=>b.encodedBodySize-a.encodedBodySize).slice(0,12),observed:window.__srtbPerformance};
  });
  metrics.wallMs=Date.now()-started;
  const expectedSessionProbe=unauthorizedResponses.length===1&&new URL(unauthorizedResponses[0]).pathname==='/api/me';
  const unexpectedConsoleErrors=consoleErrors.filter(message=>!(expectedSessionProbe&&/^Failed to load resource: the server responded with a status of 401/.test(message)));
  const report={kind:'srtb-production-shell-performance',at:new Date().toISOString(),url:new URL('/graphics',base).href,metrics,pageErrors,consoleErrors,unauthorizedResponses,expectedSessionProbe,budgets:{transferBytes:1_500_000,jsTransferBytes:900_000,requests:35,cls:.1,longTaskMs:1000}};
  const directory=resolve('reports','production-shell-performance');await mkdir(directory,{recursive:true});
  const path=resolve(directory,'latest.json');await writeFile(path,JSON.stringify(report,null,2)+'\n');
  assert.deepEqual(pageErrors,[]);
  assert.deepEqual(unexpectedConsoleErrors,[]);
  assert.equal(expectedSessionProbe,true,'La coque anonyme doit vérifier exactement une fois /api/me.');
  assert.ok(metrics.transferBytes<=report.budgets.transferBytes,`Transfert initial trop lourd : ${metrics.transferBytes} octets.`);
  assert.ok(metrics.jsTransferBytes<=report.budgets.jsTransferBytes,`JavaScript initial trop lourd : ${metrics.jsTransferBytes} octets.`);
  assert.ok(metrics.requests<=report.budgets.requests,`Trop de requêtes initiales : ${metrics.requests}.`);
  assert.ok(metrics.observed.cls<=report.budgets.cls,`Décalage de mise en page excessif : ${metrics.observed.cls}.`);
  assert.ok(metrics.observed.longTaskMs<=report.budgets.longTaskMs,`Fil d’interface bloqué ${metrics.observed.longTaskMs} ms.`);
  console.log(JSON.stringify({passed:true,report:path,metrics},null,2));
}finally{await browser.close();}
