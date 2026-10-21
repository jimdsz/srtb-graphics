import {mkdir,readdir,readFile,copyFile,lstat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

// Keep only content-addressed frontend modules. An open tab can still import
// its export engine after a release. HTML, workers, media and secrets are never
// retained here. These public UI modules contain no user data. Every request
// still goes through the middleware; project data/media keep their access checks.
export async function copyHashedAssets(source,target){
  let entries;try{entries=await readdir(source,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return 0;throw error;}
  await mkdir(target,{recursive:true});let count=0;
  for(const entry of entries){
    if(entry.name==='srtb-theme-init.js'&&entry.isFile()&&!entry.isSymbolicLink())continue;
    if(!entry.isFile()||entry.isSymbolicLink()||!/^[-\w.]+-[-\w]{8}\.(?:m?js|css|wasm|woff2?|otf|ttf|png|jpe?g|webp|svg)$/.test(entry.name))throw Error('Ressource non versionnée dans les modules du studio : '+entry.name);
    const from=resolve(source,entry.name),to=resolve(target,entry.name),sourceBytes=await readFile(from);
    try{
      if(!(await lstat(to)).isFile())throw Error('Destination de module incorrecte.');
      const existing=await readFile(to),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
      if(hash(existing)!==hash(sourceBytes))throw Error('Collision de module versionné : '+entry.name);
    }catch(error){if(error.code!=='ENOENT')throw error;await copyFile(from,to);}
    count++;
  }
  if((await readdir(target)).length>9000)throw Error('Archive de modules volumineuse : préparer une purge planifiée après fermeture des anciennes sessions.');
  return count;
}
export async function preserveStudioAssets(root){return copyHashedAssets(resolve(root,'dist-studio/assets'),resolve(root,'.studio-asset-history'));}
export async function restoreStudioAssets(root){return copyHashedAssets(resolve(root,'.studio-asset-history'),resolve(root,'dist-studio/assets'));}
