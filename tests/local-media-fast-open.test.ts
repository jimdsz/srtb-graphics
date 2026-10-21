import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fingerprintStream} from '../src/studio/local-fingerprint-stream';
import {getTemplate,templateDefaults,validateProjectData} from '../src/studio/domain';
import {localBlob} from '../src/studio/local-files';
import {cropForClip,patchClipCrop} from '../src/studio/sequence-crop';

function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
// The worker adapter executes the production streaming digest against controllable
// slow streams. File bytes used by the preview are still real object URLs.
class StreamWorker{
  static instances:StreamWorker[]=[];onmessage:((event:{data:unknown})=>void)|null=null;onerror:((event:unknown)=>void)|null=null;
  controller=new AbortController();paused=false;resume:(()=>void)|undefined;terminated=false;
  constructor(){StreamWorker.instances.push(this);}
  postMessage(message:{type:string;file?:File}){
    if(message.type==='pause'){this.paused=true;return;}if(message.type==='resume'){this.paused=false;this.resume?.();return;}
    void fingerprintStream(message.file!,progress=>{if(!this.terminated)this.onmessage?.({data:{progress}});},this.controller.signal,async()=>{while(this.paused&&!this.controller.signal.aborted)await new Promise<void>(resolve=>{this.resume=resolve;});}).then(hash=>{if(!this.terminated)this.onmessage?.({data:{hash}});},error=>{if(!this.terminated)this.onmessage?.({data:{error:String(error)}});});
  }
  terminate(){this.terminated=true;this.controller.abort();this.resume?.();}
}
const events=new EventTarget();Object.assign(globalThis,{Worker:StreamWorker,window:events});
const handles=new Map<string,unknown>();
Object.assign(globalThis,{indexedDB:{open(){
  const request:any={};request.result={close(){},transaction(){const transaction:any={objectStore:()=>({put(value:unknown,key:string){return item(()=>{handles.set(key,value);return key;});},get(key:string){return item(()=>handles.get(key));}})};function item(operation:()=>unknown){const result:any={};queueMicrotask(()=>{result.result=operation();result.onsuccess?.();queueMicrotask(()=>transaction.oncomplete?.());});return result;}return transaction;}};
  queueMicrotask(()=>request.onsuccess?.());return request;
}}});
const media=await import('../src/studio/local-media');
afterEach(async()=>{events.dispatchEvent(new Event('srtb-local-media-clear'));await tick();StreamWorker.instances=[];handles.clear();});

