import test from 'node:test';
import assert from 'node:assert/strict';
import {getTemplate,templateDefaults,validateProjectData} from '../src/studio/domain';
import type {ProjectData} from '../src/studio/domain';
import {engineData} from '../src/studio/presentation';
import {fitSocialText} from '../src/studio/social-text-fit';
import {measurePortraitPanel,portraitLayoutMode,preservePortraitLayout,PORTRAIT_LAYOUT} from '../src/studio/social-portrait-layout';
import type {PortraitContent,PortraitMeasure} from '../src/studio/social-portrait-layout';
import {announcementProjects} from '../src/studio/derivation-announcements';
import {patchTextStyle} from '../src/studio/typography-model';
import {inspectorSearchPanels} from '../src/studio/inspector-search';

// Deliberately non-uniform glyph widths: these unit tests exercise word fitting,
// not actual BTV font rasterization (covered by the browser fixture).
const metrics=(text:string,size:number)=>({width:[...text].reduce((n,c)=>n+(c===' '? .28:/[MWŒ]/.test(c)? .9:/[ilI’.,]/.test(c)? .24:.54),0)*size});
const measure:PortraitMeasure=(text,w,h,size,min,_regular,max)=>fitSocialText(text,w,h,size,min,max,metrics);
const content:PortraitContent={theme:'MAGAZINE',title:'LE GRAND\nENTRETIEN',day:'Aujourd’hui · 20h30',sub:'Un rendez-vous au cœur du Bénin',credit:'',label:'',sponsor:false,mentions:false};
const base={_studio_format:'portrait',_studio_typography:'{}'};
test('standard two-line BA uses less than 40% of 4:5 and leaves a larger image than the old 500px window',()=>{
  const panel=measurePortraitPanel(content,1080,1350,measure);
  assert.ok(panel.box.h/1350<.4,JSON.stringify(panel.box));assert.ok(panel.box.y>810);assert.equal(panel.box.y+panel.box.h,1350);
  for(const slot of Object.values(panel.slots)){assert.equal(slot.box.x,80);assert.equal(slot.box.w,920);assert.ok(slot.box.y>=panel.box.y+32);assert.ok(slot.box.y+slot.box.h<=1270);}
});
test('visible content alone controls height: one to three appointments, hidden and logo mode',()=>{
  const single=measurePortraitPanel(content,1080,1350,measure),triple=measurePortraitPanel({...content,day:'Mardi · 20h30\nDemain · 20h30\nDimanche · 20h30'},1080,1350,measure);
  assert.ok(triple.box.h>single.box.h);assert.equal(triple.slots.day!.box.h,Math.ceil(3*43*1.14));
  const hidden=measurePortraitPanel({...content,day:''},1080,1350,measure);assert.ok(!hidden.slots.day);assert.ok(hidden.box.h<single.box.h);
  const logo=measurePortraitPanel({...content,day:'',bottomLogoTop:1070},1080,1350,measure);assert.ok(!logo.slots.day);
  assert.ok(Object.values(logo.slots).every(s=>s.box.y+s.box.h<=1046));
});
test('three title lines and dense options are disjoint, unabridged and bounded at existing type minima',()=>{
  const dense={...content,title:'LE GRAND MAGAZINE\nDES CULTURES VIVANTES\nET DE NOS TRADITIONS',day:'Mardi · 20h30\nDemain · 20h30\nDimanche · 20h30',sub:'Des rencontres, des histoires et des traditions à partager ensemble chaque semaine',credit:'Une émission de la télévision nationale',label:'Avec le soutien de nos partenaires',sponsor:true,mentions:true};
  const panel=measurePortraitPanel(dense,1080,1350,measure);assert.ok(panel.box.h<=1350*.58);assert.ok(panel.slots.title!.size>=38);assert.ok(panel.slots.day!.size>=29);
  const boxes=[...Object.values(panel.slots).map(s=>s.box),panel.logos!].sort((a,b)=>a.y-b.y);
  for(let i=1;i<boxes.length;i++)assert.ok(boxes[i].y>=boxes[i-1].y+boxes[i-1].h+10);
  for(const [key,slot]of Object.entries(panel.slots)){
    const text=dense[key as keyof PortraitContent] as string,fit=measure(text,slot.box.w,slot.box.h,slot.size,slot.min,slot.regular,slot.maxLines);
    assert.equal(fit.lines.join(' ').replace(/\s+/g,' '),text.replace(/\s+/g,' '));
    assert.ok(fit.lines.every(line=>metrics(line,fit.size).width<=slot.box.w));
  }
});
test('long glyphs and bearing overflow shrink or reject explicitly; text never disappears',()=>{
  const wide=fitSocialText('MMMMMMMMMMMMMMMM',600,150,70,38,3,metrics);assert.ok(wide.size<70);
  const narrow=fitSocialText('iiiiiiiiiiiiiiii',500,150,70,38,3,metrics);assert.equal(narrow.size,70);
  assert.throws(()=>fitSocialText('M'.repeat(100),920,Infinity,70,38,3,metrics),/dépasse sa zone/);
  assert.throws(()=>fitSocialText('abc',100,100,30,30,1,()=>({width:90,actualBoundingBoxLeft:8,actualBoundingBoxRight:94})),/dépasse sa zone/);
});
test('old unmarked custom compositions retain exact legacy choice without resetting data',()=>{
  assert.equal(portraitLayoutMode(base),'compact');
  const custom:ProjectData[]=[{_studio_block_scale:85},{_studio_block_anchor:'center'},{_studio_block_y:10},{_studio_intro_x:10},{_studio_pack_fit:'contain'},{_studio_logo_anchor:'bottom-left'},{_studio_overlay_logo_enabled:true},{_studio_typography:JSON.stringify({'portrait:_titre_ligne_1':{x:0}})}];
  for(const patch of custom){
    const old={...base,...patch},original=JSON.stringify(old);assert.equal(portraitLayoutMode(old),'legacy');assert.equal(JSON.stringify(old),original);
    const next=preservePortraitLayout('BTV_BA_1P',old,{...old,_titre_ligne_1:'AUTRE'});assert.equal(next[PORTRAIT_LAYOUT],'legacy');for(const [key,value]of Object.entries(patch))assert.equal(next[key],value);
  }
  assert.equal(portraitLayoutMode({...base,_studio_typography:JSON.stringify({'tv:_titre_ligne_1':{x:50}})}),'compact');
});

