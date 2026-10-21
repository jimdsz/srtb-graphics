import test from 'node:test';
import assert from 'node:assert/strict';
import {needsSVGMediaPreview,SVGMediaPublisher,bindSVGMedia,previewMediaElement} from '../src/studio/svg-media-preview';

test('SVG media workaround targets WebKit, without classifying Chromium as Safari',()=>{
  assert.equal(needsSVGMediaPreview('Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15'),true);
  assert.equal(needsSVGMediaPreview('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/140.0 Safari/537.36'),false);
  assert.equal(needsSVGMediaPreview('Mozilla/5.0 (Windows) AppleWebKit/537.36 Chrome/140.0 Safari/537.36 Edg/140.0'),false);
  assert.equal(needsSVGMediaPreview('Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 CriOS/140.0 Mobile Safari/604.1'),true);
  assert.equal(needsSVGMediaPreview('Mozilla/5.0 Gecko/20100101 Firefox/140.0'),false);
});

test('media presentation keeps hit-testing on the actual SVG image',()=>{
  const canvas={} as HTMLCanvasElement,image={} as SVGImageElement;
  assert.equal(previewMediaElement(canvas),canvas);bindSVGMedia(canvas,image);assert.equal(previewMediaElement(canvas),image);
});

test('publisher bounds requests, swaps decoded frames atomically and revokes on disposal',async()=>{
  const originals={document:globalThis.document,Image:globalThis.Image,create:URL.createObjectURL,revoke:URL.revokeObjectURL};
  const callbacks:((blob:Blob)=>void)[]=[],snapshots:string[]=[],revoked:string[]=[],errors:unknown[]=[];let serial=0;
  const context={clearRect(){},drawImage(source:{frame:string}){snapshots.push(source.frame);}};
  const canvas=Object.assign(new EventTarget(),{width:2,height:2,frame:'',getContext:()=>context,toBlob(callback:(blob:Blob)=>void){callbacks.push(callback);}});
  const targets=[new Map<string,string>(),new Map<string,string>()].map(attributes=>({attributes,setAttribute:(key:string,value:string)=>attributes.set(key,value),removeAttribute:(key:string)=>attributes.delete(key)}));
  Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>canvas}});
  Object.defineProperty(globalThis,'Image',{configurable:true,value:class{src='';async decode(){}removeAttribute(){}}});
  URL.createObjectURL=()=>`blob:frame-${++serial}`;URL.revokeObjectURL=url=>{revoked.push(url);};
  const turn=()=>new Promise(resolve=>setImmediate(resolve));
  try{
    const publisher=new SVGMediaPublisher(targets as unknown as SVGImageElement[],error=>errors.push(error));
    publisher.publish({width:2,height:2,frame:'first'} as unknown as HTMLCanvasElement);
    publisher.publish({width:2,height:2,frame:'middle'} as unknown as HTMLCanvasElement);
    publisher.publish({width:2,height:2,frame:'latest'} as unknown as HTMLCanvasElement);
    assert.deepEqual(snapshots,['first']);assert.equal(callbacks.length,1);assert.equal(targets[0].attributes.size,0);
    callbacks.shift()!(new Blob());await turn();
    assert.deepEqual(snapshots,['first','latest']);assert.equal(callbacks.length,1);
    assert.equal(targets[0].attributes.get('href'),'blob:frame-1');assert.deepEqual([...targets[0].attributes],[...targets[1].attributes]);
    callbacks.shift()!(new Blob());await publisher.flush();
    assert.equal(targets[0].attributes.get('href'),'blob:frame-2');assert.equal(publisher.stats.replaced,1);assert.equal(publisher.stats.presented,2);
    publisher.publish({width:2,height:2,frame:'cancelled'} as unknown as HTMLCanvasElement);publisher.dispose();
    callbacks.shift()!(new Blob());await publisher.flush();
    assert.equal(targets[0].attributes.size,0);assert.equal(serial,2);assert.deepEqual(revoked.sort(),['blob:frame-1','blob:frame-2']);assert.deepEqual(errors,[]);
  }finally{
    Object.defineProperty(globalThis,'document',{configurable:true,value:originals.document});Object.defineProperty(globalThis,'Image',{configurable:true,value:originals.Image});URL.createObjectURL=originals.create;URL.revokeObjectURL=originals.revoke;
  }
});

