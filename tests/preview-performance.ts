import {catalogueCompositions,COMPOSITION_COUNT,assertCompositionCoverage} from './catalogue-matrix';
import type {LegacyGraphic} from '../src/studio/video/engine';
import {installBAMediaReadiness} from '../src/studio/media-readiness';
import {attachSocialPreview} from '../src/studio/social-preview';
import {socialTrackTimes,liveSocialPictures,type PictureCache} from '../src/studio/social-renderer';
import {tracksOf} from '../src/studio/media-tracks';
import {previewData} from '../src/studio/preview-data';
import {engineData} from '../src/studio/presentation';
import {installSocialScene} from '../src/studio/social-scene';
import {TIMINGS} from '../src/studio/video/timeline';
import {installGraphicCompatibility} from '../src/studio/graphic-compatibility';
import type {ProjectData} from '../src/studio/domain';
import {installBALoader,previewSources} from '../src/studio/preview-resources';
import {previewAudio} from '../src/studio/preview-audio';
import {installPreviewBackgrounds} from '../src/studio/preview-backgrounds';

export async function measurePreviews(status:(s:string)=>void,save:(name:string,body:string)=>Promise<void>,signal:AbortSignal,dataFor:(id:string,format:string)=>ProjectData){
  const records=[];
  for(const {template,format} of catalogueCompositions()){
    signal.throwIfAborted();status(`Mesure lecture : ${template.name} · ${format} · ${records.length+1}/${COMPOSITION_COUNT}`);
    const loadStart=performance.now(),stop=Math.max(8,TIMINGS[template.id].entry+.4);
    const data=previewSources(template,{...dataFor(template.id,format),_out_mode:'duration',_out_duration_seconds:stop});
    const module=await import(/* @vite-ignore */template.module),tag='perf-'+template.id.toLowerCase().replaceAll('_','-');
    if(!customElements.get(tag))customElements.define(tag,class extends module.default{});
    const g=document.createElement(tag) as LegacyGraphic,host=document.createElement('div');host.style.cssText='position:fixed;right:12px;top:12px;width:270px;height:480px;z-index:1000;background:#333';host.append(g);document.body.append(host);
    let raf=0,audio:Awaited<ReturnType<typeof previewAudio>>|undefined;let peak=0;const gaps:number[]=[],missing:Record<string,number>={},expected:Record<string,number>={};
    const abort=new AbortController();const cancel=()=>abort.abort();signal.addEventListener('abort',cancel,{once:true});
    try{
      audio=await previewAudio(g,template);installBALoader(g,template,()=>{});
      if(format==='tv'){installGraphicCompatibility(g,{...template,module:new URL(template.module,location.href).href});installPreviewBackgrounds(g,template,()=>{});}else installSocialScene(g,template);await installBAMediaReadiness(template);
      const loaded=await g.load({renderType:'realtime',previewMuted:true,data:previewData(engineData(data),true,!!g.setMuted)});if(loaded.statusCode>=400)throw Error(loaded.statusMessage);
      if(format!=='tv')await attachSocialPreview(g,template,previewData(data,true,!!g.setMuted),abort.signal);
      const loadMs=performance.now()-loadStart;
      const audioStart=performance.now();await audio.unlock();await g.updateAction(format==='tv'?engineData(data):data);if(g.setMuted)await g.setMuted(false);const audioPrepareMs=Math.round(performance.now()-audioStart);
      const cache:PictureCache=new Map();liveSocialPictures(tracksOf(g),Object.fromEntries(Object.keys(tracksOf(g)).map(key=>[key,0])),cache);
      let before=performance.now(),begin=before,frames=0;
      const watch=()=>{
        const now=performance.now();gaps.push(now-before);before=now;frames++;
        peak=Math.max(peak,audio!.sample().peak);
        const elapsed=g._times?.().elapsed??Math.max(0,(now-begin)/1000),times=socialTrackTimes(template.id,elapsed,stop),tracks=tracksOf(g),pictures=liveSocialPictures(tracks,times,format==='tv'?undefined:cache);
        for(const key of Object.keys(times))if(tracks[key]?.clips.length){expected[key]=(expected[key]||0)+1;if(!pictures[key])missing[key]=(missing[key]||0)+1;}
        raf=requestAnimationFrame(watch);
      };
      const started=performance.now(),play=g.playAction();raf=requestAnimationFrame(watch);
      await new Promise<void>((resolve,reject)=>{const cancelWait=()=>{clearTimeout(timer);reject(new DOMException('Annulé','AbortError'));};const timer=setTimeout(()=>{signal.removeEventListener('abort',cancelWait);resolve();},(stop+TIMINGS[template.id].out+.5)*1000);signal.addEventListener('abort',cancelWait,{once:true});});await play;
      cancelAnimationFrame(raf);gaps.sort((a,b)=>a-b);
      const record={id:template.id,format,loadMs:Math.round(loadMs),audioPrepareMs,elapsedMs:Math.round(performance.now()-started),frames,audioPeak:peak,audioContext:audio.sample().state,rafP95Ms:Math.round(gaps[Math.floor(gaps.length*.95)]||0),gapsOver80ms:gaps.filter(n=>n>80).length,missing,expected};records.push(record);status(JSON.stringify(record));
      await save('performance-'+template.id.toLowerCase().replaceAll('_','-')+'-'+format+'-'+Date.now()+'.json',JSON.stringify(record,null,2));
    }finally{cancelAnimationFrame(raf);abort.abort();await g.dispose();audio?.dispose();host.remove();signal.removeEventListener('abort',cancel);}
  }
  assertCompositionCoverage(records);await save('performance-'+Date.now()+'.json',JSON.stringify(records,null,2));return records;
}
