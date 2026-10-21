import test from 'node:test';
import assert from 'node:assert/strict';
import {broadcastTemplates,getTemplate,templateDefaults,validateProjectData} from '../src/studio/domain';
import {engineData} from '../src/studio/presentation';
import {socialCardScale,socialCardKey,socialCardPlacement,compactSocialCard} from '../src/studio/social-card-settings';
import {blockPlacement} from '../src/studio/placement';
import {liveTextEdit} from '../src/studio/live-preview';
import {inspectorSearchPanels} from '../src/studio/inspector-search';

test('social carton settings round-trip independently for every template, never in TV engine data',()=>{
  for(const t of broadcastTemplates){
    const data=validateProjectData(t,{...templateDefaults(t),_studio_format:'vertical',_studio_vertical_card_scale:65,_studio_portrait_card_scale:90,_studio_vertical_card_compact:false});
    const saved=validateProjectData(t,JSON.parse(JSON.stringify(data)));
    assert.equal(socialCardScale(saved),65);assert.equal(socialCardScale({...saved,_studio_format:'portrait'}),90);assert.equal(socialCardScale({...saved,_studio_format:'tv'}),100);
    assert.equal(compactSocialCard(saved),false);assert.equal(compactSocialCard({...saved,_studio_format:'portrait'}),true);
    assert.ok(!Object.keys(engineData(saved,true)).some(key=>key.includes('_card_')));
    for(const value of [49,101,NaN,Infinity,'80'])assert.throws(()=>validateProjectData(t,{_studio_vertical_card_scale:value}));
  }
});
test('smaller cards keep bottom edge and center, never stretch; 100% preserves existing placement exactly',()=>{
  for(const format of ['portrait','vertical'] as const)for(const box of [{x:0,y:850,w:1080,h:500},{x:80,y:700,w:850,h:350}]){
    const h=format==='vertical'?1920:1350,base={_studio_format:format,_studio_block_scale:85,_studio_block_anchor:'bottom',_studio_block_x:7,_studio_block_y:-8};
    const original=blockPlacement(box,1080,h,format==='vertical',base);
    assert.deepEqual(socialCardPlacement(box,1080,h,base),original);
    for(const percent of [50,65,80,100]){
      const small=socialCardPlacement(box,1080,h,{...base,[socialCardKey(format,'scale')]:percent});
      assert.ok(Math.abs(small.y+box.h*small.scale-original.y-box.h*original.scale)<1e-7);
      assert.ok(Math.abs(small.x+box.w*small.scale/2-original.x-box.w*original.scale/2)<1e-7);
      assert.ok(Math.abs(small.scale-original.scale*percent/100)<1e-7);
    }
  }
});
test('carton sliders and density update the live social scene without reloading media; TV and invalid values cannot bypass load',()=>{
  const t=getTemplate('BTV_BA_1P'),before={...templateDefaults(t),_studio_format:'vertical'};
  for(const patch of [{_studio_vertical_card_scale:65},{_studio_vertical_card_compact:false},{_studio_portrait_layout:'compact',_studio_portrait_card_scale:80}]){
    assert.equal(liveTextEdit(t,before,{...before,...patch},true),true);assert.equal(liveTextEdit(t,before,{...before,...patch},false),false);
  }
  assert.equal(liveTextEdit(t,before,{...before,_studio_vertical_card_scale:0},true),false);
  assert.equal(liveTextEdit(t,before,{...before,_studio_vertical_card_compact:'true'},true),false);
  assert.equal(liveTextEdit(t,before,{...before,_studio_vertical_card_scale:65,_media_body_url:''},true),false);
  for(const query of ['carton','réduire','espaces vides','taille carton'])assert.equal(inspectorSearchPanels(t,before,query).placement,true);
  assert.equal(inspectorSearchPanels(t,{...before,_studio_format:'tv'},'carton').placement,false);
});
