import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {broadcastTemplates,templateDefaults,isMediaField,validateProjectData} from '../src/studio/domain';
import type {BroadcastTemplate,ProjectData} from '../src/studio/domain';
import {engineData,PRESENTATIONS} from '../src/studio/presentation';
import {overlayLogoAnchors,overlayLogoDefaults,overlayLogoGeometry,overlayLogoKey,overlayLogoMotion,overlayLogoPlates,overlayLogoSettings,overlayLogoSource} from '../src/studio/logo-model';
import {installOverlayLogo,prepareOverlayLogo,drawOverlayLogo} from '../src/studio/logo-render';
import type {LegacyGraphic} from '../src/studio/video/engine';
import {makeTimeline} from '../src/studio/video/timeline';
import {selectedMediaData} from '../src/studio/media-selection';

const prefix='_studio_overlay_logo_',base='https://studio.test/',module='/library/v1.7.0/BTV_BA_1P/graphic.mjs';
const enabled:ProjectData={...overlayLogoDefaults,[prefix+'enabled']:true,[prefix+'url']:'/api/graphics/media/aaaaaaaa/content'};
test('every catalogue template exposes an independent, disabled, versioned image extension',()=>{
  assert.ok(broadcastTemplates.length>=10);
  for(const template of broadcastTemplates){
    const data=templateDefaults(template);assert.equal(data[prefix+'enabled'],false);assert.equal(data[prefix+'version'],1);
    assert.equal(template.fields[prefix+'url']['x-control'],'image');assert.equal(isMediaField(prefix+'url',template.fields[prefix+'url']),true);
    assert.equal(validateProjectData(template,{[prefix+'enabled']:true,[prefix+'url']:'img_0.png'})[prefix+'url'],'img_0.png');
    assert.equal(engineData(data)[prefix+'version'],undefined);assert.equal(engineData(data,true)[prefix+'version'],1);
  }
});
test('disabled logo never resolves its source; enabled image descriptors and reconnect errors are explicit',()=>{
  assert.equal(overlayLogoSource({...enabled,[prefix+'enabled']:false,[prefix+'url']:'local-media:unavailable'},module,base),'');
  assert.equal(overlayLogoSource({...enabled,[prefix+'url']:'img_0.png'},module,base),base+'library/v1.7.0/BTV_BA_1P/lib/images/img_0.png');
  assert.equal(overlayLogoSource({...enabled,[prefix+'url']:{url:'blob:https://studio.test/preview',mimeType:'image/png',name:'logo.png'}},module,base),'blob:https://studio.test/preview');
  assert.throws(()=>overlayLogoSource({...enabled,[prefix+'url']:'local-media:unavailable'},module,base),/Reconnectez/);
  assert.throws(()=>overlayLogoSource({...enabled,[prefix+'url']:''},module,base),/Choisissez/);
  assert.throws(()=>overlayLogoSource({...enabled,[prefix+'url']:{url:'/video.mp4',mimeType:'video/mp4',name:'video'}},module,base),/une image/);
  assert.throws(()=>overlayLogoSettings({...enabled,[prefix+'version']:2}),/hors limites/);
  assert.throws(()=>overlayLogoSettings({...enabled,[prefix+'size']:NaN}),/hors limites/);
  assert.throws(()=>overlayLogoSettings({...enabled,[prefix+'plate']:'red'}),/invalide/);
});
test('a hidden local logo is retained in the project but excluded from runtime and package dependencies',()=>{
  for(const template of broadcastTemplates){
    const logo={url:`local-media:${'a'.repeat(64)}:120`,name:'logo.png',mimeType:'image/png'},data={...templateDefaults(template),[prefix+'url']:logo};
    assert.equal(selectedMediaData(template,data)[prefix+'url'],'');assert.deepEqual(data[prefix+'url'],logo);
    assert.deepEqual(selectedMediaData(template,{...data,[prefix+'enabled']:true})[prefix+'url'],logo);
  }
});
test('all positions and chart plates preserve aspect ratio inside format-specific safe regions',()=>{
  for(const {width,height}of Object.values(PRESENTATIONS))for(const anchor of overlayLogoAnchors)for(const plate of Object.keys(overlayLogoPlates))for(const offset of [-20,0,20])for(const [iw,ih]of [[600,200],[200,600],[1,1]]){
    const data={...enabled,[prefix+'anchor']:anchor,[prefix+'plate']:plate,[prefix+'x']:offset,[prefix+'y']:offset,[prefix+'size']:25};
    const layout=overlayLogoGeometry(data,width,height,iw,ih),safe=layout.safe,box=layout.plate;
    assert.ok(box.x>=safe.x-1e-8&&box.y>=safe.y-1e-8&&box.x+box.w<=safe.x+safe.w+1e-8&&box.y+box.h<=safe.y+safe.h+1e-8);
    assert.ok(Math.abs(layout.image.w/layout.image.h-iw/ih)<1e-8);assert.ok(Math.abs(layout.x)<=20&&Math.abs(layout.y)<=20);
  }
  const clamped=overlayLogoGeometry({...enabled,[prefix+'anchor']:'top-right',[prefix+'x']:20,[prefix+'y']:-20},1920,1080,600,200);
  assert.equal(clamped.x,0);assert.equal(clamped.y,0);
});
test('entry follows the output clock and finishes transparent before every terminal hold',()=>{
  for(const motion of ['none','fade','slide']){
    const data={...enabled,[prefix+'motion']:motion,[prefix+'delay']:1};
    assert.equal(overlayLogoMotion(data,.99,10).opacity,0);assert.equal(overlayLogoMotion(data,2,10).opacity,1);
    assert.ok(overlayLogoMotion(data,9.8,10).opacity>0&&overlayLogoMotion(data,9.8,10).opacity<1);
    assert.equal(overlayLogoMotion(data,9.96,10).opacity,0);assert.equal(overlayLogoMotion(data,10.16,10).opacity,0);
    assert.equal(overlayLogoMotion({...data,[prefix+'enabled']:false},2,10).opacity,0);
  }
  for(const template of broadcastTemplates)for(const format of Object.keys(PRESENTATIONS)){
    const timeline=makeTimeline(template.id,{_out_mode:'duration',_out_duration_seconds:30,_studio_format:format},{},30),end=timeline.outAt+timeline.timing.out;
    assert.equal(overlayLogoMotion(enabled,end-.04,end).opacity,0);
    assert.equal(overlayLogoMotion(enabled,timeline.duration-.04,end).opacity,0);
  }
});

