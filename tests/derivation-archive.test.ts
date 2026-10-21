import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {archiveFilename,createDerivationArchiveTask,DERIVATION_MEMORY_LIMIT,DERIVATION_ZIP_LIMIT,initialDerivationArchiveState,planDerivationArchive,writeDerivationArchive} from '../src/studio/derivation-archive';
import type {DerivationArchiveDestination,DerivationArchiveProgress} from '../src/studio/derivation-archive';
import {memoryDerivationArchive,openDerivationArchive} from '../src/studio/derivation-archive-save';
import DerivationArchiveDownload from '../src/studio/DerivationArchiveDownload';
import type {DerivationExportItem,DerivationExportState} from '../src/studio/derivation-export-queue';
import type {ArchiveSink} from '../src/studio/delivery-zip';
import type {VideoReport} from '../src/studio/video/export';
import {getTemplate,templateDefaults} from '../src/studio/domain';

const template=getTemplate('BTV_BA_1P'),signal=()=>new AbortController().signal;
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function deferred<T=void>(){let resolve!:(value:T)=>void,reject!:(cause:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
let disposed=0;
function item(index=1,status:DerivationExportItem['status']='completed',filename=`output-${index}.mp4`,blob:Blob=new Blob([new Uint8Array([index,0,255,index,34])])):DerivationExportItem{
  return {key:`key-${index}`,project:{id:`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`,title:'Unused private title',template_id:template.id,template_version:template.version,library_version:template.libraryVersion,data:templateDefaults(template),revision:index,status:'draft',archived:0,created_by:'recipe@example.invalid',updated_by:'recipe@example.invalid',created_at:'',updated_at:''},options:{format:filename.endsWith('.mov')?'mov':'mp4',audio:true,manualOut:12,removeBackground:false,background:'#000000'},revisionSource:'current',status,progress:{percent:status==='completed'?100:0,message:'Fixture'},...(status==='completed'?{result:{blob,filename,dispose:async()=>{disposed++;},report:{} as VideoReport}}:{})};
}
const state=(items:DerivationExportItem[],extra:Partial<DerivationExportState>={}):DerivationExportState=>({items,running:false,phase:'idle',currentKey:null,selectedKeys:[],...extra});
function destination(){
  const chunks:Uint8Array[]=[],events:string[]=[];let closed=0,aborted=0;
  const sink:ArchiveSink={write:async bytes=>{events.push('write');chunks.push(new Uint8Array(bytes));},close:async()=>{events.push('close');closed++;},abort:async()=>{events.push('abort');aborted++;}};
  return {sink,chunks,events,closed:()=>closed,aborted:()=>aborted,bytes:()=>new Uint8Array(Buffer.concat(chunks)),destination:{mode:'disk',sink,result:()=>undefined} satisfies DerivationArchiveDestination};
}

test('eight completed files are stored byte-identically and independently hash-verified after unzip',async()=>{
  const items=Array.from({length:8},(_,i)=>item(i+1,'completed',i===7?'alpha.mov':`ba-${i}.mp4`)),before=items.map(value=>value.result),plan=planDerivationArchive(state(items)),out=destination(),progress:DerivationArchiveProgress[]=[];
  const result=await writeDerivationArchive(plan,out.sink,signal(),value=>progress.push(value));
  const zip=unzipSync(out.bytes()),manifest=JSON.parse(new TextDecoder().decode(zip['INVENTAIRE.json']));
  assert.equal(Object.keys(zip).length,9);assert.equal(manifest.complete,true);assert.equal(manifest.requestedCount,8);assert.equal(manifest.includedCount,8);assert.deepEqual(manifest.omitted,[]);
  for(const file of manifest.files){const source=items.find(value=>value.key===file.key)!;const original=new Uint8Array(await source.result!.blob.arrayBuffer());assert.deepEqual(zip[file.filename],original);assert.equal(file.sha256,digest(original));assert.equal(file.bytes,original.length);assert.equal(file.revision,source.project.revision);assert.equal(file.projectId,source.project.id);}
  assert.equal(result.bytes,out.bytes().length);assert.equal(out.closed(),1);assert.equal(out.aborted(),0);assert.deepEqual(items.map(value=>value.result),before);
  // Parse each local header independently: compression method must be STORE.
  const raw=out.bytes(),view=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);let offset=0;
  for(const name of [...plan.files.map(file=>file.filename),'INVENTAIRE.json']){assert.equal(view.getUint32(offset,true),0x04034b50);assert.equal(view.getUint16(offset+8,true),0);offset+=30+view.getUint16(offset+26,true)+view.getUint16(offset+28,true)+zip[name].length+16;}
  assert.equal(progress.at(-1)?.phase,'complete');assert.equal(progress.at(-1)?.copiedBytes,plan.sourceBytes);assert.equal(progress.at(-1)?.writtenBytes,result.bytes);
  assert.ok(progress.every((value,i)=>!i||value.copiedBytes>=progress[i-1].copiedBytes&&value.writtenBytes>=progress[i-1].writtenBytes));
  assert.doesNotMatch(new TextDecoder().decode(zip['INVENTAIRE.json']),/Unused private title|recipe@example|_audio_voice/);
});

test('partial archive names included and omitted outputs explicitly, without retry or disposal',async()=>{
  const items=[item(1),item(2,'failed'),item(3,'cancelled'),item(4,'pending')],plan=planDerivationArchive(state(items)),out=destination(),previous=disposed;
  assert.equal(plan.complete,false);assert.equal(plan.requestedCount,4);assert.equal(plan.files.length,1);
  await writeDerivationArchive(plan,out.sink,signal());const zip=unzipSync(out.bytes()),manifest=JSON.parse(new TextDecoder().decode(zip['INVENTAIRE.json']));
  assert.deepEqual(Object.keys(zip).sort(),['INVENTAIRE.json','output-1.mp4']);assert.equal(manifest.complete,false);assert.equal(manifest.includedCount,1);assert.deepEqual(manifest.omitted,[{key:'key-2',status:'failed'},{key:'key-3',status:'cancelled'},{key:'key-4',status:'pending'}]);assert.equal(disposed,previous);
});

test('flat collisions, case collisions and the reserved inventory name cannot overwrite files',async()=>{
  const names=['file.mp4','file.mp4','FILE.mp4','INVENTAIRE.json','fichier-é.mp4','fichier-e\u0301.mp4'];
  const plan=planDerivationArchive(state(names.map((name,i)=>item(i+1,'completed',name))));
  assert.deepEqual(plan.files.map(file=>file.filename),['file.mp4','file__2.mp4','FILE__3.mp4','INVENTAIRE__2.json','fichier-é.mp4','fichier-é__2.mp4']);
  const out=destination();await writeDerivationArchive(plan,out.sink,signal());const zip=unzipSync(out.bytes());assert.equal(Object.keys(zip).length,7);
  for(let i=0;i<plan.files.length;i++)assert.equal(zip[plan.files[i].filename][0],i+1);
});

test('malicious or non-portable names are rejected before any source read',()=>{
  const fake={size:1,stream(){throw Error('must not read');}} as Blob;
  for(const name of ['../x.mp4','a/../../x','/absolute.mp4','C:\\x.mp4','x:stream.mp4','bad\\name.mp4','a\0.mp4','a\n.mp4','x\u202emp4','NUL.mp4','com1.mp4','a.mp4.','a.mp4 ','..','a'.repeat(201),'COM¹.mp4','LPT².mov','con .mp4'])assert.throws(()=>planDerivationArchive(state([item(1,'completed',name,fake)])),/nom|Nom/i,name);
  assert.equal(archiveFilename('BTV_bénin-1_é.mp4'),'BTV_bénin-1_é.mp4');
});

test('preflight refuses active/disposing, zero finished files, duplicate keys, empty blobs and ZIP64-sized input',()=>{
  for(const phase of ['preflight','rendering','disposing'] as const)assert.throws(()=>planDerivationArchive(state([item()],{phase})),/Attendez/);
  assert.throws(()=>planDerivationArchive(state([item()],{running:true})),/Attendez/);assert.throws(()=>planDerivationArchive(state([item(1,'failed')])),/Aucun fichier/);
  assert.throws(()=>planDerivationArchive(state([item(),item()])),/double/);assert.throws(()=>planDerivationArchive(state([item(1,'completed','empty.mp4',new Blob())])),/absent ou vide/);
  const fake={size:DERIVATION_ZIP_LIMIT,stream(){throw Error('must not read');}} as Blob;
  assert.throws(()=>planDerivationArchive(state([item(1,'completed','large.mp4',fake)])),/3 Gio/);
  assert.throws(()=>planDerivationArchive(state(Array.from({length:9},(_,i)=>item(i+1)))),/huit/);
});

test('actual ZIP limit counts headers, inventory and central index, aborts without committing',async()=>{
  const plan=planDerivationArchive(state([item()])),out=destination();assert.ok(plan.sourceBytes<100);
  await assert.rejects(writeDerivationArchive(plan,out.sink,signal(),()=>{},100),/limite de stockage/);
  assert.ok(out.bytes().length<=100);assert.equal(out.closed(),0);assert.equal(out.aborted(),1);
  const complete=destination();await writeDerivationArchive(plan,complete.sink,signal());const exact=complete.bytes().length,next=destination();
  await writeDerivationArchive(plan,next.sink,signal(),()=>{},exact);assert.equal(next.bytes().length,exact);assert.equal(next.closed(),1);
});

test('streaming applies backpressure and never calls a full-blob arrayBuffer',async()=>{
  const chunks=[new Uint8Array(2*1024**2+3).fill(19),new Uint8Array([4,5])];let reads=0,activeWrites=0,peakWrites=0,maxWrite=0;
  const blob={size:chunks.reduce((sum,chunk)=>sum+chunk.length,0),arrayBuffer(){throw Error('full read forbidden');},stream(){return new ReadableStream<Uint8Array>({pull(controller){if(reads<chunks.length)controller.enqueue(chunks[reads++]);else controller.close();}});}} as Blob;
  const out=destination(),write=out.sink.write;out.sink.write=async bytes=>{peakWrites=Math.max(peakWrites,++activeWrites);maxWrite=Math.max(maxWrite,bytes.length);await Promise.resolve();await write(bytes);activeWrites--;};
  const plan=planDerivationArchive(state([item(1,'completed','stream.mp4',blob)]));await writeDerivationArchive(plan,out.sink,signal());
  assert.equal(peakWrites,1);assert.ok(maxWrite<=1024**2);assert.equal(reads,2);assert.equal(digest(unzipSync(out.bytes())['stream.mp4']),digest(Buffer.concat(chunks)));
});

test('truncated streams and source/sink errors never close or dispose completed results',async()=>{
  const previous=disposed;
  for(const mode of ['truncated','read-error','write-error']){
    const blob={size:10,stream(){return new ReadableStream<Uint8Array>({start(controller){if(mode==='read-error')controller.error(Error('source read failed'));else{controller.enqueue(new Uint8Array(mode==='truncated'?2:10));controller.close();}}});}} as Blob;
    const out=destination();if(mode==='write-error')out.sink.write=async()=>{throw Error('disk full');};
    await assert.rejects(writeDerivationArchive(planDerivationArchive(state([item(1,'completed','file.mp4',blob)])),out.sink,signal()));assert.equal(out.closed(),0);assert.equal(out.aborted(),1);
  }
  assert.equal(disposed,previous);
});

test('abort cancels a blocked stream read and leaves all result objects intact',async()=>{
  const reached=deferred(),task=new AbortController();let cancelled=0;
  const blob={size:10,stream(){return new ReadableStream<Uint8Array>({pull(){reached.resolve();return new Promise(()=>{});},cancel(){cancelled++;}});}} as Blob;
  const source=item(1,'completed','blocked.mp4',blob),result=source.result,out=destination(),pending=writeDerivationArchive(planDerivationArchive(state([source])),out.sink,task.signal);
  await reached.promise;task.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(cancelled,1);assert.equal(out.closed(),0);assert.equal(out.aborted(),1);assert.equal(source.result,result);
});

test('aborted copy joins the first delayed reader cancellation before releasing its lifetime',async()=>{
  const reached=deferred(),cancelled=deferred(),release=deferred(),controller=new AbortController();let cancelCalls=0,settled=false;
  const blob={size:1,stream(){return new ReadableStream<Uint8Array>({pull(){reached.resolve();return new Promise(()=>{});},cancel(){cancelCalls++;cancelled.resolve();return release.promise;}});}} as Blob;
  const out=destination(),pending=writeDerivationArchive(planDerivationArchive(state([item(1,'completed','delayed.mp4',blob)])),out.sink,controller.signal).finally(()=>{settled=true;});
  const rejected=assert.rejects(pending,{name:'AbortError'});
  await reached.promise;controller.abort();await cancelled.promise;await new Promise(resolve=>setImmediate(resolve));
  assert.equal(settled,false,'Queue lifetime must still be held while the first cancel is pending.');assert.equal(out.aborted(),0);assert.equal(cancelCalls,1);
  release.resolve();await rejected;assert.equal(out.aborted(),1);assert.equal(out.closed(),0);
});

test('memory fallback bounds actual emitted bytes, drops partial data on abort and creates no premature blob',async()=>{
  const task=new AbortController(),memory=memoryDerivationArchive(task.signal,100);
  await memory.sink.write(new Uint8Array(90));assert.equal(memory.result(),undefined);await assert.rejects(memory.sink.write(new Uint8Array(11)),/128 Mio.*individuels/);
  await memory.sink.abort();assert.equal(memory.result(),undefined);await assert.rejects(memory.sink.close(),/annulée/);
  const good=memoryDerivationArchive(signal(),10);await good.sink.write(new Uint8Array([1,2,3]));await good.sink.close();await good.sink.abort();assert.equal(good.result()?.size,3,'Committed result is not reported as deleted by a later abort.');
});

test('unsupported direct save refuses large memory fallback before touching blobs and proposes individual links',async()=>{
  const fake={size:DERIVATION_MEMORY_LIMIT,stream(){throw Error('must not read');}} as Blob,plan=planDerivationArchive(state([item(1,'completed','large.mp4',fake)]));
  await assert.rejects(openDerivationArchive(plan,'ensemble.zip',signal(),{}),/128 Mio.*individuel/);
  const small=planDerivationArchive(state([item()]));assert.equal((await openDerivationArchive(small,'ensemble.zip',signal(),{})).mode,'memory');
});

test('direct picker runs synchronously, and cancellation before writable arrival aborts that writable',async()=>{
  const plan=planDerivationArchive(state([item()])),picker=deferred<{createWritable:()=>Promise<ArchiveSink>}>(),writable=deferred<ArchiveSink>(),task=new AbortController(),out=destination();let picked=0;
  const pending=openDerivationArchive(plan,'ensemble.zip',task.signal,{showSaveFilePicker:()=>{picked++;return picker.promise;}});assert.equal(picked,1);
  picker.resolve({createWritable:(options?:{mode:'exclusive'})=>{assert.deepEqual(options,{mode:'exclusive'});return writable.promise;}});await Promise.resolve();task.abort();writable.resolve(out.sink);
  await assert.rejects(pending,{name:'AbortError'});assert.equal(out.aborted(),1);assert.equal(out.closed(),0);
});

test('task double click shares a picker; disposal waits for copy abort before queue resources may be released',async()=>{
  const plan=planDerivationArchive(state([item()])),entered=deferred(),release=deferred(),out=destination(),write=out.sink.write;let calls=0,stopped=0,releasedQueue=false;
  out.sink.write=async bytes=>{entered.resolve();await release.promise;await write(bytes);};
  const task=createDerivationArchiveTask({bindSession:()=>()=>{stopped++;}}),open=async()=>{calls++;return out.destination;};
  const first=task.run(plan,open),second=task.run(plan,open);assert.equal(first,second);assert.equal(calls,1);await entered.promise;
  const disposing=task.dispose().then(()=>{releasedQueue=true;});await Promise.resolve();assert.equal(releasedQueue,false);assert.equal(task.running(),true);
  release.resolve();await disposing;assert.equal(await first,null);assert.equal(releasedQueue,true);assert.equal(out.closed(),0);assert.ok(out.aborted()>=1);assert.equal(stopped,1);assert.equal(task.snapshot().phase,'cancelled');
  await assert.rejects(task.run(plan,open),/fermée/);
});

test('session suspension aborts the task and never offers a completed archive',async()=>{
  const plan=planDerivationArchive(state([item()])),chosen=deferred<DerivationArchiveDestination>(),out=destination();let controller!:AbortController;
  const task=createDerivationArchiveTask({bindSession:value=>{controller=value;return()=>{};}}),pending=task.run(plan,()=>chosen.promise);
  controller.abort(new DOMException('Session suspendue','AbortError'));chosen.resolve(out.destination);assert.equal(await pending,null);assert.equal(out.closed(),0);assert.equal(out.aborted(),1);assert.equal(task.snapshot().phase,'cancelled');
});

test('successful close wins over concurrent cancel at the commit boundary; failed close remains an error',async()=>{
  for(const fail of [false,true]){
    const plan=planDerivationArchive(state([item()])),entered=deferred(),release=deferred(),out=destination();let aborted=0;
    out.sink.close=async()=>{entered.resolve();await release.promise;if(fail)throw Error('close failed');};out.sink.abort=async()=>{aborted++;};
    const task=createDerivationArchiveTask(),pending=task.run(plan,async()=>out.destination);await entered.promise;
    assert.equal(task.snapshot().phase,'committing');if(!fail)task.cancel();release.resolve();const result=await pending;
    if(fail){assert.equal(result,null);assert.equal(task.snapshot().phase,'failed');assert.match(task.snapshot().error,/close failed/);assert.ok(aborted>=1);}
    else{assert.equal(result?.count,1);assert.equal(task.snapshot().phase,'complete');assert.equal(aborted,0);}
  }
});

test('UI advertises partial N/M, memory limits and measured progress; cleanup precedes queue disposal and revocation',()=>{
  const plan=planDerivationArchive(state([item(),item(2,'failed')]));
  const markup=renderToStaticMarkup(createElement(DerivationArchiveDownload,{plan,reason:'',state:initialDerivationArchiveState,directSave:false,disabled:false,onDownload(){},onCancel(){},download:null}));
  assert.match(markup,/Archive partielle/);assert.match(markup,/<strong>1.*\/.*2 fichiers<\/strong>/);assert.match(markup,/128 Mio/);assert.match(markup,/liens individuels/);assert.match(markup,/Télécharger.*1.*fichiers terminés/);
  const panel=readFileSync(new URL('../src/studio/DerivationPanel.tsx',import.meta.url),'utf8');
  assert.match(panel,/await oldArchive\?\.dispose\(\);await oldQueue\?\.dispose\(\)/);
  assert.match(panel,/oldUrls.values\(\)\)URL.revokeObjectURL/);assert.match(panel,/if\(archive.current\?\.running\(\)\|\|queue.current\?\.snapshot\(\).running\)return false/);
  assert.match(panel,/if\(locked.current\|\|archive.current\?\.running\(\)\)return/);assert.match(panel,/busy=working\|\|archiveState.running/);
  assert.match(panel,/bindSession:bindVideoSession/);assert.match(panel,/!permitted\(\)/);assert.match(panel,/href=\{download.url\} download=\{download.filename\}/,'Individual links remain.');
});

