import {test,beforeEach,afterEach,mock} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {getTemplate,templateDefaults} from '../src/studio/domain';
import type {Project} from '../src/studio/domain';
import type {DerivationOrigin} from '../src/studio/derivation-types';
import {sessionState} from '../src/studio/session-state';
import {localBindings,localBlob} from '../src/studio/local-files';
import {cropForClip,patchClipCrop} from '../src/studio/sequence-crop';

// A pending digest must not gate rendering. This worker deliberately never
// completes, so success cannot accidentally depend on a fast fixture hash.
class PendingWorker{
  onmessage:((event:{data:unknown})=>void)|null=null;onerror:((event:unknown)=>void)|null=null;
  postMessage(){}terminate(){}
}
const events=new EventTarget();Object.assign(globalThis,{Worker:PendingWorker,window:events});
const media=await import('../src/studio/local-media');
const {videoSnapshot,bindVideoSession}=await import('../src/studio/video-snapshot');
const {exportSnapshot}=await import('../src/studio/export-snapshot');
const template=getTemplate('BTV_PopUp'),id='00000000-0000-4000-8000-000000000001';
function project():Project{return {id,title:'Titre privé non enregistré',template_id:template.id,template_version:template.version,library_version:template.libraryVersion,revision:1,status:'draft',archived:0,created_at:'',updated_at:'',created_by:'test',updated_by:'test',data:templateDefaults(template)};}
const task=()=>new AbortController();
function resources(saved:Project,head?:(path:string,init:RequestInit)=>Response|Promise<Response>,provenance?:DerivationOrigin|Response){
  return mock.method(globalThis,'fetch',async(input:string|URL|Request,init:RequestInit={})=>{
    init.signal?.throwIfAborted();
    if(String(input)===`/api/graphics/projects/${id}`)return Response.json(saved);
    if(String(input)===`/api/graphics/projects/${id}/derivation-origin`)return provenance instanceof Response?provenance:provenance?Response.json(provenance):Response.json({error:'Provenance absente'},{status:404});
    assert.equal(init.method,'HEAD');assert.equal(init.body,undefined);
    assert.equal(init.credentials,'same-origin');assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');
    return head?head(String(input),init):new Response(null,{headers:{'Content-Type':'image/png'}});
  });
}
beforeEach(()=>sessionState.open());
afterEach(()=>{events.dispatchEvent(new Event('srtb-local-media-clear'));mock.restoreAll();sessionState.end('logout');});

test('batch snapshot rejects an archive that happened after the displayed receipt, before media reads',async()=>{
  const draft=project(),saved={...structuredClone(draft),archived:1,revision:2};
  const fetches=resources(saved);
  await assert.rejects(videoSnapshot(draft,task().signal,{rejectArchived:true}),/archivé/);
  assert.equal(fetches.mock.calls.length,1);
  // Single-project read-only exports keep their existing, independently chosen policy.
  await videoSnapshot(draft,task().signal);
});

test('video snapshots a selected File before SHA completes without transmitting draft metadata',async()=>{
  const draft=project(),saved=structuredClone(draft),file=new File(['local-only-media'],'confidentiel.mp4',{type:'video/mp4'});
  const selection=media.beginLocalFile(file,()=>{});draft.data._media_popup_url=selection.descriptor;
  const fetches=resources(saved),pending=videoSnapshot(draft,task().signal);
  draft.title='Modification suivante';draft.data._media_popup_url='lib/media/default-popup.png';
  const snapshot=await pending,descriptor=snapshot.data._media_popup_url as {url:string;name:string};
  assert.equal(descriptor.url,selection.descriptor.url);assert.equal(descriptor.name,file.name);
  assert.equal(localBlob(descriptor.url),file);assert.notEqual(media.localFingerprintState(descriptor.url)?.status,'ready');
  assert.match(snapshot.filename,new RegExp(`^${template.id}_${id}_export_[a-f0-9]{8}$`));
  for(const call of fetches.mock.calls){
    const [path,init]=call.arguments as [string,RequestInit];
    assert.ok(!init.method||['GET','HEAD'].includes(init.method));assert.equal(init.body,undefined);
    assert.equal(path.includes('blob:'),false);assert.equal(path.includes(file.name),false);assert.equal(path.includes('Titre'),false);
  }
  assert.equal(fetches.mock.calls.filter(call=>String(call.arguments[0]).includes('/export')).length,0);
  assert.equal(saved.data._media_popup_url,'lib/media/default-popup.png');
  // The separate HTML/save boundary remains content-pinned.
  const unverified={...project(),data:{...templateDefaults(template),_media_popup_url:selection.descriptor}};
  assert.throws(()=>exportSnapshot(unverified,task().signal),/contrôle des médias locaux/);
});

