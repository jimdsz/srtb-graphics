import test from 'node:test';
import assert from 'node:assert/strict';
import {SocialRenderer} from '../src/studio/social-renderer';
import {getTemplate,templateDefaults} from '../src/studio/domain';
import type {BroadcastTemplate,ProjectData} from '../src/studio/domain';
import {makeTimeline} from '../src/studio/video/timeline';
import {patchTextStyle} from '../src/studio/typography-model';
import {preservePortraitLayout,PORTRAIT_LAYOUT} from '../src/studio/social-portrait-layout';

// Canvas geometry adapter only: real BTV glyph pixels and preview/export parity
// are exercised separately by social-portrait-qualification.html in the browser.
function context(){
  let m=[1,0,0,1,0,0],stack:any[]=[];
  const c:any={font:'10px sans-serif',globalAlpha:1,letterSpacing:'0px',texts:[] as any[],rects:[] as any[],
    save(){stack.push({m:[...m],font:c.font,globalAlpha:c.globalAlpha,letterSpacing:c.letterSpacing});},restore(){const s=stack.pop();m=s.m;Object.assign(c,{font:s.font,globalAlpha:s.globalAlpha,letterSpacing:s.letterSpacing});},
    setTransform(a:number,b:number,d:number,e:number,x:number,y:number){m=[a,b,d,e,x,y];},
    translate(x:number,y:number){m[4]+=m[0]*x+m[2]*y;m[5]+=m[1]*x+m[3]*y;},
    scale(x:number,y:number){m[0]*=x;m[1]*=x;m[2]*=y;m[3]*=y;},
    rotate(angle:number){const [a,b,d,e]=m,co=Math.cos(angle),si=Math.sin(angle);m[0]=a*co+d*si;m[1]=b*co+e*si;m[2]=d*co-a*si;m[3]=e*co-b*si;},
    getTransform(){const [a,b,d,e,x,y]=m;return {a,b,c:d,d:e,transformPoint:(p:{x:number;y:number})=>({x:a*p.x+d*p.y+x,y:b*p.x+e*p.y+y})};},
    clearRect(){c.texts=[];c.rects=[];},
    fillRect(x:number,y:number,w:number,h:number){c.rects.push({x,y,w,h,m:[...m],alpha:c.globalAlpha});},
    measureText(text:string){const s=Number(c.font.match(/([\d.]+)px/)?.[1]||10),width=[...text].reduce((n,ch)=>n+(/[MW]/.test(ch)?.9:ch===' '?.28:.54),0)*s+Math.max(0,text.length-1)*parseFloat(c.letterSpacing);return {width,actualBoundingBoxLeft:0,actualBoundingBoxRight:width};},
    fillText(text:string,x:number,y:number){c.texts.push({text,x,y,font:c.font,m:[...m],alpha:c.globalAlpha});},
  };return c;
}
const template=getTemplate('BTV_BA_1P');
function data(patch:ProjectData={}):ProjectData{return {...templateDefaults(template),_studio_format:'portrait',_studio_ba_mode:'simple',_titre_ligne_1:'LE GRAND',_titre_ligne_2:'ENTRETIEN',_titre_ligne_3:'',_thematique:'MAGAZINE',_jour_1:'Aujourd’hui',_heure_1:'20h30',_sous_titre_visible:false,_credit_visible:false,_sponsor_visible:false,_sponsor_label_visible:false,_mentions_visible:false,...patch};}
function withRenderer(project:ProjectData,check:(r:SocialRenderer,c:ReturnType<typeof context>,frame:()=>void)=>void,target:BroadcastTemplate=template){
  const old=Object.getOwnPropertyDescriptor(globalThis,'document'),c=context();
  Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>({width:0,height:0,getContext:()=>c})}});
  const r=new SocialRenderer(target,project,{}),timeline=makeTimeline(target.id,project,{},12);
  try{check(r,c,()=>{r.frame(Math.min(8,timeline.outAt-.04),timeline,{},null,true);});}finally{r.dispose();if(old)Object.defineProperty(globalThis,'document',old);else Reflect.deleteProperty(globalThis,'document');}
}