test('failed image decoding is reported, never replaces the displayed frame and releases its URL',async()=>{
  const originals={document:globalThis.document,Image:globalThis.Image,create:URL.createObjectURL,revoke:URL.revokeObjectURL};
  const attributes=new Map([['href','previous-frame']]),errors:unknown[]=[],revoked:string[]=[];
  const context={clearRect(){},drawImage(){}};
  const canvas=Object.assign(new EventTarget(),{width:2,height:2,getContext:()=>context,toBlob(callback:(blob:Blob)=>void){callback(new Blob());}});
  Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>canvas}});
  Object.defineProperty(globalThis,'Image',{configurable:true,value:class{src='';async decode(){throw Error('decode refused');}removeAttribute(){}}});
  URL.createObjectURL=()=> 'blob:failed-frame';URL.revokeObjectURL=url=>{revoked.push(url);};
  try{
    const publisher=new SVGMediaPublisher([{setAttribute:(key:string,value:string)=>attributes.set(key,value),removeAttribute:(key:string)=>attributes.delete(key)}] as unknown as SVGImageElement[],error=>errors.push(error));
    publisher.publish(canvas as unknown as HTMLCanvasElement);
    await assert.rejects(publisher.flush(),/decode refused/);
    assert.equal(errors.length,1);assert.equal(attributes.get('href'),'previous-frame');assert.equal(publisher.stats.presented,0);assert.deepEqual(revoked,['blob:failed-frame']);
    // Rewinding a scene must not silently accept new frames on a failed surface.
    for(let frame=0;frame<100;frame++)assert.throws(()=>publisher.publish(canvas as unknown as HTMLCanvasElement),/decode refused/);
    assert.equal(publisher.busy,false);assert.equal(errors.length,1);
    publisher.dispose();assert.equal(attributes.size,0);
    assert.doesNotThrow(()=>publisher.publish(canvas as unknown as HTMLCanvasElement));
  }finally{
    Object.defineProperty(globalThis,'document',{configurable:true,value:originals.document});Object.defineProperty(globalThis,'Image',{configurable:true,value:originals.Image});URL.createObjectURL=originals.create;URL.revokeObjectURL=originals.revoke;
  }
});

test('context loss during asynchronous encoding or decode never replaces the last SVG frame',async()=>{
 const originals={document:globalThis.document,Image:globalThis.Image,create:URL.createObjectURL,revoke:URL.revokeObjectURL};
 try{
  for(const stage of ['encode','decode']){
   const attributes=new Map([['href','previous-frame']]),errors:unknown[]=[],revoked:string[]=[];let finish!:()=>void;
   const context={clearRect(){},drawImage(){}};
   const canvas=Object.assign(new EventTarget(),{width:2,height:2,getContext:()=>context,toBlob(callback:(blob:Blob)=>void){if(stage==='encode')finish=()=>callback(new Blob());else callback(new Blob());}});
   Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>canvas}});
   Object.defineProperty(globalThis,'Image',{configurable:true,value:class{src='';decode(){return new Promise<void>(resolve=>{finish=resolve;});}removeAttribute(){}}});
   URL.createObjectURL=()=> 'blob:lost-frame';URL.revokeObjectURL=url=>{revoked.push(url);};
   const publisher=new SVGMediaPublisher([{setAttribute:(key:string,value:string)=>attributes.set(key,value),removeAttribute:(key:string)=>attributes.delete(key)}] as unknown as SVGImageElement[],error=>errors.push(error));
   publisher.publish(canvas as unknown as HTMLCanvasElement);
   await new Promise(resolve=>setImmediate(resolve));canvas.dispatchEvent(new Event('contextlost'));canvas.dispatchEvent(new Event('contextrestored'));finish();
   await assert.rejects(publisher.flush(),/surface d’image/);
   assert.equal(errors.length,1);assert.equal(publisher.busy,false);assert.equal(publisher.stats.presented,0);assert.equal(attributes.get('href'),'previous-frame');
   assert.deepEqual(revoked,stage==='decode'?['blob:lost-frame']:[]);publisher.dispose();
  }
 }finally{
  Object.defineProperty(globalThis,'document',{configurable:true,value:originals.document});Object.defineProperty(globalThis,'Image',{configurable:true,value:originals.Image});URL.createObjectURL=originals.create;URL.revokeObjectURL=originals.revoke;
 }
});