const originalImage=Object.getOwnPropertyDescriptor(globalThis,'Image'),originalDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
afterEach(()=>{for(const [key,value]of [['Image',originalImage],['document',originalDocument]] as const)if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key);});
function fixture(){
  class Node{
    children:Node[]=[];parentNode:Node|null=null;style={visibility:'',cssText:''};attrs:Record<string,string>={};
    append(...nodes:Node[]){for(const node of nodes){node.remove();this.children.push(node);node.parentNode=this;}}
    remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this);this.parentNode=null;}
    setAttribute(key:string,value:string){this.attrs[key]=value;}
  }
  const images:ControlledImage[]=[];
  class ControlledImage{
    src='';currentSrc='';crossOrigin='';loading='';decoding='';complete=false;naturalWidth=0;naturalHeight=0;removed=false;
    onload:(()=>void)|null=null;onerror:(()=>void)|null=null;resolve:()=>void=()=>{};
    constructor(){images.push(this);}
    decode(){return new Promise<void>(resolve=>{this.resolve=resolve;});}
    ready(){this.complete=true;this.naturalWidth=600;this.naturalHeight=200;this.resolve();}
    removeAttribute(key:string){if(key==='src'){this.src='';this.removed=true;}}
  }
  Object.defineProperty(globalThis,'Image',{configurable:true,value:ControlledImage});
  Object.defineProperty(globalThis,'document',{configurable:true,value:{baseURI:base,createElementNS:()=>new Node()}});
  const calls:ProjectData[]=[];let nativeDisposals=0;const audio={identity:'audio-not-managed-by-logo'};
  const graphic=Object.assign(new EventTarget(),{
    shadowRoot:new Node(),state:{phase:'ready'},audio,
    load:async({data}:{data:ProjectData})=>{calls.push(data);return {statusCode:200};},
    updateAction:async(data:ProjectData)=>{calls.push(data);return {statusCode:200};},
    playAction:async()=>({statusCode:200}),stopAction:async()=>({statusCode:200}),goToTime:async()=>({statusCode:200}),
    dispose:async()=>{nativeDisposals++;},_times:()=>({elapsed:2}),
  });
  const g=graphic as unknown as LegacyGraphic,template={id:'BTV_BA_1P',module} as BroadcastTemplate;
  return {g,graphic,images,calls,audio,template,disposals:()=>nativeDisposals};
}
test('disabled loads allocate no image and strip only logo keys before the immutable engine',async()=>{
  const f=fixture(),data={...enabled,[prefix+'enabled']:false,_audio_voice_enabled:true,_audio_voice_url:'voice.wav',_sponsor_visible:true};
  installOverlayLogo(f.g,f.template,data);await f.g.load({data});
  assert.equal(f.images.length,0);assert.ok(Object.keys(f.calls[0]).every(key=>!overlayLogoKey(key)));
  assert.equal(f.calls[0]._audio_voice_url,'voice.wav');assert.equal(f.calls[0]._sponsor_visible,true);assert.equal(f.g.audio,f.audio);
  await f.g.dispose();assert.equal(f.disposals(),1);
});
test('replacement cancels the in-flight image, ignores its late result and never affects audio',async()=>{
  const f=fixture();installOverlayLogo(f.g,f.template,overlayLogoDefaults);
  const first=f.g.updateAction(enabled),firstRejected=assert.rejects(first,{name:'AbortError'});
  const second=f.g.updateAction({...enabled,[prefix+'url']:'/new.png'});assert.equal(f.images.length,2);assert.ok(f.images[0].removed);
  f.images[1].ready();await second;await firstRejected;f.images[0].ready();await Promise.resolve();
  assert.equal(f.calls.length,1);assert.equal(f.g.audio,f.audio);assert.equal(f.g.__studioLogo.layout().image.w>0,true);
  await f.g.dispose();assert.ok(f.images[1].removed);
});
test('text-only update reuses the image and reconnects an overlay removed by the native scene',async()=>{
  const f=fixture();installOverlayLogo(f.g,f.template,enabled);
  const loading=f.g.load({data:enabled});f.images[0].ready();await loading;
  const svg=f.graphic.shadowRoot.children[0];assert.equal(svg.style.visibility,'hidden');
  f.g.__studioLogo.refresh({seconds:2,end:10,visible:true});assert.equal(svg.style.visibility,'visible');
  svg.remove();await f.g.updateAction({_title:'Changed'});
  assert.equal(f.images.length,1);assert.equal(f.graphic.shadowRoot.children[0],svg);
  f.g.__studioLogo.refresh({seconds:9.96,end:10,visible:true});assert.equal(svg.style.visibility,'hidden');
  await f.g.updateAction({[prefix+'enabled']:false});assert.equal(f.images.length,1);assert.ok(f.images[0].removed);assert.equal(svg.style.visibility,'hidden');
  assert.equal(f.g.__studioLogo.layout(),undefined);await f.g.dispose();
});
test('closing during image decode rejects promptly, clears the source and never reaches the engine',async()=>{
  const f=fixture();installOverlayLogo(f.g,f.template,enabled);
  const loading=f.g.load({data:enabled}),rejected=assert.rejects(loading,{name:'AbortError'});await f.g.dispose();await rejected;
  assert.ok(f.images[0].removed);assert.equal(f.calls.length,0);assert.equal(f.g.__studioLogo,undefined);
  await assert.rejects(f.g.updateAction(enabled),{name:'AbortError'});assert.equal(f.images.length,1);
});
test('image failure is explicit and an aborted standalone load releases handlers',async()=>{
  const f=fixture(),controller=new AbortController(),loading=prepareOverlayLogo(f.template,enabled,controller.signal);
  f.images[0].onerror?.();await assert.rejects(loading,/ne peut pas être décodé/);assert.ok(f.images[0].removed);
  const retry=prepareOverlayLogo(f.template,enabled,controller.signal);controller.abort();await assert.rejects(retry,{name:'AbortError'});
  assert.equal(f.images[1].onload,null);assert.equal(f.images[1].onerror,null);assert.ok(f.images[1].removed);
});
test('social painting uses the same geometry and restores the canvas state without audio access',()=>{
  const f=fixture(),image=new Image();Object.assign(image,{naturalWidth:600,naturalHeight:200});const calls:any[]=[];
  const ctx={canvas:{width:1080,height:1920},globalAlpha:.2,save(){calls.push(['save']);},setTransform(...args:any[]){calls.push(['transform',...args]);},translate(...args:any[]){calls.push(['translate',...args]);},drawImage(...args:any[]){calls.push(['draw',...args]);},restore(){calls.push(['restore']);}} as unknown as CanvasRenderingContext2D;
  drawOverlayLogo(ctx,enabled,image,2,10);const layout=overlayLogoGeometry(enabled,1080,1920,600,200);
  assert.deepEqual(calls.find(([name])=>name==='draw'),['draw',image,layout.image.x,layout.image.y,layout.image.w,layout.image.h]);assert.equal(calls.at(-1)[0],'restore');
  const count=calls.length;drawOverlayLogo(ctx,enabled,image,9.96,10);drawOverlayLogo(ctx,{...enabled,[prefix+'enabled']:false},image,2,10);assert.equal(calls.length,count);assert.equal(f.images.length,1);
});
