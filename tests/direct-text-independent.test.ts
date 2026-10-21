import test from 'node:test';
import assert from 'node:assert/strict';
import {localDisplacement,nativeTextStyle,nudgeText,positionText,textArrow} from '../src/studio/typography-position';
import {currentStyle} from '../src/studio/typography-model';
import type {ProjectData} from '../src/studio/domain';

test('first native move creates only a position override, not a new font or size',()=>{
  const source:ProjectData={_title:'Olympe\nBhêly-Quenum'};
  const next=nudgeText(source,'_title',[1,0]);
  assert.deepEqual(currentStyle(next,'_title'),{x:1,y:0});
  assert.equal(nativeTextStyle(currentStyle(next,'_title')),true);
  assert.deepEqual(source,{_title:'Olympe\nBhêly-Quenum'});
  assert.equal(next._title,source._title);
});

test('ten successive arrows accumulate and Shift increments ten composition pixels',()=>{
  let draft:ProjectData={_title:'Titre'};
  for(let n=0;n<10;n++)draft=nudgeText(draft,'_title',textArrow({key:'ArrowRight'})!);
  draft=nudgeText(draft,'_title',textArrow({key:'ArrowUp',shiftKey:true})!);
  assert.deepEqual(currentStyle(draft,'_title'),{x:10,y:-10});
  for(const modifier of ['ctrlKey','altKey','metaKey'])assert.equal(textArrow({key:'ArrowLeft',[modifier]:true}),null);
  assert.equal(textArrow({key:'a'}),null);
});

test('native movement preserves other aspect ratios and explicit typography choices',()=>{
  const styles={'tv:_title':{font:'suisse',size:75,italic:true,x:3},'vertical:_title':{x:80,y:40}};
  const source:ProjectData={_studio_typography:JSON.stringify(styles),_title:'Programme',_studio_format:'vertical'};
  const next=positionText(source,'_title',84,38);
  assert.deepEqual(currentStyle(next,'_title'),{x:84,y:38});
  assert.deepEqual(currentStyle({...next,_studio_format:'tv'},'_title'),styles['tv:_title']);
  assert.equal(nativeTextStyle(styles['tv:_title']),false);
  assert.equal(source._studio_typography,JSON.stringify(styles));
});

test('screen-space displacement is invariant under preview scaling and rotated parents',()=>{
  for(const matrix of [{a:.25,b:0,c:0,d:.25},{a:0,b:.5,c:-.5,d:0},{a:1.2,b:.2,c:.1,d:.8}]){
    const [x,y]=localDisplacement(matrix,13,-9);
    assert.ok(Math.abs(matrix.a*x+matrix.c*y-13)<1e-8);
    assert.ok(Math.abs(matrix.b*x+matrix.d*y+9)<1e-8);
  }
  assert.deepEqual(localDisplacement({a:0,b:0,c:0,d:0},13,-9),[0,0]);
});
