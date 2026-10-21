import {getTemplate,templateDefaults} from '../src/studio/domain';
import {engineData,simpleBaDefaults} from '../src/studio/presentation';
import {studioEngineModule} from '../src/studio/text-editing';
import {prepareGraphic,type LegacyGraphic} from '../src/studio/video/engine';
import {FrameRaster} from '../src/studio/video/raster';
import {sampleProof} from '../src/studio/video/frame-proof';
import {installGraphicCompatibility} from '../src/studio/graphic-compatibility';
import {installBALoader} from '../src/studio/preview-resources';
import {inspectPreview} from '../src/studio/preview-timeline';
import {exportBroadcastVideo} from '../src/studio/video/export';
import {installTypography} from '../src/studio/typography-engine';

export async function textEditorContracts(save:(name:string,body:Blob|string)=>Promise<void>,status:(message:string)=>void,signal:AbortSignal){
  const template=getTemplate('BTV_BA_1P'),base={...simpleBaDefaults(templateDefaults(template)),_out_mode:'duration',_out_duration_seconds:10,_audio_bed_enabled:false,_audio_voice_enabled:false};
  const cases=[{label:'source',patch:{}},{label:'long',patch:{_thematique:'INTERVIEWS',_titre_ligne_1:'INTERVIEW',_titre_ligne_2:'Olympe B.Quenum'}},{label:'placed',patch:{_thematique:'INTERVIEWS',_titre_ligne_1:'INTERVIEW',_titre_ligne_2:'Olympe B.Quenum',_studio_ba_pack_scale:65,_studio_ba_pack_x:-80,_studio_ba_pack_y:-20,_studio_ba_body_scale:80,_studio_ba_body_x:-90}},{label:'three',patch:{_titre_ligne_1:'INTERVIEW',_titre_ligne_2:'Olympe',_titre_ligne_3:'B.Quenum',_studio_ba_pack_scale:75,_studio_ba_pack_y:-40}}];
  const module=await import(/* @vite-ignore */studioEngineModule(template)),tag='text-recipe-ba';
  if(!customElements.get(tag))customElements.define(tag,class extends module.default{});
  const records=[],stamp=Date.now();
  for(const test of cases){
    status('Texte BA · '+test.label);const data={...base,...test.patch};
    const g=document.createElement(tag) as LegacyGraphic,host=document.createElement('div');host.style.cssText='position:fixed;left:-20000px;width:1920px;height:1080px';g.style.cssText='display:block;position:relative;width:1920px;height:1080px';host.append(g);document.body.append(host);
    let rendered:Awaited<ReturnType<typeof prepareGraphic>>|undefined,raster:FrameRaster|undefined;
    try{
      installGraphicCompatibility(g,{...template,module:new URL(template.module,location.href).href});installBALoader(g,template,()=>{});
      installTypography(g,template,data);
      await g.load({renderType:'realtime',previewMuted:true,data:engineData(data,true)});
      const warnings=g.state.renderedTemplate.__studioTextWarnings;
      if(test.label==='long'&&!warnings?.length)throw Error('Largeur excessive non signalée.');
      if(test.label==='placed'&&warnings?.length)throw Error('Avertissement resté après correction de la taille.');
      rendered=await prepareGraphic(template,data,10,false,signal);
      raster=new FrameRaster(g.shadowRoot!,new URL(template.module,location.href).href,signal);await raster.prepare();
      const samples=[];
      for(const seconds of [3,8,11.6,14,17.8]){
        await inspectPreview(g,template,data,seconds);
        const a=sampleProof(await raster.draw(null),Math.round(seconds*25)),frame=await rendered.frame(Math.round(seconds*25),null),b=sampleProof(frame,Math.round(seconds*25));
        let alpha=0,rgb=0;for(let i=0;i<a.alpha.length;i++){alpha+=Math.abs(a.alpha[i]-b.alpha[i]);for(let c=0;c<3;c++)rgb+=Math.abs(a.rgb[i*4+c]-b.rgb[i*4+c]);}
        const error={rgb:rgb/(a.alpha.length*3),alpha:alpha/a.alpha.length};samples.push({seconds,...error});
        if(error.rgb>12||error.alpha>1)throw Error('Aperçu/export divergent '+test.label+' '+JSON.stringify(samples));
        if(seconds===14)await save('text-'+test.label+'-'+stamp+'.png',await new Promise<Blob>(resolve=>frame.toBlob(blob=>resolve(blob!))));
      }
      records.push({case:test.label,warnings,samples});
    }finally{raster?.dispose();await rendered?.dispose();await g.dispose();host.remove();}
  }
  for(const format of ['mp4','mov'] as const){
    const data={...base,...cases[2].patch};let result;
    try{result=await exportBroadcastVideo(template,data,{format,manualOut:10,removeBackground:format==='mov',audio:false,background:'#000000'},signal,p=>status('Texte BA · '+format+' · '+p.message));
      await save('text-placed-'+stamp+'.'+format,result.blob);records.push({format,report:result.report});
    }finally{await result?.dispose();}
  }
  await save('text-editor-'+stamp+'.json',JSON.stringify(records,null,2));return records;
}