test('social carton resize updates actual text hit boxes on every template, with identical normalized preview/export geometry',()=>{
  for(const id of ['BTV_BA_1P','BTV_BA_TDS','BTV_BA_TDS_SUIVI_DE','BTV_PopUp','BTV_Ce_Soir','BTV_Relais_Antenne','BTV_Passerelle_Replay','BTV_Renvoi','BTV_Evenement','BTV_Semainier'])for(const format of ['portrait','vertical']){
    const t=getTemplate(id),project={...templateDefaults(t),_studio_format:format};
    withRenderer(project,(r,c,frame)=>{
      frame();const initial=structuredClone(r.textBoxes);assert.ok(initial.length);
      r.data={...project,[`_studio_${format}_card_scale`]:65};frame();const small=structuredClone(r.textBoxes);
      // Titles inside the resized blocks shrink, while the separate brand stays independent.
      assert.ok(small.some(box=>initial.some(old=>old.field===box.field&&box.width<old.width*.7)),`${id}/${format}`);
      r.setPreviewEdge(640);frame();for(let i=0;i<small.length;i++)for(const key of ['x','y','width','height'] as const)assert.ok(Math.abs(r.textBoxes[i][key]-small[i][key])<1e-6,`${id}/${format}/${key}`);
      assert.equal(r.warnings.length,0,`${id}/${format} default text should remain valid`);
    },t);
  }
});

test('compact event, reminder and weekly cards reclaim empty space without reducing native text size',()=>{
  for(const id of ['BTV_Renvoi','BTV_Evenement','BTV_Semainier'])for(const format of ['portrait','vertical']){
    const t=getTemplate(id),project={...templateDefaults(t),_studio_format:format};
    withRenderer(project,(r,c,frame)=>{
      frame();const compact=structuredClone(c.rects),texts=structuredClone(c.texts);
      r.data={...project,[`_studio_${format}_card_compact`]:false};frame();
      assert.ok(compact[0].h<c.rects[0].h,`${id}/${format}`);
      assert.deepEqual(texts.map((entry:any)=>entry.text),c.texts.map((entry:any)=>entry.text));
      assert.deepEqual(texts.map((entry:any)=>entry.font),c.texts.map((entry:any)=>entry.font));
    },t);
  }
});
test('actual compact painter keeps standard panel under 40% and preserves exact displacement on first drag',()=>{
  const initial=data();withRenderer(initial,(r,c,frame)=>{
    frame();assert.ok(c.rects[0].h<540);const before=structuredClone(r.textBoxes),first=before.find(b=>b.field==='_titre_ligne_1')!;
    r.data=preservePortraitLayout(template.id,initial,{...initial,...patchTextStyle(initial,'_titre_ligne_1',{x:17,y:9})});frame();const after=r.textBoxes.find(b=>b.field==='_titre_ligne_1')!;
    assert.ok(Math.abs((after.x-first.x)*1080-17)<1e-7);assert.ok(Math.abs((after.y-first.y)*1350-9)<1e-7);
    assert.deepEqual(r.textBoxes.filter(b=>b.field!=='_titre_ligne_1'),before.filter(b=>b.field!=='_titre_ligne_1'));assert.equal(r.data[PORTRAIT_LAYOUT],'compact');
  });
});
test('styled glyph heights and interline flow are measured by the painter before the next title and appointment',()=>{
  withRenderer(data({[PORTRAIT_LAYOUT]:'compact',_studio_typography:JSON.stringify({'portrait:_titre_ligne_1':{font:'suisse',size:150,lineHeight:1.6,tracking:1.2},'portrait:_titre_ligne_2':{size:115,lineHeight:1.3}})}),(r,c,frame)=>{
    frame();assert.equal(r.warnings.length,0);assert.ok(c.rects[0].h<=783);
    const first=r.textBoxes.find(b=>b.field==='_titre_ligne_1')!,second=r.textBoxes.find(b=>b.field==='_titre_ligne_2')!,day=r.textBoxes.find(b=>b.field==='_jour_1')!;
    assert.ok(first.y+first.height<=second.y);assert.ok(second.y+second.height<day.y);
    assert.ok(r.textBoxes.every(b=>b.x>=0&&b.y>=0&&b.x+b.width<=1&&b.y+b.height<=1));
  });
});
test('oversized manual typography remains editable with an explicit historic fallback, not an empty frame',()=>{
  const project=data({[PORTRAIT_LAYOUT]:'compact',_titre_ligne_1:'W'.repeat(18),_studio_typography:JSON.stringify({'portrait:_titre_ligne_1':{size:400}})}),saved=JSON.stringify(project);
  withRenderer(project,(r,c,frame)=>{assert.doesNotThrow(frame);assert.ok(c.texts.length);assert.ok(r.warnings.some(w=>w.includes('géométrie historique')));assert.equal(JSON.stringify(project),saved);assert.deepEqual(r.data,{...project,_jour_1:'AUJOURD’HUI',_heure_1:'20H30'});assert.equal(c.rects[0].h,850);});
});
test('unbroken plain text never blocks the 4:5 preview; all characters and stored values remain, with a legibility warning',()=>{
  const long='W'.repeat(160),project=data({_titre_ligne_1:long}),saved=JSON.stringify(project);
  withRenderer(project,(r,c,frame)=>{assert.doesNotThrow(frame);assert.ok(c.texts.some((t:any)=>t.text===long));assert.ok(r.warnings.some(w=>w.includes('affiché en petit')));assert.equal(JSON.stringify(project),saved);assert.deepEqual(r.data,{...project,_jour_1:'AUJOURD’HUI',_heure_1:'20H30'});const box=r.textBoxes.find(b=>b.field==='_titre_ligne_1')!;assert.ok(box.x+box.width<=1);});
});
test('more than three explicitly entered title lines stay visible and editable without changing the saved text',()=>{
  const project=data({_titre_ligne_1:'A\nB\nC\nD',_titre_ligne_2:''}),saved=JSON.stringify(project);
  withRenderer(project,(r,c,frame)=>{assert.doesNotThrow(frame);for(const line of ['A','B','C','D'])assert.ok(c.texts.some((t:any)=>t.text===line));assert.equal(JSON.stringify(project),saved);assert.deepEqual(r.data,{...project,_jour_1:'AUJOURD’HUI',_heure_1:'20H30'});assert.ok(r.warnings.some(w=>w.includes('4 lignes')));assert.ok(!r.warnings.some(w=>w.includes('géométrie historique')));assert.ok(c.rects[0].h<=783);});
});

