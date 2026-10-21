import test from 'node:test';
import assert from 'node:assert/strict';
import {broadcastTemplates,templateDefaults} from '../src/studio/domain';
import type {ProjectData} from '../src/studio/domain';
import {installTypography} from '../src/studio/typography-engine';
import {DEFAULT_TEXT_CASE,textFields} from '../src/studio/typography-model';
import {engineData} from '../src/studio/presentation';
import type {LegacyGraphic} from '../src/studio/video/engine';

test('shared preview/export/portable adapter sends uppercase native load and update data without placeholders or source mutation',async t=>{
  const original=globalThis.document;
  const node=()=>({style:{cssText:''},setAttribute(){},append(){},remove(){}});
  Object.assign(globalThis,{document:{baseURI:'https://studio.example/',createElement:node,createElementNS:node}});
  t.after(()=>{globalThis.document=original;});
  for(const template of broadcastTemplates){
    let accepted:ProjectData={};const initial=templateDefaults(template);
    for(const [key]of textFields(template))initial[key]='Été au Bénin';
    const before=structuredClone(initial),g=Object.assign(new EventTarget(),{
      shadowRoot:{append(){},querySelector(){return null;}},
      async load({data}:{data:ProjectData}){accepted=data;return {statusCode:200};},
      async updateAction(data:ProjectData){accepted=data;return {statusCode:200};},
      async playAction(){},async stopAction(){},async goToTime(){},async dispose(){},
    }) as unknown as LegacyGraphic;
    installTypography(g,template,initial);
    await g.load({data:engineData(initial,true)});
    for(const [key]of textFields(template))assert.equal(accepted[key],'ÉTÉ AU BÉNIN',template.id+key);
    assert.equal(accepted[DEFAULT_TEXT_CASE],undefined);assert.deepEqual(initial,before);
    const field=textFields(template)[0][0],next={...initial,[field]:'Édition suivante'};
    await g.updateAction(engineData(next,true));assert.equal(accepted[field],'ÉDITION SUIVANTE');assert.equal(next[field],'Édition suivante');
    await g.updateAction(engineData({...next,[DEFAULT_TEXT_CASE]:'original'},true));assert.equal(accepted[field],'Édition suivante');
    await g.dispose();
  }
});
