import test from 'node:test';
import assert from 'node:assert/strict';
import {SocialRenderer} from '../src/studio/social-renderer';
import {getTemplate,templateDefaults} from '../src/studio/domain';
import type {ProjectData} from '../src/studio/domain';
import {makeTimeline} from '../src/studio/video/timeline';
import {SOCIAL_BRAND_ASSET,socialBrandGeometry} from '../src/studio/social-brand';
import {BRAND_POSITION} from '../src/studio/element-selection';

const templates=['BTV_BA_1P','BTV_BA_TDS','BTV_BA_TDS_SUIVI_DE','BTV_PopUp','BTV_Ce_Soir','BTV_Relais_Antenne','BTV_Passerelle_Replay','BTV_Renvoi','BTV_Evenement','BTV_Semainier'];
const close=(actual:number,expected:number)=>assert.ok(Math.abs(actual-expected)<1e-6,`${actual} ≠ ${expected}`);
class BrandImage {naturalWidth=3050;naturalHeight=688;src=SOCIAL_BRAND_ASSET;removeAttribute(){} }

// The adapter records the actual painter's transforms and image calls. Browser
// qualification separately verifies the supplied PNG pixels and font rendering.
function context(){
  let m=[1,0,0,1,0,0];const stack:any[]=[];
  const c:any={font:'10px sans-serif',globalAlpha:1,globalCompositeOperation:'source-over',letterSpacing:'0px',images:[] as any[],masks:[] as number[],texts:[] as any[],
    save(){stack.push({m:[...m],font:c.font,globalAlpha:c.globalAlpha,globalCompositeOperation:c.globalCompositeOperation,letterSpacing:c.letterSpacing});},
    restore(){const s=stack.pop();m=s.m;Object.assign(c,{font:s.font,globalAlpha:s.globalAlpha,globalCompositeOperation:s.globalCompositeOperation,letterSpacing:s.letterSpacing});},
    setTransform(a:number,b:number,d:number,e:number,x:number,y:number){m=[a,b,d,e,x,y];},
    translate(x:number,y:number){m[4]+=m[0]*x+m[2]*y;m[5]+=m[1]*x+m[3]*y;},
    scale(x:number,y:number){m[0]*=x;m[1]*=x;m[2]*=y;m[3]*=y;},
    getTransform(){const [a,b,d,e,x,y]=m;return {a,b,c:d,d:e,transformPoint:(p:{x:number;y:number})=>({x:a*p.x+d*p.y+x,y:b*p.x+e*p.y+y})};},
    clearRect(){c.images=[];c.masks=[];c.texts=[];},fillRect(){if(c.globalCompositeOperation==='destination-in')c.masks.push(c.globalAlpha);},fillText(text:string){c.texts.push({text,alpha:c.globalAlpha});},beginPath(){},rect(){},clip(){},
    measureText(text:string){const s=Number(c.font.match(/([\d.]+)px/)?.[1]||10),width=[...text].reduce((n,ch)=>n+(/[MW]/.test(ch)?.9:ch===' '?.28:.54),0)*s;return {width,actualBoundingBoxLeft:0,actualBoundingBoxRight:width};},
    drawImage(image:unknown,x:number,y:number,w:number,h:number){c.images.push({image,x:m[0]*x+m[4],y:m[3]*y+m[5],w:w*m[0],h:h*m[3],alpha:c.globalAlpha});},
  };return c;
}
function withRenderer(id:string,format:string,check:(renderer:SocialRenderer,c:any,timeline:ReturnType<typeof makeTimeline>,logo:BrandImage)=>void,patch:ProjectData={}){
  const globals=['document','HTMLImageElement','HTMLVideoElement'],previous=globals.map(key=>Object.getOwnPropertyDescriptor(globalThis,key)),c=context(),logo=new BrandImage();
  Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>{const canvas={width:0,height:0,getContext:()=>c};c.canvas=canvas;return canvas;}}});
  Object.defineProperty(globalThis,'HTMLImageElement',{configurable:true,value:BrandImage});
  Object.defineProperty(globalThis,'HTMLVideoElement',{configurable:true,value:class {}});
  const template=getTemplate(id),data={...templateDefaults(template),_studio_format:format,_studio_logo_anchor:'top-right',_out_mode:'manual',...patch};
  const renderer=new SocialRenderer(template,data,{logo:logo as unknown as HTMLImageElement,overlayLogo:patch._studio_overlay_logo_enabled?logo as unknown as HTMLImageElement:undefined}),timeline=makeTimeline(id,data,{},25);
  try{check(renderer,c,timeline,logo);}finally{renderer.dispose();globals.forEach((key,index)=>{if(previous[index])Object.defineProperty(globalThis,key,previous[index]!);else Reflect.deleteProperty(globalThis,key);});}
}