test('long editorial text never blocks any social template in 4:5 or 9:16 and warnings clear after correction',()=>{
  const cases=[['BTV_BA_1P','_titre_ligne_1'],['BTV_BA_TDS','_titre_ligne_1'],['BTV_BA_TDS_SUIVI_DE','_p1_titre_ligne_1'],['BTV_PopUp','_title'],['BTV_Ce_Soir','_title_1'],['BTV_Relais_Antenne','_current_title'],['BTV_Passerelle_Replay','_title'],['BTV_Renvoi','title'],['BTV_Evenement','title_1'],['BTV_Semainier','programme_3_title']];
  for(const [id,field]of cases)for(const format of ['portrait','vertical'])for(const text of ['ALPHA\nBÊTA\nGAMMA\nDELTA','W'.repeat(160)]){
    const target=getTemplate(id),project={...templateDefaults(target),_studio_format:format,[field]:text},saved=JSON.stringify(project),name=`${id} ${format}`;
    withRenderer(project,(r,c,frame)=>{
      assert.doesNotThrow(frame,name);for(const line of text.split('\n'))assert.ok(c.texts.some((t:any)=>t.text===line),`${name}: missing ${line}`);
      assert.equal(JSON.stringify(project),saved,name);if(text.startsWith('W'))assert.ok(r.warnings.length,name);
      const boxes=r.textBoxes.filter(box=>box.field===field);assert.ok(boxes.length,name);
      for(const box of boxes)assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=1+1e-8&&box.y+box.height<=1+1e-8,`${name}: ${JSON.stringify(box)}`);
      r.data={...project,[field]:'TITRE'};frame();assert.ok(!r.warnings.some(w=>w.includes(text.slice(0,45))),name);
    },target);
  }
});

