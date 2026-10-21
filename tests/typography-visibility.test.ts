import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeTextLayerHidden} from '../src/studio/typography-visibility';

function node(display='',parentElement:Element|null=null){return {style:{display},parentElement} as unknown as HTMLElement;}
test('inactive AE layer and hidden ancestors are skipped without a computed-style read',()=>{
  const parent=node('none'),child=node('',parent);
  assert.equal(nativeTextLayerHidden(parent),true);
  assert.equal(nativeTextLayerHidden(child),true);
});
test('active layer is checked again immediately after native visibility changes',()=>{
  const parent=node('none'),child=node('',parent);
  assert.equal(nativeTextLayerHidden(child),true);
  parent.style.display='block';
  assert.equal(nativeTextLayerHidden(child),false);
  parent.style.display='none';
  assert.equal(nativeTextLayerHidden(child),true);
});
test('visibility, opacity, masks and offscreen geometry are not guessed',()=>{
  const layer=node();Object.assign(layer.style,{visibility:'hidden',opacity:'0',transform:'scale(0)'});
  assert.equal(nativeTextLayerHidden(layer),false);
});
test('hidden descendants do not hide the native parent or sibling text',()=>{
  const parent=node('block'),hidden=node('none',parent),visible=node('',parent);
  assert.equal(nativeTextLayerHidden(hidden),true);
  assert.equal(nativeTextLayerHidden(parent),false);
  assert.equal(nativeTextLayerHidden(visible),false);
});
test('read-only visibility check leaves the scene unchanged',()=>{
  const parent=node('none'),child=node('',parent),before=JSON.stringify(child);
  nativeTextLayerHidden(child);assert.equal(JSON.stringify(child),before);
});