test('all ten social templates paint the supplied logo once through intro, body, transition and OUT, then clear it',()=>{
  for(const id of templates)for(const format of ['portrait','vertical'])withRenderer(id,format,(r,c,timeline,logo)=>{
    for(const seconds of [0,.12,0.8,8,14.6,...(id==='BTV_BA_1P'?[timeline.outAt-.04]:[timeline.outAt,timeline.outAt+.24])]){
      r.frame(seconds,timeline,{},null,true);
      assert.equal(c.images.length,1,`${id}/${format}/${seconds}`);assert.equal(c.images[0].image,logo);
      const painted=c.images[0],expected=socialBrandGeometry(r.data,r.width,r.height);
      close(painted.w/painted.h,3050/688);close(painted.x,expected.x);close(painted.y,expected.y);assert.equal(painted.alpha,1);
      assert.ok(c.texts.length,`${id}/${format}/${seconds}: readable programme from the first frame`);assert.ok(c.texts.every((text:any)=>text.alpha===1));
      const hit=r.elementBoxes.filter(box=>box.field===BRAND_POSITION);assert.equal(hit.length,1);
      close(hit[0].x,painted.x/r.canvas.width);close(hit[0].y,painted.y/r.canvas.height);close(hit[0].width,painted.w/r.canvas.width);close(hit[0].height,painted.h/r.canvas.height);
    }
    r.frame(timeline.duration-.04,timeline,{},null,true);
    if(id==='BTV_BA_1P'){
      assert.equal(c.masks.length,0,'direct BA has no final fade');assert.ok(r.elementBoxes.some(box=>box.field===BRAND_POSITION));
    }else{
      assert.equal(c.masks.length,1);assert.ok(c.masks[0]<.05,`${id}/${format} fades the complete composition once`);assert.ok(!r.elementBoxes.some(box=>box.field===BRAND_POSITION));
    }
    r.frame(timeline.duration,timeline,{},null,true);assert.equal(c.images.length,0);assert.equal(r.elementBoxes.length,0);
  });
});

test('Ce soir retains every programme and time during IN and OUT in both social formats',()=>{
  for(const format of ['portrait','vertical'])withRenderer('BTV_Ce_Soir',format,(r,c,timeline)=>{
    for(const seconds of [0,.04,timeline.outAt,timeline.outAt+.2]){
      r.frame(seconds,timeline,{},null,true);
      for(const n of [1,2,3])for(const field of [`_time_${n}`,`_title_${n}`])assert.ok(r.textBoxes.some(box=>box.field===field),`${format}/${seconds}/${field}`);
    }
  });
});

test('direct BA supplementary logo stays fixed from first to final frame, without mutating TV animation settings',()=>{
  for(const format of ['portrait','vertical'])for(const motion of ['none','slide','fade'])withRenderer('BTV_BA_1P',format,(r,c,timeline)=>{
    let first:unknown;
    for(const seconds of [0,.04,1,timeline.duration-.08,timeline.duration-.04]){
      r.frame(seconds,timeline,{},null,true);assert.equal(c.images.length,2);assert.equal(c.images[1].alpha,1);assert.equal(c.masks.length,0);
      const measured=c.images[1];if(!first)first=measured;else assert.deepEqual(measured,first);
    }
    assert.equal(r.data._studio_overlay_logo_motion,motion);assert.equal(r.data._studio_overlay_logo_delay,2);
  },{_studio_overlay_logo_enabled:true,_studio_overlay_logo_motion:motion,_studio_overlay_logo_delay:2});
});

test('an early weekly OUT holds its announced programme across the next native slot boundary',()=>{
  for(const format of ['portrait','vertical'])withRenderer('BTV_Semainier',format,(r,_c,timeline)=>{
    const early={...timeline,outAt:7.76,duration:7.76+timeline.timing.out};
    for(const seconds of [7.76,7.8,8.2,9]){
      r.frame(seconds,early,{},null,true);
      assert.ok(r.textBoxes.some(box=>box.field==='programme_2_title'));
      assert.ok(!r.textBoxes.some(box=>box.field==='programme_3_title'));
    }
  });
});

test('explicit anchors and hit boxes survive card transformations and bounded preview resizing in every social template',()=>{
  for(const id of templates)for(const format of ['portrait','vertical'])withRenderer(id,format,(r,c,timeline)=>{
    for(const anchor of ['top-left','top-center','bottom-left','bottom-right'])for(const seconds of [.8,8]){
      r.data={...r.data,_studio_logo_anchor:anchor};r.setPreviewEdge(Infinity);r.frame(seconds,timeline,{},null,true);
      const hit=structuredClone(r.elementBoxes.find(box=>box.field===BRAND_POSITION)!);assert.ok(hit);
      r.data={...r.data,_studio_block_anchor:'center',_studio_block_scale:70,_studio_block_x:15,_studio_block_y:-10,[`_studio_${format}_card_scale`]:65};
      r.setPreviewEdge(640);r.frame(seconds,timeline,{},null,true);
      const resized=r.elementBoxes.find(box=>box.field===BRAND_POSITION)!;assert.ok(resized);
      for(const key of ['x','y','width','height'] as const)close(resized[key],hit[key]);
      const painted=c.images[0];close(resized.x,painted.x/r.canvas.width);close(resized.y,painted.y/r.canvas.height);
    }
  });
});