test('visual fitting preserves manual screen displacement and does not leak its scale to other text',()=>{
  for(const format of ['portrait','vertical']){
    const project=data({_studio_format:format,[PORTRAIT_LAYOUT]:'legacy',_titre_ligne_1:'W'.repeat(160),_titre_ligne_2:''});
    withRenderer(project,(r,_c,frame)=>{
      frame();const first=r.textBoxes.find(box=>box.field==='_titre_ligne_1')!,others=structuredClone(r.textBoxes.filter(box=>box.field!=='_titre_ligne_1'));
      r.data={...project,...patchTextStyle(project,'_titre_ligne_1',{x:15,y:-5})};frame();const moved=r.textBoxes.find(box=>box.field==='_titre_ligne_1')!;
      assert.ok(Math.abs((moved.x-first.x)*r.canvas.width-15)<1e-7);assert.ok(Math.abs((moved.y-first.y)*r.canvas.height+5)<1e-7);
      assert.deepEqual(r.textBoxes.filter(box=>box.field!=='_titre_ligne_1'),others);
    });
  }
});
test('unmarked historical customization produces identical geometry to explicit legacy and is never normalized',()=>{
  const project=data({_studio_block_anchor:'center',_studio_block_scale:85,_studio_typography:JSON.stringify({'portrait:_titre_ligne_1':{x:20,y:-5}})});
  // Historical records predate the explicit new-project compact marker.
  delete project[PORTRAIT_LAYOUT];
  withRenderer(project,(r,c,frame)=>{frame();
    // Independent old-layout coordinates: panel(0,500,1080,850), bounded 85%
    // transform at (81,358.75), native title origin(80,598), screen offset(20,-5).
    const title=r.textBoxes.find(b=>b.field==='_titre_ligne_1')!;assert.equal(c.rects[0].h,850);assert.ok(Math.abs(title.x*1080-169)<1e-7);assert.ok(Math.abs(title.y*1350-437.05)<1e-7);
    const original=structuredClone({texts:c.texts,rects:c.rects,boxes:r.textBoxes});r.data={...project,[PORTRAIT_LAYOUT]:'legacy'};frame();assert.deepEqual({texts:c.texts,rects:c.rects,boxes:r.textBoxes},original);
  });
});
test('9:16 paint operations are independent of the 4:5 marker, including typography and media bounds',()=>{
  const project=data({_studio_format:'vertical',[PORTRAIT_LAYOUT]:'compact'});
  withRenderer(project,(r,c,frame)=>{frame();const compact=structuredClone({texts:c.texts,rects:c.rects,boxes:r.textBoxes});r.data={...project,[PORTRAIT_LAYOUT]:'legacy'};frame();assert.deepEqual({texts:c.texts,rects:c.rects,boxes:r.textBoxes},compact);});
});

test('bounded preview keeps logical geometry, manual placement and hit boxes; default export remains full size',()=>{
 for(const format of ['portrait','vertical'])for(const id of ['BTV_BA_1P','BTV_BA_TDS','BTV_BA_TDS_SUIVI_DE','BTV_PopUp','BTV_Ce_Soir','BTV_Relais_Antenne','BTV_Passerelle_Replay','BTV_Renvoi','BTV_Evenement','BTV_Semainier']){
  const t=getTemplate(id),project={...templateDefaults(t),_studio_format:format};
  withRenderer(project,(r,_c,frame)=>{
   assert.equal(r.canvas.width,1080);assert.equal(r.canvas.height,format==='portrait'?1350:1920);
   frame();const original=structuredClone([...r.textBoxes,...r.elementBoxes]);
   for(const edge of [1280,1152,960,768,640,448,320,960]){r.setPreviewEdge(edge);frame();assert.equal(Math.max(r.canvas.width,r.canvas.height),edge);
    const boxes=[...r.textBoxes,...r.elementBoxes];assert.equal(boxes.length,original.length);
    for(let i=0;i<boxes.length;i++)for(const key of ['x','y','width','height'] as const)assert.ok(Math.abs(boxes[i][key]-original[i][key])<1e-6,`${id}/${format}/${edge}/${key}`);
   }
  },t);
 }
 withRenderer(data(),(r,_c,frame)=>{r.setPreviewEdge(640);frame();const before=r.textBoxes.find(b=>b.field==='_titre_ligne_1')!;r.data=preservePortraitLayout(template.id,r.data,{...r.data,...patchTextStyle(r.data,'_titre_ligne_1',{x:17,y:9})});frame();const after=r.textBoxes.find(b=>b.field==='_titre_ligne_1')!;assert.ok(Math.abs((after.x-before.x)*1080-17)<1e-6);assert.ok(Math.abs((after.y-before.y)*1350-9)<1e-6);});
});