function slowFile(text='abcdef',name='same.mp4'){
  const tail=deferred(),started=deferred();let cancelled=false,reads=0;
  const bytes=new TextEncoder().encode(text),file=new File([bytes],name,{type:'video/mp4',lastModified:1234});
  Object.defineProperty(file,'stream',{value:()=>new ReadableStream<Uint8Array>({async pull(controller){reads++;if(reads===1){controller.enqueue(bytes.slice(0,2));started.resolve();}else{await tail.promise;if(!cancelled){controller.enqueue(bytes.slice(2));controller.close();}}},cancel(){cancelled=true;}},{highWaterMark:0})});
  return {file,tail,started,get cancelled(){return cancelled;}};
}
const template=getTemplate('BTV_PopUp');
test('fresh local media previews before the delayed full digest, then persists only the stable reference',async()=>{
  const slow=slowFile(),selection=media.beginLocalFile(slow.file,()=>{});let verified=false;void selection.verified.then(()=>{verified=true;});
  const data={...templateDefaults(template),_media_popup_url:selection.descriptor,_media_popup_start_seconds:1,_media_popup_end_seconds:2};
  assert.match(selection.descriptor.url,/^blob:/);assert.equal(media.connectedLocal(selection.descriptor.url),true);
  assert.equal(localBlob(media.localURL(selection.descriptor.url)),slow.file);
  assert.equal(await fetch(media.localURL(selection.descriptor.url)).then(response=>response.text()),'abcdef');
  assert.doesNotThrow(()=>validateProjectData(template,media.resolveLocalData(template,validateProjectData(template,data,true)),true));
  await slow.started.promise;assert.equal(verified,false);assert.equal(media.pendingLocalReferences(template,data).length,1);
  assert.throws(()=>media.stableLocalData(template,data),/contrôle/);assert.throws(()=>validateProjectData(template,data));
  assert.equal(media.promoteVerifiedLocalData(template,data),data);
  slow.tail.resolve();const descriptor=await selection.verified;
  assert.equal(descriptor.url,`local-media:${createHash('sha256').update('abcdef').digest('hex')}:6`);
  const stable=media.stableLocalData(template,data);assert.deepEqual(stable._media_popup_url,descriptor);assert.equal(stable._media_popup_start_seconds,1);assert.equal(stable._media_popup_end_seconds,2);
  assert.equal(media.pendingLocalReferences(template,data).length,0);assert.doesNotThrow(()=>validateProjectData(template,stable));
  assert.equal(JSON.stringify(stable).includes('blob:'),false);assert.equal(media.localURL(descriptor.url),selection.descriptor.url);
});
test('duplicate selection shares work; one observer cancellation cannot invalidate another preview',async()=>{
  const slow=slowFile(),first=media.beginLocalFile(slow.file,()=>{}),second=media.beginLocalFile(slow.file,()=>{});
  assert.deepEqual(first.descriptor,second.descriptor);await slow.started.promise;assert.equal(StreamWorker.instances.length,1);
  first.cancel();await assert.rejects(first.verified,{name:'AbortError'});assert.equal(StreamWorker.instances[0].terminated,false);
  slow.tail.resolve();const stable=await second.verified;assert.equal(media.localURL(stable.url),first.descriptor.url);
  const duplicate=await media.bindLocalFile(new File(['abcdef'],'renamed.mp4',{type:'video/mp4'}),()=>{});
  assert.equal(duplicate.url,stable.url);assert.equal(media.localURL(duplicate.url),first.descriptor.url);
});
test('cancel stops the background read but leaves selected draft playable and unsaveable; clear revokes it',async()=>{
  const slow=slowFile(),selection=media.beginLocalFile(slow.file,()=>{});await slow.started.promise;selection.cancel();await assert.rejects(selection.verified,{name:'AbortError'});await tick();
  assert.equal(StreamWorker.instances[0].terminated,true);assert.equal(slow.cancelled,true);assert.equal(media.localFingerprintState(selection.descriptor.url)?.status,'cancelled');
  assert.equal(await fetch(media.localURL(selection.descriptor.url)).then(response=>response.text()),'abcdef');
  assert.throws(()=>media.stableLocalData(template,{...templateDefaults(template),_media_popup_url:selection.descriptor}),/contrôle/);
  events.dispatchEvent(new Event('srtb-local-media-clear'));assert.equal(media.connectedLocal(selection.descriptor.url),false);assert.throws(()=>media.localURL(selection.descriptor.url),/manque/);await assert.rejects(fetch(selection.descriptor.url));slow.tail.resolve();
});
test('remembered handles reconnect only after complete matching bytes; identical metadata cannot substitute contents',async()=>{
  let source=new File(['abcdef'],'same.mp4',{type:'video/mp4',lastModified:1234});
  const handle={queryPermission:async()=> 'granted',getFile:async()=>source} as any;
  const selection=media.beginLocalFile(source,()=>{},handle),stable=await selection.verified;
  assert.equal(handles.get(stable.url),handle);events.dispatchEvent(new Event('srtb-local-media-clear'));assert.equal(media.connectedLocal(stable.url),false);
  const slow=slowFile();source=slow.file;const restored=media.restoreLocal(stable.url,()=>{});await slow.started.promise;assert.equal(media.connectedLocal(stable.url),false);
  slow.tail.resolve();assert.equal(await restored,true);assert.equal(media.connectedLocal(stable.url),true);
  const connected=media.localURL(stable.url);source=new File(['fedcba'],'same.mp4',{type:'video/mp4',lastModified:1234});
  await assert.rejects(media.restoreLocal(stable.url,()=>{}),/diffère/);assert.equal(media.localURL(stable.url),connected);
  events.dispatchEvent(new Event('srtb-local-media-clear'));await assert.rejects(media.restoreLocal(stable.url,()=>{}),/diffère/);assert.equal(media.connectedLocal(stable.url),false);
});
test('hidden sequence references must finish verification, and promotion preserves clip marks and user names',async()=>{
  const slow=slowFile(),selection=media.beginLocalFile(slow.file,()=>{}),data={...templateDefaults(template),_media_popup_sequence:JSON.stringify([{url:{...selection.descriptor,name:'Custom.mp4'},start:1,end:2}]),_media_popup_url:''};
  assert.equal(media.pendingLocalReferences(template,data).length,1);assert.throws(()=>media.stableLocalData(template,data),/contrôle/);
  slow.tail.resolve();const stable=await selection.verified,promoted=media.promoteVerifiedLocalData(template,data);
  assert.deepEqual(JSON.parse(String(promoted._media_popup_sequence)),[{url:{...stable,name:'Custom.mp4'},start:1,end:2}]);
  assert.equal(media.promoteVerifiedLocalData(template,promoted),promoted);
});

