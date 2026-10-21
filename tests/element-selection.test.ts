import test from 'node:test';
import assert from 'node:assert/strict';
import {getTemplate} from '../src/studio/domain';
import {selectionCategory,clippedBox,OVERLAY_LOGO,BRAND_POSITION} from '../src/studio/element-selection';
test('selection opens the appropriate inspector without treating a logo as text',()=>{
  const ba=getTemplate('BTV_BA_1P');
  for(const field of ['_jour_1','_heure_1','_titre_ligne_2'])assert.equal(selectionCategory(ba,field),'Textes et dates');
  assert.equal(selectionCategory(ba,'_media_pack_url'),'Médias');
  assert.equal(selectionCategory(ba,'_sponsor_url'),'Logos');
  assert.equal(selectionCategory(ba,OVERLAY_LOGO),'Logos');
  assert.equal(selectionCategory(ba,BRAND_POSITION),'Graphisme');
  assert.equal(selectionCategory(getTemplate('BTV_Passerelle_Replay'),'_replay_url'),'Textes et dates');
});
test('off-screen and empty elements cannot intercept clicks',()=>{
  assert.equal(clippedBox('x',{x:1.1,y:0,width:.2,height:.5}),undefined);
  assert.equal(clippedBox('x',{x:0,y:0,width:0,height:.5}),undefined);
  assert.equal(clippedBox('x',{x:NaN,y:0,width:1,height:1}),undefined);
  assert.deepEqual(clippedBox('x',{x:-.2,y:.5,width:.7,height:1}),{field:'x',x:0,y:.5,width:.49999999999999994,height:.5});
});
