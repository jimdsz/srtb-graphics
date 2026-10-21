import test from 'node:test';
import assert from 'node:assert/strict';
import {finishTextDrag} from '../src/studio/typography-drag';
import {currentStyle,patchTextStyle,textStyles} from '../src/studio/typography-model';
const drag={field:'_title',x:0,y:0,dx:40,dy:-25,moved:true,cancelled:false};
test('a click and Escape/pointercancel return the exact original draft with no new style',()=>{
 const original={_title:'Titre natif',_studio_typography:'{}'};
 assert.equal(finishTextDrag(original,{...drag,moved:false}),original);
 assert.equal(finishTextDrag(original,{...drag,cancelled:true}),original);
 assert.equal(finishTextDrag(original,{...drag,dx:0,dy:0}),original);
});
test('release outside the frame commits clamped position without altering newer unrelated content',()=>{
 const latest={_title:'Titre retouché',_subtitle:'Autre champ',_studio_format:'tv',_studio_typography:'{"tv:_label":{"size":78}}'};
 const result=finishTextDrag(latest,{...drag,dx:-9000,dy:9000});
 assert.deepEqual(currentStyle(result,'_title'),{x:-4096,y:4096});assert.equal(result._title,latest._title);assert.equal(result._subtitle,latest._subtitle);assert.deepEqual(textStyles(result)['tv:_label'],{size:78});
});
test('a concurrent position update is never overwritten by the stale drag',()=>{
 const latest={_title:'Texte',...patchTextStyle({},'_title',{x:12,y:4})};assert.equal(finishTextDrag(latest,drag),latest);
});
test('a newer font or size survives a drag commit while only position changes',()=>{
 const latest={...patchTextStyle({},'_title',{font:'suisse',size:70})},next=finishTextDrag(latest,drag);assert.deepEqual(currentStyle(next,'_title'),{font:'suisse',size:70,x:40,y:-25});
});
