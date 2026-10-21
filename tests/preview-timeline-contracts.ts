import {broadcastTemplates} from '../src/studio/domain';
import type {ProjectData} from '../src/studio/domain';
import {prepareGraphic,type LegacyGraphic} from '../src/studio/video/engine';
import {FrameRaster} from '../src/studio/video/raster';
import {sampleProof} from '../src/studio/video/frame-proof';
import {inspectPreview,previewTimeline} from '../src/studio/preview-timeline';
import {installGraphicCompatibility} from '../src/studio/graphic-compatibility';
import {installPreviewBackgrounds} from '../src/studio/preview-backgrounds';
import {installBALoader} from '../src/studio/preview-resources';
import {installBAMediaReadiness} from '../src/studio/media-readiness';
import {engineData} from '../src/studio/presentation';
export async function timelineContracts(dataFor:(id:string,format:string)=>ProjectData,save:(name:string,body:Blob|string)=>Promise<void>,status:(message:string)=>void,signal:AbortSignal){
  const records=[];
  for(const template of broadcastTemplates){
    status('Réglette TV : '+template.name);signal.throwIfAborted();
    const data={...dataFor(template.id,'tv'),_out_mode:'duration',_out_duration_seconds:28},module=await import(/* @vite-ignore */template.module),tag='time-'+template.id.toLowerCase().replaceAll('_','-');
    if(!customElements.get(tag))customElements.define(tag,class extends module.default{});
    const g=document.createElement(tag) as LegacyGraphic,host=document.createElement('div');host.style.cssText='position:fixed;left:-20000px;width:1920px;height:1080px';g.style.cssText='display:block;position:relative;width:1920px;height:1080px';host.append(g);document.body.append(host);
    let prepared:Awaited<ReturnType<typeof prepareGraphic>>|undefined,raster:FrameRaster|undefined;
    try{
      installGraphicCompatibility(g,{...template,module:new URL(template.module,location.href).href});installBALoader(g,template,()=>{});installPreviewBackgrounds(g,template,()=>{});await installBAMediaReadiness(template);
      const loaded=await g.load({renderType:'realtime',previewMuted:true,data:engineData(data)});if(loaded?.statusCode>=400)throw Error(loaded.statusMessage);
      const tl=previewTimeline(g,template,data);prepared=await prepareGraphic(template,data,28,false,signal);
      raster=new FrameRaster(g.shadowRoot!,new URL(template.module,location.href).href,signal);await raster.prepare();
      const samples=[];
      for(const seconds of [3,20,28.4,tl.duration-.08]){
        await inspectPreview(g,template,data,seconds);const a=sampleProof(await raster.draw(null),Math.round(seconds*25)),b=sampleProof(await prepared.frame(Math.round(seconds*25),null),Math.round(seconds*25));
        let alpha=0,rgb=0;for(let i=0;i<a.alpha.length;i++){alpha+=Math.abs(a.alpha[i]-b.alpha[i]);for(let c=0;c<3;c++)rgb+=Math.abs(a.rgb[i*4+c]-b.rgb[i*4+c]);}
        const error={rgb:rgb/(a.alpha.length*3),alpha:alpha/a.alpha.length};samples.push({seconds,...error});
        if(error.rgb>12||error.alpha>1)throw Error(template.id+' réglette différente de l’export '+JSON.stringify(samples));
      }
      records.push({id:template.id,duration:tl.duration,samples});
    }finally{raster?.dispose();await prepared?.dispose();await g.dispose();host.remove();}
  }
  await save('timeline-'+Date.now()+'.json',JSON.stringify(records,null,2));return records;
}