test('video preserves clip marks while the local digest is still pending',async()=>{
  const draft=project(),file=new File(['local-only-media'],'clip.mp4',{type:'video/mp4'}),selection=media.beginLocalFile(file,()=>{});
  draft.data._media_popup_sequence=JSON.stringify([{url:selection.descriptor,start:1.24,end:2.4}]);
  resources(project());const snapshot=await videoSnapshot(draft,task().signal);
  assert.deepEqual(JSON.parse(String(snapshot.data._media_popup_sequence)),[{url:selection.descriptor,start:1.24,end:2.4}]);
  assert.equal(snapshot.data._media_popup_url,'');
});

for(const verified of [false,true])test(`video snapshot keeps passage crops through local aliases (verified=${verified})`,async()=>{
  const draft=project(),file=new File(['crop-media'],'clip.mp4',{type:'video/mp4'});
  const url=verified?URL.createObjectURL(file):media.beginLocalFile(file,()=>{}).descriptor.url;
  const reference=verified?`local-media:${createHash('sha256').update('crop-media').digest('hex')}:${file.size}`:url;
  if(verified)localBindings.set(reference,{file,url});
  const clip={url:{url:reference,name:file.name,mimeType:file.type},start:1.24,end:2.4};
  draft.data={...draft.data,_studio_format:'vertical',_media_popup_sequence:JSON.stringify([clip])};
  Object.assign(draft.data,patchClipCrop(draft.data,'popup',clip,0,{_studio_popup_x:17,_studio_popup_y:89}));
  const before=JSON.stringify(draft.data),fetches=resources(project()),snapshot=await videoSnapshot(draft,task().signal);
  const resolved=JSON.parse(String(snapshot.data._media_popup_sequence))[0];
  assert.equal(resolved.url.url,url);assert.equal(cropForClip(snapshot.data,'popup',resolved,0)?.x,17);
  assert.equal(cropForClip(snapshot.data,'popup',resolved,0)?.y,89);assert.equal(JSON.stringify(draft.data),before);
  onlyReadRequests(fetches);
});