test('right-hand station logo default does not switch the whole portrait composition to legacy',()=>{
  for(const anchor of ['top-right','top-left']){
    const data={...base,_studio_logo_anchor:anchor};
    assert.equal(portraitLayoutMode(data),'compact');
    assert.equal(portraitLayoutMode({...data,[PORTRAIT_LAYOUT]:'legacy'}),'legacy');
    assert.equal(portraitLayoutMode({...data,_studio_body_x:30}),'legacy','manual crop stays protected');
    assert.equal(portraitLayoutMode({...data,_studio_block_scale:85}),'legacy','manual panel stays protected');
    assert.equal(preservePortraitLayout('BTV_BA_TDS',data,{...data,_titre_ligne_1:'AUTRE'})[PORTRAIT_LAYOUT],'compact');
  }
});
test('first drag, crop, font or logo change pins compact BEFORE customization and remains stable after reload',()=>{
  for(const patch of [patchTextStyle(base,'_titre_ligne_1',{x:5,y:8}),{_studio_body_y:63},{_studio_typography:JSON.stringify({'portrait:_titre_ligne_1':{font:'suisse',size:95}})},{_studio_overlay_logo_enabled:true}]){
    const next=preservePortraitLayout('BTV_BA_1P',base,{...base,...patch});assert.equal(next[PORTRAIT_LAYOUT],'compact');assert.equal(portraitLayoutMode(JSON.parse(JSON.stringify(next))),'compact');
  }
  const legacy={...base,[PORTRAIT_LAYOUT]:'legacy'};assert.equal(preservePortraitLayout('BTV_BA_1P',legacy,{...legacy,[PORTRAIT_LAYOUT]:'compact'})[PORTRAIT_LAYOUT],'compact');
  for(const format of ['tv','vertical']){const before={...base,_studio_format:format},next={...before,_studio_block_y:8};assert.equal(preservePortraitLayout('BTV_BA_1P',before,next),next);}
  const vertical=preservePortraitLayout('BTV_BA_1P',base,{...base,_studio_format:'vertical'});
  assert.equal(portraitLayoutMode({...vertical,_studio_block_y:40,_studio_format:'portrait'}),'compact');
});
test('layout marker survives domain JSON roundtrip and announcement derivation, but never enters native TV payload',()=>{
  for(const id of ['BTV_BA_1P','BTV_BA_TDS','BTV_BA_TDS_SUIVI_DE'])for(const mode of ['compact','legacy']){
    const template=getTemplate(id),saved=validateProjectData(template,{...templateDefaults(template),...base,[PORTRAIT_LAYOUT]:mode});
    assert.equal(validateProjectData(template,JSON.parse(JSON.stringify(saved)))[PORTRAIT_LAYOUT],mode);assert.ok(!(PORTRAIT_LAYOUT in engineData(saved,true)));
    assert.throws(()=>validateProjectData(template,{[PORTRAIT_LAYOUT]:'unknown'}));
    if(id==='BTV_BA_1P'){
      const children=announcementProjects(template,'Test',saved,[{key:'today',time:'20:30',formats:['portrait'],voice:{mode:'none'}}]);
      assert.equal(children[0].data[PORTRAIT_LAYOUT],mode);
    }
  }
  assert.equal(validateProjectData(getTemplate('BTV_BA_1P'),base)[PORTRAIT_LAYOUT],'auto');
  assert.throws(()=>validateProjectData(getTemplate('BTV_PopUp'),{[PORTRAIT_LAYOUT]:'compact'}));
});
test('layout control is discoverable in the existing inspector',()=>{
  for(const query of ['compact','historique','panneau 4:5'])assert.equal(inspectorSearchPanels(getTemplate('BTV_BA_1P'),base,query).placement,true);
});
