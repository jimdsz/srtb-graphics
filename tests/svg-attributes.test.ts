import test from 'node:test';
import assert from 'node:assert/strict';
import {setSvgAttribute} from '../src/studio/svg-attributes';
test('unchanged SVG attributes do not cause mutations; external animation changes are respected',()=>{
 const attrs=new Map<string,string>(),writes:string[]=[];
 const node={getAttribute:(key:string)=>attrs.get(key)??null,setAttribute:(key:string,value:string)=>{writes.push(key);attrs.set(key,value);},removeAttribute:(key:string)=>{writes.push(key);attrs.delete(key);}} as unknown as Element;
 setSvgAttribute(node,'transform','translate(10 20)');
 for(let i=0;i<100;i++){setSvgAttribute(node,'transform','translate(10 20)');setSvgAttribute(node,'opacity',null);}
 assert.deepEqual(writes,['transform']);
 attrs.set('transform','translate(15 20)');setSvgAttribute(node,'transform','translate(10 20)');assert.equal(writes.length,2);
 setSvgAttribute(node,'transform',null);setSvgAttribute(node,'transform',null);assert.equal(writes.length,3);assert.equal(attrs.size,0);
});
