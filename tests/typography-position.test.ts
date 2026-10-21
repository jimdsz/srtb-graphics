import test from 'node:test';
import assert from 'node:assert/strict';
import type {ProjectData} from '../src/studio/domain';
import {currentStyle,patchTextStyle,styleDefaults,textStyles} from '../src/studio/typography-model';
import {clampTextPosition,localDisplacement,nativeTextStyle,nudgeText,positionText,textArrow} from '../src/studio/typography-position';

test('only absent, empty and position-only styles retain native glyphs',()=>{
  for(const style of [undefined,{},{x:0},{y:-16},{x:35,y:12}])assert.equal(nativeTextStyle(style),true);
  for(const [key,value] of Object.entries(styleDefaults)){
    if(key==='x'||key==='y')continue;
    assert.equal(nativeTextStyle({x:10,[key]:value}),false,key+' is an explicit non-position edit');
  }
});

test('all four arrows move one pixel, or ten with Shift',()=>{
  for(const [key,delta] of Object.entries({ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]})){
    assert.deepEqual(textArrow({key}),delta);
    assert.deepEqual(textArrow({key,shiftKey:true}),delta.map(value=>value*10));
  }
});

test('modifier shortcuts and non-arrow keys never move text',()=>{
  for(const key of ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown']){
    for(const modifier of ['ctrlKey','altKey','metaKey']){
      assert.equal(textArrow({key,[modifier]:true}),null);
      assert.equal(textArrow({key,shiftKey:true,[modifier]:true}),null);
    }
  }
  for(const key of ['', 'Enter','Escape','Tab','a','constructor','toString','__proto__'])assert.equal(textArrow({key}),null,key);
});

test('ten successive keyboard nudges accumulate from the latest project state',()=>{
  const original:ProjectData={_title:'Olympe B.Quenum',_studio_format:'tv'};
  let data=original;
  for(let n=0;n<10;n++)data=nudgeText(data,'_title',textArrow({key:'ArrowRight'})!);
  assert.deepEqual(currentStyle(data,'_title'),{x:10,y:0});
  for(let n=0;n<10;n++)data=nudgeText(data,'_title',textArrow({key:'ArrowUp',shiftKey:true})!);
  assert.deepEqual(currentStyle(data,'_title'),{x:10,y:-100});
  assert.equal(nativeTextStyle(currentStyle(data,'_title')),true);
  assert.deepEqual(original,{_title:'Olympe B.Quenum',_studio_format:'tv'});
  assert.equal(data._title,original._title);
});

test('position changes preserve formatting, other text fields and other aspect ratios',()=>{
  let original:ProjectData={_title:'Interview',_subtitle:'Entretien',_studio_format:'tv',_background_visible:true};
  original={...original,...patchTextStyle(original,'_title',{x:7,y:-3,size:70,font:'suisse',case:'typed'})};
  original={...original,...patchTextStyle(original,'_subtitle',{y:40,colour:'#ffffff'})};
  original={...original,_studio_format:'portrait'};
  original={...original,...patchTextStyle(original,'_title',{x:80,y:90,bold:true})};
  const before=structuredClone(original),next=positionText(original,'_title',12.2,-5.8);
  assert.deepEqual(currentStyle(next,'_title'),{x:12,y:-6,bold:true});
  assert.deepEqual(textStyles(next)['tv:_title'],{x:7,y:-3,size:70,font:'suisse',case:'typed'});
  assert.deepEqual(textStyles(next)['tv:_subtitle'],{y:40,colour:'#ffffff'});
  assert.equal(next._background_visible,true);
  assert.equal(next._title,'Interview');
  assert.equal(next._subtitle,'Entretien');
  assert.deepEqual(original,before);
});

test('positions round to whole pixels and clamp independently at both boundaries',()=>{
  for(const [value,expected] of [[4096,4096],[9000,4096],[-4096,-4096],[-9000,-4096],[3.4,3],[3.6,4],[-3.4,-3],[-3.6,-4]]){
    assert.equal(clampTextPosition(value),expected);
  }
  const data=positionText({_title:'Titre'},'_title',5000,-5000);
  assert.deepEqual(currentStyle(data,'_title'),{x:4096,y:-4096});
  assert.deepEqual(currentStyle(nudgeText(data,'_title',[10,-10]),'_title'),{x:4096,y:-4096});
  assert.deepEqual(currentStyle(nudgeText(data,'_title',[-1,1]),'_title'),{x:4095,y:-4095});
});

test('local displacement inverts identity, scaled, rotated and reflected parents',()=>{
  const cases:[{a:number;b:number;c:number;d:number},number,number,[number,number]][]=[
    [{a:1,b:0,c:0,d:1},12,-8,[12,-8]],
    [{a:2,b:0,c:0,d:2},20,10,[10,5]],
    [{a:2,b:0,c:0,d:4},20,10,[10,2.5]],
    [{a:0,b:1,c:-1,d:0},10,20,[20,-10]],
    [{a:0,b:2,c:-3,d:0},12,8,[4,-4]],
    [{a:-2,b:0,c:0,d:4},12,8,[-6,2]],
  ];
  for(const [matrix,x,y,expected] of cases)assert.deepEqual(localDisplacement(matrix,x,y),expected);
});

test('rotated/scaled/skewed parent conversion round-trips screen displacement',()=>{
  const angle=Math.PI/5,matrix={a:2*Math.cos(angle),b:2*Math.sin(angle),c:-3*Math.sin(angle)+.4,d:3*Math.cos(angle)};
  for(const [x,y] of [[31,-27],[-800,250],[0,0]]){
    const [dx,dy]=localDisplacement(matrix,x,y);
    assert.ok(Math.abs(matrix.a*dx+matrix.c*dy-x)<1e-9);
    assert.ok(Math.abs(matrix.b*dx+matrix.d*dy-y)<1e-9);
  }
});

test('singular and near-singular parent transforms cannot create enormous jumps',()=>{
  for(const matrix of [{a:0,b:0,c:0,d:0},{a:1,b:2,c:2,d:4},{a:1,b:0,c:0,d:1e-12}]){
    assert.deepEqual(localDisplacement(matrix,100,-100),[0,0]);
  }
});