test('passage crops survive pending blob, verified reference, saved data and reopened preview aliases',async()=>{
  const slow=slowFile(),selection=media.beginLocalFile(slow.file,()=>{}),clip={url:selection.descriptor,start:1,end:2};
  const data={...templateDefaults(template),_studio_format:'vertical',_media_popup_sequence:JSON.stringify([clip]),_media_popup_url:''};
  Object.assign(data,patchClipCrop(data,'popup',clip,0,{_studio_popup_x:22,_studio_popup_y:73}));
  const bound=(value:typeof data)=>cropForClip(value,'popup',JSON.parse(String(value._media_popup_sequence))[0],0);
  assert.equal(bound(media.resolveLocalData(template,data) as typeof data)?.x,22);
  assert.throws(()=>media.stableLocalData(template,data),/contrôle/);
  slow.tail.resolve();await selection.verified;
  const promoted=media.promoteVerifiedLocalData(template,data) as typeof data,stable=media.stableLocalData(template,promoted) as typeof data;
  assert.equal(bound(promoted)?.x,22);assert.equal(bound(stable)?.y,73);
  assert.equal(JSON.stringify(stable).includes('blob:'),false);
  assert.doesNotThrow(()=>validateProjectData(template,stable));
  const reopened=media.resolveLocalData(template,stable) as typeof data;
  assert.equal(bound(reopened)?.x,22);assert.equal(bound(reopened)?.y,73);
  assert.equal(JSON.parse(String(reopened._media_popup_sequence))[0].url.url,selection.descriptor.url);
});
test('render priority pauses existing work and prevents queued readers until rendering ends',async()=>{
  const slow=slowFile(),selection=media.beginLocalFile(slow.file,()=>{});await slow.started.promise;
  events.dispatchEvent(new Event('srtb-render-start'));assert.equal(media.localFingerprintState(selection.descriptor.url)?.status,'paused');
  const next=media.beginLocalFile(new File(['another'],'b.mp4',{type:'video/mp4'}),()=>{});assert.equal(StreamWorker.instances.length,1);
  events.dispatchEvent(new Event('srtb-render-end'));assert.equal(media.localFingerprintState(selection.descriptor.url)?.status,'hashing');
  slow.tail.resolve();await Promise.all([selection.verified,next.verified]);assert.equal(StreamWorker.instances.length,2);
});
test('draft cleanup cancels removed hidden clips while preserving retained clips, playback URLs and reconnect tasks',async()=>{
  const reconnect=slowFile('oldref'),reconnecting=media.bindLocalFile(reconnect.file,()=>{});await reconnect.started.promise;
  const removed=media.beginLocalFile(new File(['removed'],'removed.mp4',{type:'video/mp4'}),()=>{}),retained=media.beginLocalFile(new File(['retained'],'retained.mp4',{type:'video/mp4'}),()=>{});
  const data={...templateDefaults(template),_media_popup_sequence:JSON.stringify([{url:removed.descriptor,start:1,end:2},{url:retained.descriptor,start:3,end:4}])};
  const next={...data,_media_popup_sequence:JSON.stringify([{url:retained.descriptor,start:3,end:4}])};
  assert.equal(media.cancelUnusedLocalFingerprints(template,data,data),0);assert.equal(media.cancelUnusedLocalFingerprints(template,data,next),1);
  await assert.rejects(removed.verified,{name:'AbortError'});assert.equal(StreamWorker.instances[0].terminated,false);assert.equal(media.connectedLocal(removed.descriptor.url),true);
  reconnect.tail.resolve();await Promise.all([reconnecting,retained.verified]);assert.equal(StreamWorker.instances.length,2);
});
