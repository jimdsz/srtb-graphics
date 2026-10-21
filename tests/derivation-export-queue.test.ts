import test from 'node:test';
import assert from 'node:assert/strict';
import {createDerivationExportQueue} from '../src/studio/derivation-export-queue';
import type {DerivationExportDependencies,DerivationExportEntry,DerivationExportState} from '../src/studio/derivation-export-queue';
import {getTemplate,templateDefaults} from '../src/studio/domain';
import {bindVideoSession} from '../src/studio/video-snapshot';
import {sessionState} from '../src/studio/session-state';
import type {VideoFormat,VideoProgress,VideoReport} from '../src/studio/video/export';

const template=getTemplate('BTV_PopUp');
function entry(key='a',format:VideoFormat='mp4'):DerivationExportEntry{
  return {key,project:{id:'00000000-0000-4000-8000-'+key.charCodeAt(0).toString(16).padStart(12,'0'),title:key,template_id:template.id,template_version:template.version,library_version:template.libraryVersion,revision:3,status:'draft',archived:0,created_at:'',updated_at:'',created_by:'test',updated_by:'test',data:{...templateDefaults(template),_title:key}},options:{format,manualOut:12,audio:false,removeBackground:false,background:'#000000'}};
}
function deferred<T=void>(){let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function output(format:VideoFormat='mp4',dispose:()=>Promise<void>=async()=>{}){
  const blob=new Blob(['local artifact'],{type:'video/mp4'}),report:VideoReport={format,width:1920,height:1080,fps:25,frames:50,duration:2,audio:false,audioPeak:0,alpha:format!=='mp4',bytes:blob.size,checkedFrames:[0,49]};
  return {blob,report,dispose};
}
function setup(overrides:Partial<DerivationExportDependencies>={},onChange?:(state:DerivationExportState)=>void){
  const preflight:string[]=[],rendered:string[]=[],events:string[]=[],states:DerivationExportState[]=[];let releases=0,disposed=0;
  const queue=createDerivationExportQueue({onChange:state=>{states.push(state);onChange?.(state);},deps:{
    snapshot:async project=>{preflight.push(project.title);return {template,data:structuredClone(project.data),filename:'result-'+project.title};},
    render:async(_template,data,options,_signal,progress)=>{rendered.push(String(data._title));progress({percent:37,message:'Image réelle 12 / 50'});return output(options.format,async()=>{disposed++;});},
    bindSession:()=>()=>{releases++;},events:name=>{events.push(name);},...overrides,
  }});
  return {queue,preflight,rendered,events,states,releases:()=>releases,disposed:()=>disposed};
}

test('configuration freezes independent project revisions, descriptors and options',async()=>{
  const input=entry(),h=setup();input.project.data._media_popup_url={url:'local-media:'+'a'.repeat(64)+':1',name:'original.png',mimeType:'image/png'};
  h.queue.configure([input]);input.project.revision=99;input.project.title='changed';input.options.format='mov';
  (input.project.data._media_popup_url as {name:string}).name='changed.png';
  const item=h.queue.snapshot().items[0];assert.equal(item.project.revision,3);assert.equal(item.project.title,'a');assert.equal(item.options.format,'mp4');
  assert.equal((item.project.data._media_popup_url as {name:string}).name,'original.png');
  assert.throws(()=>{item.project.data._title='mutated';},TypeError);
  await h.queue.run();assert.deepEqual(h.preflight,['a']);assert.deepEqual(h.rendered,['a']);await h.queue.dispose();
});

test('configuration validates the eight-item cap, unique keys, options and explicit r1 atomically',()=>{
  const h=setup();h.queue.configure([entry()]);
  for(const input of [Array.from({length:9},(_,n)=>entry(String.fromCharCode(97+n))),[entry(),entry()],[{...entry(),key:''}],[{...entry(),revisionSource:'initial' as const}],[{...entry(),options:{...entry().options,manualOut:NaN}}],[{...entry(),options:{...entry().options,format:'constructor' as VideoFormat}}]])assert.throws(()=>h.queue.configure(input));
  assert.equal(h.queue.snapshot().items[0].key,'a');
  const initial=entry();initial.project.revision=1;initial.revisionSource='initial';h.queue.configure([initial]);assert.equal(h.queue.snapshot().items[0].revisionSource,'initial');
  h.queue.configure(Array.from({length:8},(_,n)=>entry(String.fromCharCode(97+n))));assert.equal(h.queue.snapshot().items.length,8);
});

test('all selected preflights finish before the first export, which runs sequentially',async()=>{
  const lastStarted=deferred(),lastReady=deferred(),trace:string[]=[];let concurrent=0,peak=0;
  const h=setup({snapshot:async project=>{trace.push('check:'+project.title);if(project.title==='c'){lastStarted.resolve();await lastReady.promise;}return {template,data:project.data,filename:project.title};},render:async(_t,data,opts)=>{trace.push('render:'+data._title);peak=Math.max(peak,++concurrent);await Promise.resolve();concurrent--;return output(opts.format);}});
  h.queue.configure([entry('a'),entry('b'),entry('c')]);const running=h.queue.run();await lastStarted.promise;
  assert.deepEqual(trace,['check:a','check:b','check:c']);assert.equal(h.queue.snapshot().phase,'preflight');lastReady.resolve();
  const state=await running;assert.deepEqual(trace,['check:a','check:b','check:c','render:a','render:b','render:c']);assert.equal(peak,1);
  assert.ok(state.items.every(item=>item.status==='completed'));assert.equal(state.running,false);assert.deepEqual(h.events,['srtb-render-start','srtb-render-end']);assert.equal(h.releases(),1);await h.queue.dispose();
});

test('a failed preflight verifies the other selections but prevents every render',async()=>{
  const checks:string[]=[],h=setup({snapshot:async project=>{checks.push(project.title);if(project.title==='b')throw Error('Reconnecter le fichier');return {template,data:project.data,filename:project.title};}});
  h.queue.configure([entry('a'),entry('b'),entry('c')]);const state=await h.queue.run();
  assert.deepEqual(checks,['a','b','c']);assert.deepEqual(h.rendered,[]);assert.deepEqual(state.items.map(item=>item.status),['pending','failed','pending']);assert.match(state.items[1].error!,/Reconnecter/);
  assert.deepEqual(h.events,['srtb-render-start','srtb-render-end']);assert.equal(h.releases(),1);
});

test('double click shares the same run promise and cannot duplicate preflight or export',async()=>{
  const started=deferred(),ready=deferred(),h=setup({snapshot:async project=>{started.resolve();await ready.promise;return {template,data:project.data,filename:project.title};}});
  h.queue.configure([entry()]);const first=h.queue.run(),second=h.queue.run();assert.equal(first,second);await started.promise;
  assert.throws(()=>h.queue.configure([entry('b')]),/fin ou l’annulation/);ready.resolve();await first;assert.deepEqual(h.rendered,['a']);await h.queue.dispose();
});

test('render progress is the real encoder progress, not a fabricated timer',async()=>{
  const h=setup();h.queue.configure([entry()]);await h.queue.run();
  const progress=h.states.find(state=>state.items[0]?.progress.percent===37);assert.ok(progress);assert.equal(progress.items[0].progress.message,'Image réelle 12 / 50');assert.equal(progress.items[0].status,'rendering');
  assert.equal(h.queue.snapshot().items[0].progress.percent,100);await h.queue.dispose();
});

test('render failure preserves successes and explicit retry renders only failures from frozen inputs',async()=>{
  const seen:{title:string;format:VideoFormat}[]=[],input=[entry('a'),entry('b'),entry('c')];let failed=false;
  const h=setup({render:async(_t,data,opts)=>{seen.push({title:String(data._title),format:opts.format});if(data._title==='b'&&!failed){failed=true;throw Error('Temporary encoder failure');}return output(opts.format);}});
  h.queue.configure(input);let state=await h.queue.run();assert.deepEqual(state.items.map(item=>item.status),['completed','failed','completed']);
  const first=state.items[0].result;input[1].options.format='mov';input[1].project.data._title='edited later';state=await h.queue.run();
  assert.deepEqual(seen,[{title:'a',format:'mp4'},{title:'b',format:'mp4'},{title:'c',format:'mp4'},{title:'b',format:'mp4'}]);assert.equal(state.items[0].result,first);
  assert.deepEqual(h.preflight,['a','b','c','b']);assert.ok(state.items.every(item=>item.status==='completed'));await h.queue.dispose();
});

test('cancel keeps completed files, disposes a late result and does not start the next item',async()=>{
  const started=deferred(),ready=deferred(),seen:string[]=[];let lateDisposed=0,firstDisposed=0;
  const h=setup({render:async(_t,data,opts)=>{const key=String(data._title);seen.push(key);if(key==='b'){started.resolve();await ready.promise;return output(opts.format,async()=>{lateDisposed++;});}return output(opts.format,async()=>{firstDisposed++;});}});
  h.queue.configure([entry('a'),entry('b'),entry('c')]);const running=h.queue.run();await started.promise;
  const first=h.queue.snapshot().items[0].result;h.queue.cancel();h.queue.cancel();ready.resolve();const state=await running;
  assert.deepEqual(seen,['a','b']);assert.deepEqual(state.items.map(item=>item.status),['completed','cancelled','cancelled']);assert.equal(state.items[0].result,first);
  assert.equal(firstDisposed,0);assert.equal(lateDisposed,1);assert.equal(h.releases(),1);assert.deepEqual(h.events,['srtb-render-start','srtb-render-end']);await h.queue.dispose();assert.equal(firstDisposed,1);
});

test('a cancelled queue can retry only unfinished items with all their preflights repeated',async()=>{
  const started=deferred(),ready=deferred(),seen:string[]=[];let cancelOnce=true;
  const h=setup({render:async(_t,data,opts)=>{seen.push(String(data._title));if(data._title==='b'&&cancelOnce){cancelOnce=false;started.resolve();await ready.promise;}return output(opts.format);}});
  h.queue.configure([entry('a'),entry('b'),entry('c')]);const run=h.queue.run();await started.promise;h.queue.cancel();ready.resolve();await run;
  await h.queue.run();assert.deepEqual(seen,['a','b','b','c']);assert.deepEqual(h.preflight,['a','b','c','b','c']);await h.queue.dispose();
});

test('cancellation during preflight launches no encoder and cancels pending selections',async()=>{
  const started=deferred(),ready=deferred(),h=setup({snapshot:async project=>{started.resolve();await ready.promise;return {template,data:project.data,filename:project.title};}});
  h.queue.configure([entry('a'),entry('b')]);const run=h.queue.run();await started.promise;h.queue.cancel();ready.resolve();const state=await run;
  assert.deepEqual(h.rendered,[]);assert.deepEqual(state.items.map(item=>item.status),['cancelled','cancelled']);assert.equal(h.releases(),1);
});

test('real session suspension aborts the current task even if the session is confirmed before it settles',async()=>{
  sessionState.open();const epoch=sessionState.snapshot().epoch,deadline=sessionState.onDeadline(()=>{}),started=deferred(),ready=deferred(),seen:string[]=[];let signal:AbortSignal|undefined,lateDisposed=0;
  const h=setup({bindSession:bindVideoSession,render:async(_t,data,opts,current)=>{seen.push(String(data._title));if(data._title==='b'){signal=current;started.resolve();await ready.promise;return output(opts.format,async()=>{lateDisposed++;});}return output(opts.format);}});
  try{
    h.queue.configure([entry('a'),entry('b'),entry('c')]);const run=h.queue.run();await started.promise;
    sessionState.lifetime(0,epoch);assert.equal(signal?.aborted,true);sessionState.lifetime(60000,epoch);assert.equal(sessionState.snapshot().suspended,false);ready.resolve();const state=await run;
    assert.deepEqual(seen,['a','b']);assert.equal(lateDisposed,1);assert.deepEqual(state.items.map(item=>item.status),['completed','cancelled','cancelled']);assert.ok(state.items[0].result);
  }finally{deadline();sessionState.end('logout');await h.queue.dispose();}
});

test('a closed session aborts before any preflight or render and unsubscribes its guard',async()=>{
  let releases=0;const h=setup({bindSession:controller=>{controller.abort(new DOMException('Session closed','AbortError'));return()=>{releases++;};}});
  h.queue.configure([entry()]);const state=await h.queue.run();assert.equal(state.items[0].status,'cancelled');assert.deepEqual(h.preflight,[]);assert.deepEqual(h.rendered,[]);assert.deepEqual(h.events,[]);assert.equal(releases,1);
});

test('stale progress callbacks cannot overwrite a completed file or a later attempt',async()=>{
  const callbacks:((progress:VideoProgress)=>void)[]=[];let attempt=0;
  const h=setup({render:async(_t,_d,opts,_s,progress)=>{callbacks.push(progress);if(!attempt++)throw Error('First attempt');return output(opts.format);}});
  h.queue.configure([entry()]);await h.queue.run();await h.queue.run();callbacks[0]({percent:12,message:'stale'});callbacks[1]({percent:13,message:'late'});
  const item=h.queue.snapshot().items[0];assert.equal(item.status,'completed');assert.equal(item.progress.percent,100);assert.equal(item.progress.message,'Fichier calculé et contrôlé.');await h.queue.dispose();
});

test('selection is explicit, rejects unknown/duplicate keys, and never rerenders completed items',async()=>{
  const h=setup();h.queue.configure([entry('a'),entry('b')]);await assert.rejects(h.queue.run(['missing']),/Sélection/);await assert.rejects(h.queue.run(['a','a']),/Sélection/);
  await h.queue.run([]);assert.deepEqual(h.events,[]);await h.queue.run(['b']);await h.queue.run(['b']);assert.deepEqual(h.rendered,['b']);assert.equal(h.queue.snapshot().items[0].status,'pending');
  await h.queue.run();assert.deepEqual(h.rendered,['b','a']);await h.queue.dispose();
});

test('result filenames match format and snapshot composition, with no automatic download',async()=>{
  const h=setup(),formats:VideoFormat[]=['mp4','mov','png','alpha'];h.queue.configure(formats.map((format,index)=>{const item=entry(String.fromCharCode(97+index),format);item.project.data._studio_format='vertical';return item;}));
  const state=await h.queue.run();assert.deepEqual(state.items.map(item=>item.result!.filename),['result-a_vertical.mp4','result-b_vertical.mov','result-c_vertical_PNG.zip','result-d_vertical.webm']);await h.queue.dispose();
});

test('completed artifacts require explicit disposal; all cleanup functions are idempotent',async()=>{
  const h=setup();h.queue.configure([entry('a'),entry('b')]);await h.queue.run();assert.throws(()=>h.queue.configure([entry('c')]),/conservés/);
  const artifact=h.queue.snapshot().items[0].result!;assert.equal(artifact.dispose(),artifact.dispose());await artifact.dispose();assert.equal(h.disposed(),1);
  const first=h.queue.dispose(),second=h.queue.dispose();assert.equal(first,second);await first;assert.equal(h.disposed(),2);assert.deepEqual(h.queue.snapshot().items,[]);
  assert.throws(()=>h.queue.configure([entry()]),/fermée/);await assert.rejects(h.queue.run(),/fermée/);
});

test('disposing while rendering waits for cancellation and releases only the actual late artifact',async()=>{
  const started=deferred(),ready=deferred();let disposed=0;
  const h=setup({render:async()=>{started.resolve();await ready.promise;return output('mp4',async()=>{disposed++;});}});
  h.queue.configure([entry()]);const run=h.queue.run();await started.promise;const cleanup=h.queue.dispose();assert.equal(h.queue.snapshot().phase,'disposing');ready.resolve();await Promise.all([run,cleanup]);assert.equal(disposed,1);assert.deepEqual(h.queue.snapshot().items,[]);assert.deepEqual(h.events,['srtb-render-start','srtb-render-end']);
});

test('observer exceptions cannot strand the session guard or the render-end event',async()=>{
  const h=setup({},()=>{throw Error('Broken view');});h.queue.configure([entry()]);const state=await h.queue.run();assert.equal(state.items[0].status,'completed');assert.equal(h.releases(),1);assert.deepEqual(h.events,['srtb-render-start','srtb-render-end']);await h.queue.dispose();
});

test('cancellation at the rendering state transition cannot enter the next encoder',async()=>{
  const h=setup({},state=>{if(state.phase==='rendering')h.queue.cancel();});
  h.queue.configure([entry('a'),entry('b')]);const state=await h.queue.run();assert.deepEqual(h.rendered,[]);assert.deepEqual(state.items.map(item=>item.status),['cancelled','cancelled']);assert.deepEqual(h.events,['srtb-render-start','srtb-render-end']);
});

test('actual videoSnapshot refuses a missing local file before any renderer is called',async()=>{
  sessionState.open();const a=entry('a'),b=entry('b'),nativeFetch=globalThis.fetch,requests:{url:string;method:string}[]=[];let renders=0;
  b.project.data._media_popup_url={url:'local-media:'+'f'.repeat(64)+':10',name:'missing.png',mimeType:'image/png'};
  globalThis.fetch=async(input,init={})=>{requests.push({url:String(input),method:init.method||'GET'});assert.equal(init.body,undefined);if(String(input).endsWith('/projects/'+a.project.id))return Response.json(a.project);assert.equal(init.method,'HEAD');return new Response(null,{headers:{'Content-Type':'image/png'}});};
  const queue=createDerivationExportQueue({deps:{render:async()=>{renders++;return output();},events:()=>{}}});
  try{queue.configure([a,b]);const state=await queue.run();assert.equal(renders,0);assert.deepEqual(state.items.map(item=>item.status),['pending','failed']);assert.match(state.items[1].error!,/média local manque/);assert.ok(requests.every(call=>['GET','HEAD'].includes(call.method)));}
  finally{globalThis.fetch=nativeFetch;sessionState.end('logout');await queue.dispose();}
});
