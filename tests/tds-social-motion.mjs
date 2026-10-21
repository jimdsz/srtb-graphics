import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';

const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage();
await mkdir('reports/tds-social-motion',{recursive:true});
try{
  await page.goto((process.env.TDS_TEST_URL||'http://127.0.0.1:5194')+'/tests/social-sequences-qualification.html');
  await page.waitForFunction(()=>document.querySelector('#status')?.textContent==='PASS',{timeout:60000});
  const report=await page.evaluate(async()=>{
    const {SocialRenderer}=await import('/src/studio/social-renderer.ts'),{getTemplate,templateDefaults}=await import('/src/studio/domain.ts'),{makeTimeline}=await import('/src/studio/video/timeline.ts');
    const records=[];
    for(const id of ['BTV_BA_TDS','BTV_BA_TDS_SUIVI_DE'])for(const format of ['vertical','portrait'])for(const layout of format==='portrait'?['compact','legacy']:['compact']){
      const template=getTemplate(id),data={...templateDefaults(template),_studio_format:format,_studio_portrait_layout:layout,_out_mode:'duration',_out_duration_seconds:30};
      const renderer=new SocialRenderer(template,data,{},640),line=makeTimeline(id,data,{},30),original=renderer.text.bind(renderer);let draw=[];
      renderer.text=(...args)=>{for(const field of [args[7],...(args[8]||[]).map(run=>run.field)].filter(Boolean))if(/^(?:_p[12])?_titre_ligne_[123]$/.test(field))draw.push({field,alpha:renderer.ctx.globalAlpha,transform:[renderer.ctx.getTransform().e,renderer.ctx.getTransform().f]});return original(...args);};
      const frames=[0,50,88,89,90,99,109,110,344,345,394,395,396,405,415,416,749,750,751,767,768],samples=[];
      for(const frame of frames){draw=[];renderer.frame(frame/25,line,{},null);samples.push({frame,draw,cornerAlpha:renderer.ctx.getImageData(0,0,1,1).data[3]});}
      // An OUT before the follow-up marker must not silently switch programme
      // in the remaining 18 frames; this also covers manual/shortened runs.
      const early={...line,outAt:13.76,duration:14.48};draw=[];renderer.frame(14,early,{},null);const earlyOut=draw;
      renderer.dispose();records.push({id,format,layout,samples,earlyOut});
    }
    return records;
  });
  for(const record of report){
    const sample=frame=>record.samples.find(row=>row.frame===frame).draw;
    for(const frame of [0,50,88,89,90,109])assert.ok(sample(frame).length&&sample(frame).every(row=>row.alpha===1),`${record.id}/${record.format}/${record.layout}: social title readable from first frame`);
    if(record.id==='BTV_BA_TDS_SUIVI_DE'){
      for(const frame of [345,394,395,396,415])assert.ok(sample(frame).length&&sample(frame).every(row=>row.field.startsWith('_p2')&&row.alpha===1),'follow-up identifies P2 from its first frame');
      assert.ok(record.earlyOut.length&&record.earlyOut.every(row=>row.field.startsWith('_p1')),'early OUT retains programme1');
    }
    assert.deepEqual(sample(750),sample(749),'first OUT frame retains every title and its settled position');
    assert.ok(sample(751).length&&sample(751).every(row=>row.alpha===1),'OUT holds the complete card before fading');
    assert.equal(record.samples.find(row=>row.frame===751).cornerAlpha,255,'first OUT frames remain opaque');
    assert.ok(record.samples.find(row=>row.frame===767).cornerAlpha<13,'final fade composites the full frame once');
    assert.ok(sample(767).length&&sample(767).every(row=>row.alpha>0),'last OUT frame is painted');
    assert.equal(sample(768).length,0,'completed OUT is empty');
    console.log(JSON.stringify({id:record.id,format:record.format,layout:record.layout,socialTitleReadability:'PASS',outContinuity:'PASS',earlyOut:'PASS'}));
  }
  await writeFile('reports/tds-social-motion/report.json',JSON.stringify({at:new Date().toISOString(),report},null,2));
}finally{await browser.close();}
