import {broadcastTemplates,getTemplate,templateDefaults} from '../src/studio/domain';
import {engineData,simpleBaDefaults} from '../src/studio/presentation';
import {prepareGraphic,type LegacyGraphic} from '../src/studio/video/engine';
import {prepareSocialAssets,SocialRenderer} from '../src/studio/social-renderer';
import {attachSocialPreview} from '../src/studio/social-preview';
import {installGraphicCompatibility} from '../src/studio/graphic-compatibility';
import {installSocialScene} from '../src/studio/social-scene';
import {installBAMediaReadiness} from '../src/studio/media-readiness';
import {sampleProof} from '../src/studio/video/frame-proof';
import {makeTimeline} from '../src/studio/video/timeline';
import type {ProjectData} from '../src/studio/domain';
const assert=(value:unknown,message:string)=>{if(!value)throw Error(message);};
const tick=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
export async function socialContracts(dataFor:(id:string,format:string)=>ProjectData,save:(name:string,body:Blob|string)=>Promise<void>,progress:(message:string)=>void,signal:AbortSignal){
  const results:unknown[]=[],stamp=Date.now();
  const ba=getTemplate('BTV_BA_1P');
  for(const format of ['portrait','vertical']){
    const data={...dataFor(ba.id,format),_studio_ba_mode:'multiple',_jour_1:'Ce soir',_jour_2:'Demain',_jour_3:'Vendredi',_titre_ligne_3:'et nos traditions',_credit_visible:true,_sponsor_visible:true,_sponsor_original:true,_sponsor_label_visible:true,_inedit_visible:true,_mentions_visible:true};
    const assets=await prepareSocialAssets(ba,data,signal),renderer=new SocialRenderer(ba,data,assets);
    try{
      for(const [kind,img]of Object.entries({logo:assets.logo,mentions:assets.mentions,sponsor:assets.sponsors?.main})){
        assert(img,'Missing '+kind);const canvas=document.createElement('canvas');canvas.width=img!.naturalWidth;canvas.height=img!.naturalHeight;
        const ctx=canvas.getContext('2d')!;ctx.drawImage(img!,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;let count=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]>10)count++;
        assert(count>10,'Invisible asset '+kind);results.push({asset:kind,pixels:count});canvas.width=canvas.height=0;
      }
      const canvas=renderer.frame(8,makeTimeline(ba.id,data,{},10),{},null,true);
      for(const {box,text}of renderer.diagnostics)assert(box.x>=0&&box.y>=0&&box.x+box.w<=canvas.width&&box.y+box.h<=canvas.height,'Text overflow '+text);
      await save(`options-${format}-${stamp}.png`,await new Promise<Blob>(resolve=>canvas.toBlob(blob=>resolve(blob!))));
    }finally{renderer.dispose();}
  }
  for(const t of broadcastTemplates)for(const format of ['portrait','vertical']){
    progress('Parité aperçu / export · '+t.id+' · '+format);signal.throwIfAborted();
    const data={...dataFor(t.id,format),_studio_logo_anchor:'top-right',_studio_block_anchor:'center',_studio_block_scale:85,_studio_block_x:100,_studio_block_y:-100},mod=await import(/* @vite-ignore */t.module),tag='contract-'+t.id.toLowerCase().replaceAll('_','-');
    if(!customElements.get(tag))customElements.define(tag,class extends mod.default{});
    const host=document.createElement('div');host.style.cssText='position:fixed;left:-20000px;width:432px;height:768px';document.body.append(host);
    const g=document.createElement(tag) as LegacyGraphic;host.append(g);installSocialScene(g,t);await installBAMediaReadiness(t);let prepared;
    try{
      const loaded=await g.load({renderType:'realtime',previewMuted:true,data:engineData(data)});assert(!(loaded?.statusCode>=400),'Preview load '+t.id+' '+JSON.stringify(loaded));
      await attachSocialPreview(g,t,data,signal);
      const canvas=host.querySelector('canvas')!;assert(canvas,'Preview canvas absent');
      prepared=await prepareGraphic(t,data,12,false,signal);
      const samples=[];
      for(const seconds of t.id==='BTV_BA_1P'?[3,5,10.52,16.6,17.6]:[3]){
        await g.goToTime({seconds});await tick();const frame=Math.round(seconds*25),preview=sampleProof(canvas,frame),reference=sampleProof(await prepared.frame(frame,null),frame);
        let rgb=0,alpha=0;for(let i=0;i<reference.alpha.length;i++){alpha+=Math.abs(preview.alpha[i]-reference.alpha[i]);for(let c=0;c<3;c++)rgb+=Math.abs(preview.rgb[i*4+c]-reference.rgb[i*4+c]);}
        const differences={rgb:rgb/(reference.alpha.length*3),alpha:alpha/reference.alpha.length};
        assert(differences.rgb<12&&differences.alpha<1,'Preview/export mismatch '+t.id+' '+seconds+'s '+JSON.stringify(differences));samples.push({seconds,...differences});
      }
      await g.stopAction({skipAnimation:true});await tick();assert(sampleProof(canvas,0).alpha.every(a=>a===0),'Clear left a visible social image');
      results.push({id:t.id,format,parity:samples,clear:'PASS'});
    }finally{await prepared?.dispose();await g.dispose();host.remove();}
  }
  for(const day of ['Ce soir','Demain','Vendredi']){
    progress('BA simple télévision · '+day);
    const data={...simpleBaDefaults(templateDefaults(ba)),_jour_1:day,_out_mode:'duration',_out_duration_seconds:10};
    const g=await prepareGraphic(ba,data,10,false,signal);
    try{const frame=await g.frame(250,null);await save(`tv-${day.toLowerCase().replaceAll(' ','-')}-${stamp}.png`,await new Promise<Blob>(resolve=>frame.toBlob(blob=>resolve(blob!))));results.push({tv:day,pass:true});}finally{await g.dispose();}
  }
  await save(`contracts-${stamp}.json`,JSON.stringify(results,null,2));return results;
}
