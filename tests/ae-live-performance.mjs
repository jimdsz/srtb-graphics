import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1500,height:950}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
await mkdir('reports/ae-live',{recursive:true});
try {
  await page.goto('http://127.0.0.1:5221/tests/preview-reliability.html');
  await page.evaluate(()=>{document.getElementById('root').style.display='none';});
  const report=[];
  for(const id of ['BTV_Evenement','BTV_Semainier','BTV_Renvoi']) {
    const entry=await page.evaluate(async id=>{
      const module=await import(`/library/v1.7.0/${id}/graphic-v2.mjs`),tag=`qa-live-${id.toLowerCase().replaceAll('_','-')}`;
      if(!customElements.get(tag))customElements.define(tag,module.default);
      const graphic=document.createElement(tag);graphic.style.cssText='display:block;width:1440px;height:810px';document.body.append(graphic);window.qaGraphic=graphic;
      const data={...module.DEFAULTS,_audio_enabled:false,...(id==='BTV_Renvoi'?{_out_mode:'duration',_out_duration_seconds:7.4}:{})},started=performance.now();
      await graphic.load({data});await graphic.goToTime({seconds:5.28});
      return {id,loadMs:performance.now()-started,errors:graphic.getStatus().errors,
        testImages:[...graphic.shadowRoot.querySelectorAll('image')].filter(n=>/source\/images\/|img_/.test(n.getAttribute('href')||'')).length};
    },id);
    await page.screenshot({path:`reports/ae-live/${id}-empty.png`});
    assert.equal(entry.testImages,0);assert.deepEqual(entry.errors,[]);
    const playback=await page.evaluate(async()=>{
      const graphic=window.qaGraphic,data={...graphic.data};
      for(const key of Object.keys(data))if(key.startsWith('_media_')&&key.endsWith('_url'))data[key]={url:'/preview-media/v1/ba-programme.mp4',name:'Programme',mimeType:'video/mp4'};
      const start=performance.now();await graphic.updateAction(data);const mediaLoadMs=performance.now()-start;
      const original=HTMLCanvasElement.prototype.toDataURL;let pngCalls=0;HTMLCanvasElement.prototype.toDataURL=function(...args){pngCalls++;return original.apply(this,args);};
      const draws=[],draw=graphic._draw.bind(graphic);graphic._draw=(...args)=>{const at=performance.now();const result=draw(...args);draws.push({at,cost:performance.now()-at});return result;};
      void graphic.playAction();await new Promise(resolve=>setTimeout(resolve,6500));await graphic.pauseAction();
      HTMLCanvasElement.prototype.toDataURL=original;graphic._draw=draw;
      const gaps=draws.slice(1).map((v,i)=>v.at-draws[i].at).sort((a,b)=>a-b),costs=draws.map(v=>v.cost).sort((a,b)=>a-b);
      const videos=Object.values(graphic.tracks).flatMap(track=>track.clips.map(clip=>clip.node)).filter(node=>node instanceof HTMLVideoElement);
      return {mediaLoadMs,pngCalls,draws:draws.length,p95Gap:gaps[Math.floor(gaps.length*.95)],p95Draw:costs[Math.floor(costs.length*.95)],errors:graphic.getStatus().errors,videoTimes:videos.map(n=>n.currentTime),allPaused:videos.every(n=>n.paused),canvases:graphic.shadowRoot.querySelectorAll('foreignObject canvas').length};
    });
    await page.screenshot({path:`reports/ae-live/${id}-media.png`});
    assert.equal(playback.pngCalls,0,`${id}: no realtime PNG encoding`);assert.ok(playback.draws>=120,`${id}: cadence`);assert.ok(playback.p95Gap<85,`${id}: gaps`);assert.deepEqual(playback.errors,[]);assert.ok(playback.canvases>0);
    assert.ok(playback.videoTimes.some(time=>time>1),`${id}: decoded video advances`);assert.equal(playback.allPaused,true,`${id}: pause stops all sources`);
    report.push({...entry,...playback});console.log(JSON.stringify(report.at(-1)));
    await page.evaluate(async()=>{await window.qaGraphic.dispose();window.qaGraphic.remove();});
  }
  assert.deepEqual(errors,[]);await writeFile('reports/ae-live/playback.json',JSON.stringify({at:new Date().toISOString(),report,errors},null,2));
} finally {await browser.close();}
