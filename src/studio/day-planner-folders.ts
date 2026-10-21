import type {DirectoryIndex,IndexedMedia} from './day-planner-model';
import {relativePathSchema} from './day-planner-model';
import type {ReadHandle} from './local-media';
import {folderStore as store} from './planner-folder-store';
import {selectedFolder,SelectedFolder} from './selected-folder';

interface PersistentDirectoryHandle extends FileSystemDirectoryHandle {
 queryPermission(options:{mode:'read'}):Promise<PermissionState>;
 requestPermission(options:{mode:'read'}):Promise<PermissionState>;
}
export type DirectoryHandle=PersistentDirectoryHandle|SelectedFolder;
export const sessionFolder=(handle:DirectoryHandle)=>handle instanceof SelectedFolder;
const memory=new Map<string,DirectoryHandle>();
const key=(email:string,id:string)=>email.toLowerCase()+':'+id;
export class FolderReadTimeout extends Error {
 constructor(){super('Le dossier ne répond plus depuis 20 secondes. Vérifiez la connexion au disque ou au réseau, puis réessayez.');this.name='FolderReadTimeout';}
}
export class IndexedFileChanged extends Error {
 constructor(){super('Ce fichier a changé depuis l’indexation. Actualisez l’index avant de le sélectionner.');this.name='IndexedFileChanged';}
}
/** Filesystem calls cannot be cancelled by the browser. Stop waiting and discard
 * late results, without continuing to scan or starting an automatic retry. */