test('local UI fixture reuses the actual archive component, exposes an explicit cancel gate and has no API or encoding action',()=>{
  const fixture=readFileSync(new URL('./derivation-archive-qualification.tsx',import.meta.url),'utf8');
  assert.match(fixture,/import DerivationArchiveDownload from/);assert.match(fixture,/createDerivationArchiveTask\(/);
  assert.match(fixture,/if\(!\['localhost','127\.0\.0\.1','\[::1\]'\]\.includes\(location.hostname\)\)/);
  assert.match(fixture,/if\(\+\+writes===2\)/);assert.match(fixture,/signal.addEventListener\('abort',abort/);
  assert.match(fixture,/if\(files.length>8\)/);assert.match(fixture,/INVENTAIRE|empreinte/);
  assert.doesNotMatch(fixture,/\bfetch\s*\(|\bXMLHttpRequest\b|\bexportBroadcastVideo\s*\(|\bderivations\.(create|update)\s*\(/);
});

test('a previous partial ZIP remains labelled with its own N/M after missing renders succeed',()=>{
  const plan=planDerivationArchive(state([item(1),item(2)]));
  const markup=renderToStaticMarkup(createElement(DerivationArchiveDownload,{plan,reason:'',state:initialDerivationArchiveState,directSave:false,disabled:false,onDownload(){},onCancel(){},download:{url:'blob:previous-partial',filename:'1sur2.zip',count:1,requestedCount:2,complete:false}}));
  assert.match(markup,/Ensemble complet.*<strong>2.*\/.*2 fichiers<\/strong>/);
  assert.match(markup,/Retélécharger le ZIP partiel déjà préparé \(1\/2 fichiers\)/);
  assert.match(markup,/préparation précédente/);assert.doesNotMatch(markup,/Retélécharger le ZIP complet/);
});
