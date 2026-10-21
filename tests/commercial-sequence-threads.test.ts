import test from 'node:test';
import assert from 'node:assert/strict';
import type {CommercialSequence,CommercialSequenceSpan} from '../src/studio/commercial/model';
import {drawReadableSequenceThreads,readableSequenceThreadRoutes,readableSequenceThreads,READABLE_THREAD_BEFORE,READABLE_THREAD_AFTER} from '../src/studio/commercial/sequence-threads';

const layouts:CommercialSequence['layout'][]=['central','columns','left','right','final'];
const span=(layout:CommercialSequence['layout'],start:number,end:number,id='test'):CommercialSequenceSpan=>({id,layout,start,end,duration:end-start,index:0,pageIndices:[]});
const pair=(from:CommercialSequence['layout'],to:CommercialSequence['layout'])=>[span(from,3.4,10,'first'),span(to,10,18,'second')];

test('every ordered layout pair gets finite smooth routes in the reading area, including repeated layouts',()=>{
  for(const from of layouts)for(const to of layouts){
    const routes=readableSequenceThreadRoutes(from,to);
    assert.equal(routes.length,from==='columns'||to==='columns'?2:1,`${from}/${to}`);
    for(const route of routes){
      assert.ok(route.length>150&&route.length<1200,`${from}/${to}: ${route.length}`);
      assert.equal(route.vertices.length,121);
      for(let i=0;i<route.vertices.length;i++){
        const p=route.vertices[i];assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));
        assert.ok(p.x>=96&&p.x<=1824&&p.y>=224&&p.y<=732,`${from}/${to}: ${p.x},${p.y}`);
        if(i)assert.ok(p.at>route.vertices[i-1].at);
      }
      assert.equal(route.vertices[0].y,478);assert.ok(Math.abs(route.vertices.at(-1)!.y-478)<1e-8);
    }
    assert.ok(readableSequenceThreads(9.9,pair(from,to)).length>0);
  }
});

test('column branches depart from and reunite at the actual composition centers',()=>{
  const outward=readableSequenceThreadRoutes('central','columns'),inward=readableSequenceThreadRoutes('columns','final');
  assert.deepEqual(outward.map(p=>[p.vertices[0].x,p.vertices.at(-1)!.x]),[[960,532],[960,1388]]);
  assert.deepEqual(inward.map(p=>[p.vertices[0].x,p.vertices.at(-1)!.x]),[[1388,960],[532,960]]);
  assert.equal(outward[0].glow,true);assert.equal(outward[1].glow,false);assert.equal(outward[1].delay,.13);
  assert.deepEqual(readableSequenceThreadRoutes('left','right').map(p=>[p.vertices[0].x,p.vertices.at(-1)!.x]),[[792,1128]]);
});

test('threads are absent on plateaus and bookends, and cannot persist past their bounded window',()=>{
  const spans=pair('central','columns');
  for(const time of [0,3.4,5,8,10-READABLE_THREAD_BEFORE,10+READABLE_THREAD_AFTER,12,18,20,NaN,Infinity])assert.deepEqual(readableSequenceThreads(time,spans),[]);
  assert.deepEqual(readableSequenceThreads(9.9,[spans[0]]),[]);
  for(const from of layouts)for(const to of layouts){
    const frames=Array.from({length:70},(_,i)=>readableSequenceThreads(9+i/29.97,pair(from,to)));
    assert.ok(frames.some(strokes=>strokes.length));
    assert.deepEqual(frames.at(-1),[]);
  }
});

test('all successive boundaries follow stored order and pure seeking gives the same output',()=>{
  const order=['right','central','central','columns','left','final'] as const;
  const spans=order.map((layout,i)=>span(layout,3+i*4,7+i*4,String(i))),saved=JSON.stringify(spans);
  for(let i=1;i<spans.length;i++){
    const at=spans[i].start;
    const first=readableSequenceThreads(at,spans);assert.ok(first.length);
    readableSequenceThreads(25,spans);readableSequenceThreads(3,spans);
    assert.deepEqual(readableSequenceThreads(at,spans),first);
    assert.ok(first.every(s=>s.boundary===at));
  }
  assert.equal(JSON.stringify(spans),saved);
  assert.deepEqual(readableSequenceThreads(10,[span('central',3,8),span('right',10,15)]),[]);
});

test('native stroke widths, pearl color and glow opacity are preserved through trim progression',()=>{
  const spans=pair('central','columns'),early=readableSequenceThreads(9.5,spans),middle=readableSequenceThreads(10,spans),late=readableSequenceThreads(10.65,spans);
  assert.equal(early.length,2);assert.equal(middle.length,3);
  assert.ok(middle.some(s=>s.width===10&&s.alpha===.14&&s.color==='#ffffff'));
  assert.ok(middle.filter(s=>s.width===2.2).every(s=>s.alpha===.72&&s.color==='#f7faed'));
  const length=(stroke:typeof middle[number])=>stroke.points.reduce((sum,p,i)=>i?sum+Math.hypot(p[0]-stroke.points[i-1][0],p[1]-stroke.points[i-1][1]):0,0);
  assert.ok(length(middle[0])>length(early[0])*5);
  assert.ok(length(late[0])<length(middle[0])*.1);
});

test('draw saves and restores caller state and draws nothing at rest',()=>{
  const strokes:unknown[]=[],stack:unknown[]=[];
  const c={globalAlpha:.5,lineWidth:7,lineCap:'butt',lineJoin:'miter',strokeStyle:'#123456',
    save(){stack.push({globalAlpha:this.globalAlpha,lineWidth:this.lineWidth,lineCap:this.lineCap,lineJoin:this.lineJoin,strokeStyle:this.strokeStyle});},
    restore(){Object.assign(this,stack.pop());},beginPath(){},moveTo(){},lineTo(){},
    stroke(){strokes.push({alpha:this.globalAlpha,width:this.lineWidth,color:this.strokeStyle});},
  };
  drawReadableSequenceThreads(c as unknown as CanvasRenderingContext2D,10,pair('central','columns'));
  assert.equal(strokes.length,3);assert.deepEqual(strokes[0],{alpha:.07,width:10,color:'#ffffff'});
  assert.equal(c.globalAlpha,.5);assert.equal(c.lineWidth,7);assert.equal(c.lineCap,'butt');assert.equal(c.lineJoin,'miter');assert.equal(c.strokeStyle,'#123456');assert.equal(stack.length,0);
  drawReadableSequenceThreads(c as unknown as CanvasRenderingContext2D,12,pair('central','columns'));assert.equal(strokes.length,3);
});
