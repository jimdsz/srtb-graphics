import {copyFile,lstat,readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

// Exact bytes in the sealed artifact deployed by the root on 072572a6.
// This is not a reconstruction from the current source or an unverified cache.
export const publishedBAEditor={
  deployment:'https://072572a6.srtb-graphics.pages.dev',
  inventorySha256:'ccd0e09a25ad964a30bc56ddcda6c90a47bb0fc4b156cc406f4313319bec433b',
  files:{
    'graphic.mjs':{bytes:18764,sha256:'99ac9874c6a9172dd6f9326ff21851255e9cb4313f68b1c173cc2e206f474d00'},
    'portable.mjs':{bytes:18549,sha256:'ae84b1797244f5d13bcf39a35a5f831967d5ec9c9d6776093e6fc7612efc498c'},
    'text-layout.mjs':{bytes:3214,sha256:'455f65c85cc8301afd4a10b43f87d0d8d89ee08143b72da736993f3e1ffce40d'},
  },
};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function regularFile(path){const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Regular BA resource required: '+path);return readFile(path);}
export async function verifyPublishedBAEditor(root){
  const names=await readdir(resolve(root,'public/studio-engines/ba-text-v1'));
  if(JSON.stringify(names.sort())!==JSON.stringify(Object.keys(publishedBAEditor.files).sort()))throw Error('Unexpected resource in published BA v1 directory.');
  for(const [name,expected]of Object.entries(publishedBAEditor.files)){
    const path=resolve(root,'public/studio-engines/ba-text-v1',name),bytes=await regularFile(path);
    if(bytes.length!==expected.bytes||hash(bytes)!==expected.sha256)throw Error('Published BA v1 changed: '+name);
  }
}
export async function restorePublishedBAEditor(root){
  const inventoryBytes=await regularFile(resolve(root,'.tools/native-release/inventory.json'));
  if(hash(inventoryBytes)!==publishedBAEditor.inventorySha256)throw Error('The sealed 072572a6 inventory is no longer available. Do not guess historical BA bytes.');
  const inventory=JSON.parse(inventoryBytes.toString('utf8')),copies=[];
  for(const [name,expected]of Object.entries(publishedBAEditor.files)){
    const relative='studio-engines/ba-text-v1/'+name,from=resolve(root,'dist-studio-native',relative),to=resolve(root,'public',relative);
    const record=inventory.files.find(file=>file.path===relative),bytes=await regularFile(from);
    if(!record||record.bytes!==expected.bytes||record.sha256!==expected.sha256||bytes.length!==expected.bytes||hash(bytes)!==expected.sha256)throw Error('Unverified historical BA resource: '+name);
    for(const parent of ['public','public/studio-engines','public/studio-engines/ba-text-v1'])if((await lstat(resolve(root,parent))).isSymbolicLink())throw Error('Symlinked BA destination refused.');
    if((await lstat(to)).isSymbolicLink())throw Error('Symlinked BA resource refused.');
    copies.push({from,to});
  }
  // Verify every source before replacing any of our unpublished adapter edits.
  for(const {from,to}of copies)await copyFile(from,to);
  await verifyPublishedBAEditor(root);
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const root=resolve(import.meta.dirname,'..');
  if(process.argv[2]==='--restore')await restorePublishedBAEditor(root);
  else if(process.argv[2]==='--check')await verifyPublishedBAEditor(root);
  else throw Error('Use --check or --restore for the three exact published BA v1 files.');
  console.log('Published BA v1 bytes match deployment072572a6.');
}