test('video snapshot preserves passage crop binding when resolving a relative template image',async()=>{
  const draft=project(),clip={url:'lib/media/default-popup.png',start:0,end:5};
  draft.data={...draft.data,_studio_format:'portrait',_media_popup_sequence:JSON.stringify([clip])};
  Object.assign(draft.data,patchClipCrop(draft.data,'popup',clip,0,{_studio_popup_x:82,_studio_popup_y:28}));
  const fetches=resources(project()),snapshot=await videoSnapshot(draft,task().signal);
  const resolved=JSON.parse(String(snapshot.data._media_popup_sequence))[0];
  assert.match(resolved.url,/^\/library\//);assert.equal(cropForClip(snapshot.data,'popup',resolved,0)?.x,82);
  assert.equal(cropForClip(snapshot.data,'popup',resolved,0)?.y,28);onlyReadRequests(fetches);
});

test('video also resolves a previously verified local reference without starting a new digest',async()=>{
  const draft=project(),file=new File(['verified-media'],'verified.mp4',{type:'video/mp4'}),url=URL.createObjectURL(file);
  const reference=`local-media:${createHash('sha256').update('verified-media').digest('hex')}:${file.size}`;
  localBindings.set(reference,{file,url});draft.data._media_popup_url={url:reference,name:file.name,mimeType:file.type};
  resources(project());const snapshot=await videoSnapshot(draft,task().signal);
  assert.deepEqual(snapshot.data._media_popup_url,{url,name:file.name,mimeType:file.type});
  assert.equal(localBlob(url),file);assert.equal((draft.data._media_popup_url as {url:string}).url,reference);
  assert.equal(media.localFingerprintState(url),undefined);
});

test('video refuses unbound blobs, missing local sources and unsafe URLs before any request',async()=>{
  const fetches=resources(project());
  for(const url of ['blob:https://studio.example/not-selected',`local-media:${'a'.repeat(64)}:10`,'https://other.example/private.mp4','lib/%2e%2e/private.mp4','/api/graphics/media/a/content']){
    const draft=project();draft.data._media_popup_url={url,name:'source.mp4',mimeType:'video/mp4'};
    await assert.rejects(videoSnapshot(draft,task().signal));
  }
  assert.equal(fetches.mock.callCount(),0);
});

const programme='/library/v1.7.0/BTV_BA_1P/lib/media/programme.mp4';
const slowClip='/library/v1.7.0/BTV_BA_1P/lib/media/prepared/native-v102/slow-25b341c2aeb35dc28530.mp4';
const sponsor='/library/v1.7.0/BTV_BA_1P/lib/media/sponsor.png';
function linkedOrigin(allowedLibraryUrls:string[]):DerivationOrigin{
  const source=getTemplate('BTV_BA_1P');
  return {batchId:'00000000-0000-4000-8000-000000000002',sourceProjectId:'00000000-0000-4000-8000-000000000003',sourceRevision:1,sourceTemplateId:source.id,sourceTemplateVersion:source.version,sourceLibraryVersion:source.libraryVersion,sourceSnapshotSha256:'a'.repeat(64),allowedLibraryUrls};
}
function onlyReadRequests(fetches:ReturnType<typeof resources>){
  for(const call of fetches.mock.calls){const [,init]=call.arguments as [string,RequestInit];assert.equal(init.body,undefined);assert.ok(!init.method||init.method==='GET'||init.method==='HEAD');}
}
function noHead(fetches:ReturnType<typeof resources>){assert.equal(fetches.mock.calls.filter(call=>call.arguments[1]?.method==='HEAD').length,0);onlyReadRequests(fetches);}

test('own-template library resources do not require a derivation origin and retain their normal HEAD checks',async()=>{
  const draft=project(),path=`/library/v${template.libraryVersion}/${template.id}/lib/media/default-popup.png`;
  draft.data._media_popup_url=path;
  const fetches=resources(project()),snapshot=await videoSnapshot(draft,task().signal);
  assert.equal(snapshot.data._media_popup_url,path);
  assert.ok(fetches.mock.calls.some(call=>call.arguments[0]===path&&call.arguments[1]?.method==='HEAD'));
  assert.equal(fetches.mock.calls.some(call=>String(call.arguments[0]).endsWith('/derivation-origin')),false);onlyReadRequests(fetches);
});

for(const status of [404,403,401,503])test(`foreign resources require authenticated provenance before any HEAD: origin HTTP ${status}`,async()=>{
  const draft=project();draft.data._media_popup_url=programme;
  const fetches=resources(project(),undefined,Response.json({error:'Provenance indisponible'},{status}));
  await assert.rejects(videoSnapshot(draft,task().signal),{status});noHead(fetches);
  assert.deepEqual(fetches.mock.calls.map(call=>String(call.arguments[0])),[`/api/graphics/projects/${id}`,`/api/graphics/projects/${id}/derivation-origin`]);
  assert.equal(sessionState.snapshot().ended,status===401);
});

test('an absent origin never triggers a media HEAD or an export POST',async()=>{
  const draft=project();draft.data._media_popup_url=programme;
  const fetches=resources(project());await assert.rejects(videoSnapshot(draft,task().signal),{status:404});noHead(fetches);
});

test('exact same-library provenance permits programme and prepared slow-clip sequences without sending draft metadata',async()=>{
  const draft=project();draft.data._media_popup_sequence=JSON.stringify([{url:programme,start:1,end:3},{url:slowClip,start:4,end:7}]);
  const fetches=resources(project(),path=>new Response(null,{headers:{'Content-Type':path.endsWith('.mp4')?'video/mp4':'image/png'}}),linkedOrigin([programme,slowClip]));
  const snapshot=await videoSnapshot(draft,task().signal);
  assert.deepEqual(JSON.parse(String(snapshot.data._media_popup_sequence)),[{url:programme,start:1,end:3},{url:slowClip,start:4,end:7}]);
  const calls=fetches.mock.calls.map(call=>({path:String(call.arguments[0]),method:call.arguments[1]?.method}));
  const provenanceIndex=calls.findIndex(call=>call.path.endsWith('/derivation-origin'));
  assert.ok(provenanceIndex>=0);assert.ok(calls.findIndex(call=>call.method==='HEAD')>provenanceIndex);
  for(const url of [programme,slowClip])assert.equal(calls.filter(call=>call.path===url&&call.method==='HEAD').length,1);
  onlyReadRequests(fetches);
});

test('a linked Tout de suite verifies both the original clip and custom sponsor through exact provenance',async()=>{
  const target=getTemplate('BTV_BA_TDS'),draft:Project={...project(),template_id:target.id,template_version:target.version,library_version:target.libraryVersion,data:{...templateDefaults(target),_media_background_url:programme,_background_visible:true,_sponsor_visible:true,_sponsor_logo:sponsor}};
  const fetches=resources(draft,path=>new Response(null,{headers:{'Content-Type':path.endsWith('.mp4')?'video/mp4':path.endsWith('.wav')?'audio/wav':'image/png'}}),linkedOrigin([programme,sponsor]));
  const snapshot=await videoSnapshot(draft,task().signal);
  assert.equal(snapshot.data._media_background_url,programme);assert.equal(snapshot.data._sponsor_logo,sponsor);
  for(const url of [programme,sponsor])assert.equal(fetches.mock.calls.filter(call=>String(call.arguments[0])===url&&call.arguments[1]?.method==='HEAD').length,1);
  onlyReadRequests(fetches);
});

test('a valid provenance cannot authorize an unlisted foreign asset, even when another selected asset is allowed',async()=>{
  const draft=project();draft.data._media_popup_sequence=JSON.stringify([{url:programme,start:0,end:2},{url:slowClip,start:0,end:2}]);
  const fetches=resources(project(),undefined,linkedOrigin([programme]));
  await assert.rejects(videoSnapshot(draft,task().signal),/n’appartient pas à cette déclinaison/);noHead(fetches);
});

test('another library version is rejected before project/origin/media requests',async()=>{
  const draft=project();draft.data._media_popup_url=programme.replace('/v1.7.0/','/v1.8.0/');
  const fetches=resources(project(),undefined,linkedOrigin([String(draft.data._media_popup_url)]));
  await assert.rejects(videoSnapshot(draft,task().signal),/autre version de la bibliothèque/);assert.equal(fetches.mock.callCount(),0);
});

test('mismatched or malformed provenance remains fail-closed before media HEAD requests',async()=>{
  const draft=project();draft.data._media_popup_url=programme;
  for(const provenance of [Response.json({...linkedOrigin([programme]),sourceLibraryVersion:'1.8.0'}),Response.json({}),Response.json({...linkedOrigin([programme]),allowedLibraryUrls:'all'}),new Response('{',{headers:{'Content-Type':'application/json'}})]){
    mock.restoreAll();const fetches=resources(project(),undefined,provenance);
    await assert.rejects(videoSnapshot(draft,task().signal));noHead(fetches);
  }
});

test('the server still denies an expired session and mismatched project versions',async()=>{
  const fetches=mock.method(globalThis,'fetch',async()=>Response.json({error:'Session expirée'},{status:401}));
  await assert.rejects(videoSnapshot(project(),task().signal),{status:401});assert.equal(sessionState.snapshot().ended,true);
  assert.equal(fetches.mock.callCount(),1);mock.restoreAll();sessionState.open();
  resources({...project(),template_version:'99.0.0'});
  await assert.rejects(videoSnapshot(project(),task().signal),/version originale/);
});

test('private media HEAD preserves 401, 403 and unfinished-transfer refusals',async()=>{
  const shared='/api/graphics/media/00000000-0000-4000-8000-000000000099/content';
  for(const status of [401,403,409]){
    mock.restoreAll();sessionState.open();const draft=project();draft.data._media_popup_url=shared;
    const fetches=resources(project(),path=>new Response(null,{status:path===shared?status:200,headers:{'Content-Type':'image/png'}}));
    await assert.rejects(videoSnapshot(draft,task().signal),{status});
    assert.ok(fetches.mock.calls.some(call=>String(call.arguments[0])===shared));
    assert.equal(sessionState.snapshot().ended,status===401);
  }
});

test('disabled media are not requested and a successful HTML fallback is rejected',async()=>{
  const draft=project();draft.data._background_visible=false;draft.data._media_background_url='/api/graphics/media/00000000-0000-4000-8000-000000000099/content';
  const fetches=resources(project());await videoSnapshot(draft,task().signal);
  assert.equal(fetches.mock.calls.some(call=>String(call.arguments[0]).includes('/media/00000000')),false);
  mock.restoreAll();resources(project(),()=>new Response(null,{headers:{'Content-Type':'text/html'}}));
  await assert.rejects(videoSnapshot(project(),task().signal),{status:422});
});

test('read-only video export accepts an older working copy without changing the saved archive',async()=>{
  const saved={...project(),revision:3,archived:1},before=JSON.stringify(saved),fetches=resources(saved);
  await videoSnapshot(project(),task().signal);assert.equal(JSON.stringify(saved),before);
  assert.ok(fetches.mock.calls.every(call=>!call.arguments[1]?.method||call.arguments[1].method==='HEAD'));
  await assert.rejects(videoSnapshot({...project(),revision:4},task().signal),/Révision de départ inconnue/);
});

test('cancellation and session changes stop preparation and the in-progress video task',async()=>{
  const cancelled=task();cancelled.abort();const fetches=resources(project());
  await assert.rejects(videoSnapshot(project(),cancelled.signal),{name:'AbortError'});assert.equal(fetches.mock.callCount(),0);
  mock.restoreAll();
  let reached!:()=>void;const waiting=new Promise<void>(resolve=>{reached=resolve;});
  resources(project(),(_path,init)=>new Promise<Response>((_resolve,reject)=>{
    init.signal!.addEventListener('abort',()=>reject(init.signal!.reason),{once:true});reached();
  }));
  const rendering=task(),stop=bindVideoSession(rendering),pending=videoSnapshot(project(),rendering.signal);
  await waiting;sessionState.end('logout');await assert.rejects(pending,{name:'AbortError'});assert.equal(rendering.signal.aborted,true);stop();
  sessionState.open();const changedAccount=task(),release=bindVideoSession(changedAccount);sessionState.open();assert.equal(changedAccount.signal.aborted,true);release();
});

test('an uncertain expiry suspends rendering but an ordinary temporary API error does not',async()=>{
  const rendering=task(),release=bindVideoSession(rendering),stop=sessionState.onDeadline(()=>{});
  try{
    resources(project(),()=>Response.json({error:'Service temporairement indisponible'},{status:503}));
    await assert.rejects(videoSnapshot(project(),rendering.signal),{status:503});assert.equal(rendering.signal.aborted,false);
    const epoch=sessionState.snapshot().epoch;sessionState.lifetime(0,epoch);
    assert.equal(rendering.signal.aborted,true);assert.equal(sessionState.current(epoch),true);assert.equal(sessionState.snapshot().ended,false);
    sessionState.lifetime(1000,epoch);assert.equal(rendering.signal.aborted,true,'a cancelled render never resumes automatically');
  }finally{release();stop();}
});
