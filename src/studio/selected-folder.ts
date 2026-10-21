import {relativePathSchema} from './day-planner-model';

/** Read-only snapshot explicitly selected through a directory file input.
 * No handles, file bytes or absolute paths are persisted or sent to a server. */
type SelectedFile={kind:'file';name:string;getFile:()=>Promise<File>};
export class SelectedFolder {
 readonly kind='directory' as const;
 readonly sessionOnly=true;
 readonly children=new Map<string,SelectedFolder|SelectedFile>();
 constructor(readonly name:string){}
 async queryPermission(_options?:{mode:'read'}){return 'granted' as const;}
 async requestPermission(_options?:{mode:'read'}){return 'granted' as const;}
 async *entries(){yield* this.children.entries();}
 async getDirectoryHandle(name:string,_options?:{create?:boolean}):Promise<SelectedFolder>{
  const entry=this.children.get(name);
  if(!entry||entry.kind!=='directory')throw new DOMException('Dossier absent de la sélection.','NotFoundError');
  return entry;
 }
 async getFileHandle(name:string,_options?:{create?:boolean}):Promise<SelectedFile>{
  const entry=this.children.get(name);
  if(!entry||entry.kind!=='file')throw new DOMException('Fichier absent de la sélection. Resélectionnez le dossier.','NotFoundError');
  return entry;
 }
}

/** A bounded metadata pass; unrelated formats are not retained in memory. */
export async function selectedFolder(files:ArrayLike<File>,signal?:AbortSignal):Promise<SelectedFolder>{
 if(!files.length)throw Error('Ce dossier est vide ou sa lecture a été annulée.');
 if(files.length>10000)throw Error('Ce dossier contient plus de 10 000 fichiers. Choisissez un sous-dossier de programmes.');
 let root:SelectedFolder|undefined;
 for(let i=0;i<files.length;i++){
  signal?.throwIfAborted();const file=files[i],path=file.webkitRelativePath;
  if(!relativePathSchema.safeParse(path).success||!path.includes('/'))throw Error('Le navigateur n’a pas fourni un chemin de dossier valide. Resélectionnez un dossier.');
  const [name,...parts]=path.split('/');
  if(!root)root=new SelectedFolder(name);
  if(root.name!==name)throw Error('Choisissez un seul dossier à la fois.');
  if(parts.at(-1)!==file.name)throw Error('Nom et chemin du fichier incohérents. Resélectionnez le dossier.');
  if(/\.(mp4|webm|png|jpe?g|webp)$/i.test(file.name)){
   let folder=root;
   for(const part of parts.slice(0,-1)){
    let entry=folder.children.get(part);
    if(entry?.kind==='file')throw Error('Deux fichiers possèdent des chemins incompatibles.');
    if(!entry){entry=new SelectedFolder(part);folder.children.set(part,entry);}
    folder=entry;
   }
   if(folder.children.has(file.name))throw Error('Deux fichiers possèdent le même chemin. Resélectionnez le dossier.');
   folder.children.set(file.name,{kind:'file',name:file.name,getFile:async()=>file});
  }
  if(i%50===49)await new Promise<void>(resolve=>setTimeout(resolve,0));
 }
 signal?.throwIfAborted();return root!;
}