export function readFolderOperation<T>(operation:()=>Promise<T>,signal?:AbortSignal,timeoutMs:number|null=20000):Promise<T>{
 return new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(signal.reason||new DOMException('Lecture annulée.','AbortError'));return;}
  let done=false;
  const finish=(failed:boolean,value:unknown)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(failed)reject(value);else resolve(value as T);};
  const abort=()=>finish(true,signal?.reason||new DOMException('Lecture annulée.','AbortError'));
  // A human file/permission choice has no deadline, but can still be abandoned.
  const timer=timeoutMs===null?undefined:setTimeout(()=>finish(true,new FolderReadTimeout()),timeoutMs);
  signal?.addEventListener('abort',abort,{once:true});
  try{Promise.resolve(operation()).then(value=>finish(false,value),error=>finish(true,error));}catch(error){finish(true,error);}
 });
}
if(typeof window!=='undefined')window.addEventListener('srtb-local-media-clear',()=>memory.clear());
export const persistentFolderPickerAvailable=()=>typeof (window as Window&{showDirectoryPicker?:unknown}).showDirectoryPicker==='function';
export const folderPickerAvailable=()=>persistentFolderPickerAvailable()||'webkitdirectory' in document.createElement('input');
export async function chooseFolder(signal?:AbortSignal):Promise<DirectoryHandle>{
 signal?.throwIfAborted();
 const picker=(window as Window&{showDirectoryPicker?:(o:{mode:'read';id:string})=>Promise<DirectoryHandle>}).showDirectoryPicker;
 if(picker)return readFolderOperation(()=>picker.call(window,{mode:'read',id:'srtb-graphics-programmes'}),signal,null);
 if(!folderPickerAvailable())throw Error('Ce navigateur ne permet pas de sélectionner un dossier. Choisissez les fichiers un par un.');
 return new Promise((resolve,reject)=>{
  const input=document.createElement('input');input.type='file';input.webkitdirectory=true;input.multiple=true;
  input.hidden=true;document.body.append(input);let settled=false;
  const cleanup=()=>{input.remove();signal?.removeEventListener('abort',cancel);};
  const finish=(error:unknown,value?:SelectedFolder)=>{if(settled)return;settled=true;cleanup();if(error)reject(error);else resolve(value!);};
  const cancel=()=>finish(signal?.reason||new DOMException('Choix du dossier annulé.','AbortError'));
  input.addEventListener('cancel',cancel,{once:true});signal?.addEventListener('abort',cancel,{once:true});
  input.addEventListener('change',()=>{if(!input.files?.length){cancel();return;}void selectedFolder(input.files,signal).then(folder=>finish(null,folder),error=>finish(error));},{once:true});
  try{input.click();}catch(error){finish(error);}
 });
}
export async function rememberFolder(email:string,id:string,handle:DirectoryHandle,remember:boolean){
 memory.set(key(email,id),handle);
 // File objects are session grants, not durable directory permissions. Never
 // structured-clone them into IndexedDB (which would copy private media bytes).
 if(sessionFolder(handle))return 'Dossier connecté pour cette ouverture uniquement. Resélectionnez-le après avoir fermé ou rechargé Graphics ; les références d’équipe restent conservées.';
 try{await store('readwrite',s=>remember?s.put(handle,key(email,id)):s.delete(key(email,id)));return '';}
 catch{return remember?'Dossier connecté pour cette session. Ce navigateur n’a pas pu mémoriser l’accès : reconnectez-le à la prochaine ouverture.':'Dossier connecté. L’ancienne mémorisation éventuelle n’a pas pu être effacée ; réessayez « Oublier l’accès local ».';}
}
export async function forgetFolder(email:string,id:string){memory.delete(key(email,id));await store('readwrite',s=>s.delete(key(email,id)));}
/** Called by an explicit connect/use button; permissions never come from the shared index. */
export async function connectedFolder(email:string,id:string,signal?:AbortSignal){
 signal?.throwIfAborted();
 const handle=memory.get(key(email,id))||await readFolderOperation(()=>store('readonly',s=>s.get(key(email,id))),signal).catch(()=>{signal?.throwIfAborted();return undefined;}) as DirectoryHandle|undefined;
 signal?.throwIfAborted();
 if(!handle)return null;
 if(!sessionFolder(handle)){
  const permission=await readFolderOperation(()=>handle.queryPermission({mode:'read'}),signal);
  signal?.throwIfAborted();
  if(permission!=='granted'&&await readFolderOperation(()=>handle.requestPermission({mode:'read'}),signal,null)!=='granted')throw Error('Autorisez la lecture de ce dossier sur ce poste ou choisissez-le à nouveau.');
 }
 signal?.throwIfAborted();
 memory.set(key(email,id),handle);return handle;
}
export async function scanFolder(handle:DirectoryHandle,signal:AbortSignal,progress:(count:number)=>void):Promise<DirectoryIndex>{
 const files:IndexedMedia[]=[];let visited=0,partial=false,limitReached=false;
 async function walk(folder:DirectoryHandle,prefix:string,depth:number):Promise<void>{
   if(depth>12){partial=true;return;}
   signal.throwIfAborted();const iterator=folder.entries();let complete=false;
   try{while(!limitReached){
    const next=await readFolderOperation<Awaited<ReturnType<typeof iterator.next>>>(()=>iterator.next(),signal);signal.throwIfAborted();
    if(next.done){complete=true;break;}
    const [name,entry]=next.value;
    if(++visited>10000||files.length>=1000){partial=true;limitReached=true;break;}
    const path=prefix+name;if(!relativePathSchema.safeParse(path).success){partial=true;continue;}
    if(entry.kind==='directory'){await walk(entry as DirectoryHandle,path+'/',depth+1);}
    else if(/\.(mp4|webm|png|jpe?g|webp)$/i.test(name)){
      try{const file=await readFolderOperation(()=>(entry as FileSystemFileHandle).getFile(),signal);signal.throwIfAborted();if(file.size>0&&file.size<=64*1024**3&&name.length<=200)files.push({path,name,size:file.size,modified:file.lastModified});else partial=true;}
      catch(error){signal.throwIfAborted();if(error instanceof FolderReadTimeout)throw error;if(error instanceof DOMException&&error.name==='NotAllowedError')throw error;partial=true;}
    }
    if(visited%25===0){progress(files.length);await new Promise<void>(resolve=>setTimeout(resolve,0));}
   }}catch(error){signal.throwIfAborted();if(error instanceof FolderReadTimeout)throw error;if(error instanceof DOMException&&error.name==='NotAllowedError')throw error;if(!prefix)throw Error('Impossible de lire ce dossier. Vérifiez son accès et la connexion au réseau.');partial=true;}
   finally{if(!complete&&iterator.return)try{void Promise.resolve(iterator.return()).catch(()=>{});}catch{/* Best effort only: a disconnected iterator may never settle. */}}
 }
 try{await walk(handle,'',0);}catch(error){if(error instanceof DOMException&&error.name==='NotAllowedError')throw Error('L’accès au dossier a été retiré. Reconnectez-le.');throw error;}signal.throwIfAborted();progress(files.length);
 return {kind:'directory',name:handle.name.slice(0,120),files:files.sort((a,b)=>a.path.localeCompare(b.path)),scannedAt:new Date().toISOString(),partial};
}
export async function indexedFile(handle:DirectoryHandle,entry:IndexedMedia,signal?:AbortSignal){
 const path=relativePathSchema.parse(entry.path),parts=path.split('/');let dir:DirectoryHandle=handle;
 for(const part of parts.slice(0,-1))dir=await readFolderOperation<FileSystemDirectoryHandle|SelectedFolder>(()=>dir.getDirectoryHandle(part,{create:false}),signal) as DirectoryHandle;
 const fileHandle=await readFolderOperation(()=>dir.getFileHandle(parts.at(-1)!,{create:false}),signal),file=await readFolderOperation(()=>fileHandle.getFile(),signal);
 if(file.size!==entry.size||file.lastModified!==entry.modified)throw new IndexedFileChanged();
 return {file,handle:sessionFolder(handle)?undefined:fileHandle as ReadHandle};
}
