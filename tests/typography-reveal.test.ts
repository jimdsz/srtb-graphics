import test from 'node:test';
import assert from 'node:assert/strict';
import {textRevealParent,createTextReveal} from '../src/studio/typography-reveal';
class FakeElement{
 namespaceURI='http://www.w3.org/2000/svg';localName='g';attrs=new Map<string,string>();children:FakeElement[]=[];parentElement:FakeElement|null=null;removed=false;next?:FakeElement;
 setAttribute(k:string,v:string){this.attrs.set(k,v);}getAttribute(k:string){return this.attrs.get(k)??null;}hasAttribute(k:string){return this.attrs.has(k);}removeAttribute(k:string){this.attrs.delete(k);}
 append(child:FakeElement){this.children.push(child);child.parentElement=this;}after(child:FakeElement){this.next=child;}remove(){this.removed=true;}
}
test('reveal bridge is pinned to split AE templates and a single text child',()=>{
 const node=new FakeElement(),parent=new FakeElement();parent.setAttribute('mask','url(#split)');parent.append(node);
 for(const id of ['BTV_Semainier','BTV_Evenement','BTV_Renvoi'])assert.equal(textRevealParent(node as unknown as Element,id),parent);
 for(const id of ['BTV_BA_1P','BTV_PopUp','BTV_BA_TDS'])assert.equal(textRevealParent(node as unknown as Element,id),undefined);
 parent.children.push(new FakeElement());assert.equal(textRevealParent(node as unknown as Element,'BTV_Semainier'),undefined);parent.children.pop();
 parent.removeAttribute('mask');assert.equal(textRevealParent(node as unknown as Element,'BTV_Semainier'),undefined);
 parent.setAttribute('mask','url(#split)');parent.namespaceURI='http://www.w3.org/1999/xhtml';assert.equal(textRevealParent(node as unknown as Element,'BTV_Semainier'),undefined);
});
test('the reveal follows the live matte and visibility without duplicating IDs',()=>{
 const prior=Object.getOwnPropertyDescriptor(globalThis,'document');
 Object.defineProperty(globalThis,'document',{configurable:true,value:{createElementNS:()=>new FakeElement()}});
 try{
  const source=new FakeElement(),group=new FakeElement();source.setAttribute('mask','url(#split-1)');source.setAttribute('style','display:none');source.setAttribute('id','original');
  const reveal=createTextReveal(source as unknown as SVGGElement,group as unknown as SVGGElement);reveal.sync();
  const placement=reveal.placement as unknown as FakeElement,masked=placement.children[0];
  assert.equal(source.next,placement);assert.equal(masked.children[0],group);assert.equal(masked.getAttribute('mask'),'url(#split-1)');assert.equal(masked.getAttribute('style'),'display:none');assert.equal(masked.hasAttribute('id'),false);
  source.setAttribute('mask','url(#split-2)');source.removeAttribute('style');source.setAttribute('transform','matrix(1 0 0 1 20 30)');source.setAttribute('opacity','.5');reveal.sync();
  assert.equal(masked.getAttribute('mask'),'url(#split-2)');assert.equal(masked.getAttribute('style'),null);assert.equal(masked.getAttribute('opacity'),'.5');assert.equal(masked.getAttribute('transform'),'matrix(1 0 0 1 20 30)');
  reveal.remove();assert.equal(placement.removed,true);assert.equal(source.removed,false);
 }finally{if(prior)Object.defineProperty(globalThis,'document',prior);else Reflect.deleteProperty(globalThis,'document');}
});
