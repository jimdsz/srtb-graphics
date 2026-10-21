import {broadcastTemplates,templateDefaults} from '../src/studio/domain';
import {prepareSocialAssets,SocialRenderer} from '../src/studio/social-renderer';
import {makeTimeline} from '../src/studio/video/timeline';
import {BRAND_POSITION} from '../src/studio/element-selection';
import {SOCIAL_BRAND_ASSET,socialBrandGeometry} from '../src/studio/social-brand';

const status=document.querySelector('#status')!,output=document.querySelector('#result')!,gallery=document.querySelector('#gallery')!;
const check=(value:unknown,message:string)=>{if(!value)throw Error(message);};
const close=(a:number,b:number)=>Math.abs(a-b)<1e-6;
document.querySelector<HTMLButtonElement>('#run')!.onclick=async()=>{
 const records:unknown[]=[];
 try{
  for(const format of ['portrait','vertical'])for(const template of broadcastTemplates){
   status.textContent=template.id+' '+format;
   const data={...templateDefaults(template),_studio_format:format,_out_mode:'manual',_inedit_visible:true};
   const assets=await prepareSocialAssets(template,data,new AbortController().signal);
   check(assets.logo?.naturalWidth===3050&&assets.logo.naturalHeight===688,'Incorrect source logo');
   check(new URL(assets.logo!.src).pathname===SOCIAL_BRAND_ASSET,'Wrong asset URL');
   const renderer=new SocialRenderer(template,data,assets),timeline=makeTimeline(template.id,data,{},25);
   const samples=[0,.8,8,timeline.outAt,timeline.outAt+.24];
   try{
    for(const seconds of samples){
     renderer.frame(seconds,timeline,{},'#293e48',true);
     const hit=renderer.elementBoxes.find(b=>b.field===BRAND_POSITION);
     check(hit,'Logo absent '+template.id+' '+seconds);
     const expected=socialBrandGeometry(data,1080,renderer.height);
     check(close(hit!.x*1080,expected.x)&&close(hit!.width*1080,expected.w),'Unexpected anchor or width');
     check(close(hit!.width*1080/(hit!.height*renderer.height),3050/688),'Stretched logo');
     // Verify actual white pixels, not just geometry, in the logo's hit rectangle.
     const pixels=renderer.canvas.getContext('2d')!.getImageData(Math.floor(hit!.x*1080),Math.floor(hit!.y*renderer.height),Math.floor(hit!.width*1080),Math.floor(hit!.height*renderer.height)).data;
     // Compare against an identical frame without the mark. During OUT the white
     // logo is blended with the coloured background, so it is not neutral white.
     const logo=assets.logo;assets.logo=undefined;renderer.frame(seconds,timeline,{},'#293e48',true);
     const without=renderer.canvas.getContext('2d')!.getImageData(Math.floor(hit!.x*1080),Math.floor(hit!.y*renderer.height),Math.floor(hit!.width*1080),Math.floor(hit!.height*renderer.height)).data;
     assets.logo=logo;renderer.frame(seconds,timeline,{},'#293e48',true);
     let changed=0;for(let i=0;i<pixels.length;i+=4){const delta=[pixels[i]-without[i],pixels[i+1]-without[i+1],pixels[i+2]-without[i+2]];if(Math.max(...delta)>20&&Math.min(...delta)>=-2)changed++;}
     check(changed>200,'Logo pixels absent '+template.id+' '+format+' '+seconds+' count='+changed);
     const original=structuredClone(hit!);renderer.setPreviewEdge(640);renderer.frame(seconds,timeline,{},'#293e48',true);
     const small=renderer.elementBoxes.find(b=>b.field===BRAND_POSITION)!;
     check(['x','y','width','height'].every(k=>close(small[k as keyof typeof small] as number,original[k as keyof typeof original] as number)),'Preview/export geometry mismatch');
     renderer.setPreviewEdge(Infinity);
    }
    renderer.frame(8,timeline,{},'#293e48',true);
    const figure=document.createElement('figure'),canvas=document.createElement('canvas'),caption=document.createElement('figcaption');
    canvas.width=324;canvas.height=Math.round(324*renderer.height/1080);canvas.getContext('2d')!.drawImage(renderer.canvas,0,0,canvas.width,canvas.height);
    caption.textContent=template.name+' · '+format;figure.append(canvas,caption);gallery.append(figure);
    renderer.frame(timeline.duration,timeline,{},null,true);check(!renderer.elementBoxes.some(b=>b.field===BRAND_POSITION),'Logo remains after OUT');
    records.push({template:template.id,format,samples,asset:SOCIAL_BRAND_ASSET,anchor:data._studio_logo_anchor,status:'PASS'});
   }finally{renderer.dispose();}
  }
  status.textContent='PASS';output.textContent=JSON.stringify({status:'PASS',records},null,2);
 }catch(error){status.textContent='ÉCHEC';output.textContent=JSON.stringify({status:'FAIL',error:String(error),records},null,2);}
};
