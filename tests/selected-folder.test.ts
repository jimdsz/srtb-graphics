import test from 'node:test';
import assert from 'node:assert/strict';
import {selectedFolder} from '../src/studio/selected-folder';
import {indexedFile,scanFolder,rememberFolder,connectedFolder} from '../src/studio/day-planner-folders';

function picked(path:string,name=path.split('/').at(-1)!){
 return {name,webkitRelativePath:path,size:42,lastModified:123,arrayBuffer(){throw Error('No bytes read during indexing');}} as unknown as File;
}
test('directory input preserves relative paths, metadata and selected file identities without reading bytes',async()=>{
 const episode=picked('Programmes/Épisodes/Bonjour le Bénin.mp4'),logo=picked('Programmes/logo.png');
 const folder=await selectedFolder([episode,logo,picked('Programmes/notes.txt')]);
 const index=await scanFolder(folder,new AbortController().signal,()=>{});
 assert.equal(index.name,'Programmes');assert.equal(index.partial,false);
 assert.deepEqual(index.files.map(f=>f.path),['Épisodes/Bonjour le Bénin.mp4','logo.png']);
 const source=await indexedFile(folder,index.files[0]);assert.equal(source.file,episode);assert.equal(source.handle,undefined);
 await assert.rejects(indexedFile(folder,{...index.files[0],size:43}),/changé/);
 await assert.rejects(indexedFile(folder,{...index.files[0],path:'../secret.mp4'}));
 await assert.rejects(indexedFile(folder,{...index.files[0],path:'non sélectionné.mp4'}),{name:'NotFoundError'});
});
test('invalid, duplicate, cross-root and conflicting selections never produce an index',async()=>{
 for(const files of [[],[picked('film.mp4')],[picked('R/../film.mp4')],[picked('/R/film.mp4')],[picked('R/a.mp4','b.mp4')],[picked('R/a.mp4'),picked('S/b.mp4')],[picked('R/a.mp4'),picked('R/a.mp4')],[picked('R/a.mp4'),picked('R/a.mp4/b.png')]]){
  await assert.rejects(selectedFolder(files));
 }
});
test('large selections are bounded and metadata preparation is cancellable',async()=>{
 await assert.rejects(selectedFolder({length:10001} as ArrayLike<File>),/sous-dossier/);
 const control=new AbortController();control.abort();await assert.rejects(selectedFolder([picked('R/a.mp4')],control.signal),{name:'AbortError'});
 const pendingControl=new AbortController(),files=Array.from({length:100},(_,i)=>picked(`R/${i}.mp4`));
 const result=selectedFolder(files,pendingControl.signal);pendingControl.abort();await assert.rejects(result,{name:'AbortError'});
 const folder=await selectedFolder(Array.from({length:1001},(_,i)=>picked(`R/${i}.mp4`)));
 const index=await scanFolder(folder,new AbortController().signal,()=>{});assert.equal(index.partial,true);assert.equal(index.files.length,1000);
});
test('session directories never copy files into persistent storage and do not grant another member access',async()=>{
 const before=Object.getOwnPropertyDescriptor(globalThis,'indexedDB');let writes=0;
 Object.defineProperty(globalThis,'indexedDB',{configurable:true,value:{open(){writes++;throw Error('Not available');}}});
 try{
  const folder=await selectedFolder([picked('R/a.mp4')]);
  assert.match(await rememberFolder('one@example.test','ephemeral',folder,true),/cette ouverture uniquement/);
  assert.equal(writes,0);assert.equal(await connectedFolder('one@example.test','ephemeral'),folder);assert.equal(writes,0);
  assert.equal(await connectedFolder('two@example.test','ephemeral'),null);
 }finally{if(before)Object.defineProperty(globalThis,'indexedDB',before);else Reflect.deleteProperty(globalThis,'indexedDB');}
});
