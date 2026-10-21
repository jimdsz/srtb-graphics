import test from 'node:test';
import assert from 'node:assert/strict';
import {paintBAPreviewCanvas,copyBAPreviewCanvas} from '../src/studio/ba-preview-canvas';
function canvas(){
 const calls:unknown[][]=[],context={fillStyle:'',setTransform:(...v:number[])=>calls.push(['transform',...v]),clearRect:(...v:number[])=>calls.push(['clear',...v]),fillRect:(...v:number[])=>calls.push(['fill',...v]),drawImage:(...v:unknown[])=>calls.push(['draw',...v])};
 const node=Object.assign(new EventTarget(),{width:960,height:540,getContext:()=>context}) as unknown as HTMLCanvasElement;
 return {node,calls,context};
}
test('direct first slot is never cleared/copied over itself and secondary transforms are reset',()=>{
 const first=canvas(),second=canvas(),source={} as HTMLImageElement;
 paintBAPreviewCanvas(source,first.node,960,540,'body',{x:1,y:0,width:1920,height:1080});
 const painted=[...first.calls];copyBAPreviewCanvas(first.node,[first.node,second.node],960,540);
 assert.deepEqual(first.calls,painted);
 assert.deepEqual(second.calls,[['transform',1,0,0,1,0,0],['clear',0,0,960,540],['draw',first.node,0,0,960,540]]);
 assert.equal(first.calls.filter(v=>v[0]==='draw').length+second.calls.filter(v=>v[0]==='draw').length,2);
});
test('switching the first visible slot cannot retain its previous raster scale',()=>{
 const a=canvas(),b=canvas(),source={} as HTMLImageElement;
 paintBAPreviewCanvas(source,a.node,640,360,'intro',{x:1,y:1,width:1920,height:1080});
 copyBAPreviewCanvas(a.node,[a.node,b.node],640,360);a.calls.length=0;
 paintBAPreviewCanvas(source,b.node,640,360,'body',{x:1,y:0,width:1920,height:1080});
 copyBAPreviewCanvas(b.node,[b.node,a.node],640,360);
 assert.deepEqual(a.calls[0],['transform',1,0,0,1,0,0]);assert.equal(a.node.width,640);assert.equal(a.node.height,360);
});
test('intro alpha and pack half-height coordinates remain native',()=>{
 const c=canvas(),source={} as HTMLImageElement,placement={x:1,y:-152,width:1920,height:1080};
 paintBAPreviewCanvas(source,c.node,960,270,'pack',placement);
 assert.deepEqual(c.calls,[['transform',.5,0,0,.5,0,0],['clear',0,0,1920,540],['draw',source,1,-152,1920,1080]]);
 c.calls.length=0;paintBAPreviewCanvas(source,c.node,640,360,'intro',{...placement,y:1});
 assert.equal(c.context.fillStyle,'rgba(0,0,0,.1)');assert.deepEqual(c.calls[2],['fill',0,0,1920,1080]);
});

test('lost primary or secondary slots cannot silently accept a frozen frame',()=>{
 const a=canvas(),b=canvas(),source={} as HTMLImageElement;
 paintBAPreviewCanvas(source,a.node,960,540,'body',{x:0,y:0,width:1920,height:1080});
 copyBAPreviewCanvas(a.node,[a.node,b.node],960,540);
 const before=[...b.calls];Object.assign(b.context,{isContextLost:()=>true});
 assert.throws(()=>copyBAPreviewCanvas(a.node,[a.node,b.node],960,540),/surface d’image.*Relancez/);
 assert.deepEqual(b.calls,before,'no clear/copy of a lost secondary slot');
 Object.assign(a.context,{isContextLost:()=>true});const primary=[...a.calls];
 assert.throws(()=>paintBAPreviewCanvas(source,a.node,960,540,'body',{x:0,y:0,width:1920,height:1080}),/surface d’image/);
 assert.deepEqual(a.calls,primary);
});

test('a context lost during drawing fails before its raster is published',()=>{
 const a=canvas();let lost=false;Object.assign(a.context,{isContextLost:()=>lost,drawImage:()=>{lost=true;}});
 assert.throws(()=>paintBAPreviewCanvas({} as HTMLImageElement,a.node,960,540,'body',{x:0,y:0,width:1920,height:1080}),/surface d’image/);
});
