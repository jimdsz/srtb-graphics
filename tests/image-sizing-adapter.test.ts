import test from 'node:test';
import assert from 'node:assert/strict';
import {broadcastTemplates,templateDefaults} from '../src/studio/domain';
import {installImageSizing} from '../src/studio/image-sizing';
import {imageSizePatch} from '../src/studio/image-sizing-model';
import type {LegacyGraphic} from '../src/studio/video/engine';

test('resized popup alpha survives native backdrop, clip switches and reset; failed edits recover and release temporary images',async t=>{
  const originals={document:globalThis.document,Image:globalThis.Image,HTMLImageElement:globalThis.HTMLImageElement,create:URL.createObjectURL,revoke:URL.revokeObjectURL};
  let images=0,serial=0;const released:string[]=[];
  class Picture{
    naturalWidth=800;naturalHeight=400;style={backgroundColor:''};crossOrigin='';onload:(()=>void)|null=null;onerror:(()=>void)|null=null;url='';
    constructor(){images++;}
    get src(){return this.url;}
    set src(value:string){this.url=value;queueMicrotask(()=>value.includes('broken')?this.onerror?.():this.onload?.());}
    removeAttribute(){this.url='';}
  }
  Object.assign(globalThis,{Image:Picture,HTMLImageElement:Picture,document:{baseURI:'https://studio.example/',createElement:()=>({width:0,height:0,getContext:()=>({drawImage(){}}),toBlob:(fn:(b:Blob)=>void)=>fn(new Blob(['image']))})}});
  URL.createObjectURL=()=>`blob:image-${++serial}`;URL.revokeObjectURL=url=>released.push(url);
  t.after(()=>{Object.assign(globalThis,{document:originals.document,Image:originals.Image,HTMLImageElement:originals.HTMLImageElement});URL.createObjectURL=originals.create;URL.revokeObjectURL=originals.revoke;});
  const template=broadcastTemplates.find(t=>t.id==='BTV_PopUp')!,initial=templateDefaults(template);
  const track:any={index:0,slot:{style:{backgroundColor:''}},clips:[],show(index:number){this.index=index;}};
  const commit=async(data:any)=>{const image=new Picture();image.src=typeof data._media_popup_url==='object'?data._media_popup_url.url:data._media_popup_url;track.clips=[{node:image},{node:{src:'clip.mp4',style:{backgroundColor:''}}}];track.show(0);return {statusCode:200};};
  const graphic={tracks:{popup:track},load:({data}:any)=>commit(data),updateAction:commit,dispose:async()=>{}} as unknown as LegacyGraphic;
  installImageSizing(graphic,template,initial);
  const sized={...initial,_media_popup_url:'photo.png',...imageSizePatch(initial,'_media_popup_url',50)};
  await graphic.load({data:sized});assert.equal(track.clips[0].node.style.backgroundColor,'transparent');assert.equal(track.slot.style.backgroundColor,'transparent');assert.equal(serial,1);
  track.show(1);assert.equal(track.slot.style.backgroundColor,'');track.show(0);assert.equal(track.slot.style.backgroundColor,'transparent');
  await assert.rejects(graphic.updateAction({...sized,_media_popup_url:'broken.png'}),/Image illisible/);
  assert.equal(released.length,0,'last good image remains usable after failure');
  await graphic.updateAction({...sized,...imageSizePatch(sized,'_media_popup_url',75)});assert.deepEqual(released,['blob:image-1']);
  const before=images;await graphic.updateAction({...sized,...imageSizePatch(sized,'_media_popup_url',100)});
  assert.equal(images,before+1,'100% only creates the native node, no resize image');assert.equal(track.slot.style.backgroundColor,'');assert.equal(track.clips[0].node.src,'photo.png');
  assert.deepEqual(released,['blob:image-1','blob:image-2']);await graphic.dispose();assert.equal(sized._media_popup_url,'photo.png');
});
