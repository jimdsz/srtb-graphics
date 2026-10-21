import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {scanFolder,indexedFile,readFolderOperation,FolderReadTimeout} from '../src/studio/day-planner-folders';
import type {DirectoryHandle} from '../src/studio/day-planner-folders';

function file(name:string,size=42,modified=123){
 return {kind:'file',name,async getFile(){return {name,size,lastModified:modified,arrayBuffer(){throw Error('File contents must not be read during indexing');}};}};
}
function folder(name:string,children:Record<string,unknown>){
 return {kind:'directory',name,async *entries(){for(const item of Object.entries(children))yield item;},async getDirectoryHandle(key:string){if(!(key in children))throw new DOMException('Missing','NotFoundError');return children[key];},async getFileHandle(key:string){if(!(key in children))throw new DOMException('Missing','NotFoundError');return children[key];}} as unknown as DirectoryHandle;
}
test('index reads metadata only, scans selected descendants, excludes unrelated formats',async()=>{
 const handle=folder('Programme',{Episode:folder('Episode',{'film.mp4':file('film.mp4'),'notes.txt':file('notes.txt')}),'logo.png':file('logo.png')});
 const updates:number[]=[];const index=await scanFolder(handle,new AbortController().signal,n=>updates.push(n));
 assert.deepEqual(index.files.map(f=>f.path),['Episode/film.mp4','logo.png']);assert.equal(index.partial,false);assert.equal(updates.at(-1),2);
 const loaded=await indexedFile(handle,index.files[0]);assert.equal(loaded.file.name,'film.mp4');
 await assert.rejects(indexedFile(handle,{...index.files[0],size:43}),{name:'IndexedFileChanged',message:/a changé/});
 await assert.rejects(indexedFile(handle,{...index.files[0],modified:124}),{name:'IndexedFileChanged'});
 await assert.rejects(indexedFile(handle,{...index.files[0],path:'../other.mp4'}));
});

test('a stalled directory iterator can be cancelled without waiting for network recovery',async()=>{
 const c=new AbortController();let reads=0,closed=0,progress=0;
 const handle={...folder('Réseau',{}),entries:()=>({next(){reads++;return new Promise(()=>{});},return(){closed++;return new Promise(()=>{});}})} as unknown as DirectoryHandle;
 const result=scanFolder(handle,c.signal,()=>progress++);c.abort();
 await assert.rejects(result,{name:'AbortError'});assert.equal(reads,1);assert.equal(closed,1);assert.equal(progress,0);
});

test('cancel while waiting for file metadata discards late result and never scans the next file',async()=>{
 const c=new AbortController();let complete!:(value:unknown)=>void,started!:()=>void,secondReads=0,updates=0;
 const pending=new Promise<void>(resolve=>started=resolve);
 const handle=folder('Réseau',{'lent.mp4':{kind:'file',getFile(){started();return new Promise(resolve=>complete=resolve);}},'suite.mp4':{kind:'file',getFile(){secondReads++;return file('suite.mp4').getFile();}}});
 const result=scanFolder(handle,c.signal,()=>updates++);await pending;c.abort();await assert.rejects(result,{name:'AbortError'});
 complete(await file('lent.mp4').getFile());await new Promise(resolve=>setImmediate(resolve));
 assert.equal(secondReads,0);assert.equal(updates,0);
});

test('filesystem operations time out, preserve failures and ignore late resolutions',async()=>{
 let late!:(value:number)=>void;const pending=readFolderOperation(()=>new Promise<number>(resolve=>late=resolve),undefined,5);
 await assert.rejects(pending,FolderReadTimeout);late(42);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(await readFolderOperation(async()=>42,undefined,100),42);
 await assert.rejects(readFolderOperation(()=>{throw new DOMException('Permission','NotAllowedError');}),{name:'NotAllowedError'});
 await assert.rejects(readFolderOperation(async()=>{throw new DOMException('Network','NotReadableError');}),{name:'NotReadableError'});
 const c=new AbortController();c.abort();let called=false;
 await assert.rejects(readFolderOperation(async()=>{called=true;return 1;},c.signal),{name:'AbortError'});assert.equal(called,false);
});

test('directory access failures are explicit; an unreadable descendant produces a partial index',async()=>{
 const denied={...folder('Refusé',{}),entries(){return {next:async()=>{throw new DOMException('Permission','NotAllowedError');}};}} as unknown as DirectoryHandle;
 await assert.rejects(scanFolder(denied,new AbortController().signal,()=>{}),/retiré/);
 const offline={...folder('Hors ligne',{}),entries(){return {next:async()=>{throw new DOMException('Offline','NotReadableError');}};}} as unknown as DirectoryHandle;
 await assert.rejects(scanFolder(offline,new AbortController().signal,()=>{}),/Impossible de lire ce dossier/);
 const partial=await scanFolder(folder('Racine',{offline,'bon.mp4':file('bon.mp4')}),new AbortController().signal,()=>{});
 assert.equal(partial.partial,true);assert.deepEqual(partial.files.map(f=>f.path),['bon.mp4']);
});

test('global scan limit stops traversal of sibling folders as well',async()=>{
 let reads=0;
 const long=folder('Long',Object.fromEntries(Array.from({length:1001},(_,i)=>[`v${i}.mp4`,file(`v${i}.mp4`)])));
 const unused={...folder('Autre',{}),entries(){reads++;throw Error('Should never visit');}} as unknown as DirectoryHandle;
 const result=await scanFolder(folder('Racine',{long,unused}),new AbortController().signal,()=>{});
 assert.equal(result.files.length,1000);assert.equal(result.partial,true);assert.equal(reads,0);
});

test('reconnection to an indexed file is cancellable before and during path traversal',async()=>{
 const c=new AbortController();let called=false;const handle={...folder('Réseau',{}),getDirectoryHandle(){called=true;return new Promise(()=>{});}} as unknown as DirectoryHandle;
 const result=indexedFile(handle,{path:'Épisodes/programme.mp4',name:'programme.mp4',size:42,modified:123},c.signal);c.abort();
 await assert.rejects(result,{name:'AbortError'});assert.equal(called,true);
 called=false;await assert.rejects(indexedFile(handle,{path:'Épisodes/programme.mp4',name:'programme.mp4',size:42,modified:123},c.signal),{name:'AbortError'});assert.equal(called,false);
});
test('cancel, revoked access, network loss and index limits remain explicit',async()=>{
 const c=new AbortController();c.abort();await assert.rejects(scanFolder(folder('Réseau',{'x.mp4':file('x.mp4')}),c.signal,()=>{}),{name:'AbortError'});
 await assert.rejects(scanFolder(folder('Réseau',{'x.mp4':{kind:'file',getFile:async()=>{throw new DOMException('Denied','NotAllowedError');}}}),new AbortController().signal,()=>{}),/retiré/);
 const disconnected=await scanFolder(folder('Réseau',{'x.mp4':{kind:'file',getFile:async()=>{throw new DOMException('Offline','NotReadableError');}}}),new AbortController().signal,()=>{});
 assert.equal(disconnected.partial,true);assert.equal(disconnected.files.length,0);
 const entries=Object.fromEntries(Array.from({length:1001},(_,i)=>[`video-${i}.mp4`,file(`video-${i}.mp4`)]));
 const limited=await scanFolder(folder('Long dossier',entries),new AbortController().signal,()=>{});assert.equal(limited.files.length,1000);assert.equal(limited.partial,true);
});
