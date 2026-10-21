import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat,readdir,readFile,rename,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const library=path.join(root,'public/library/v1.7.0');
const reportPath=path.join(root,'reports/library-intake.json');
const extensions=JSON.parse(await readFile(path.join(root,'src/studio/catalogue.extensions.json'),'utf8'));
const report=JSON.parse(await readFile(reportPath,'utf8'));
const prefixes=new Set(['_shared',...extensions.map(item=>item.id)]);

async function digest(filename){
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(filename))hash.update(chunk);
  return hash.digest('hex');
}
async function collect(directory,relative){
  const result=[];
  for(const item of await readdir(directory,{withFileTypes:true})){
    if(item.isSymbolicLink())throw Error(`Lien symbolique refusé : ${relative}/${item.name}`);
    const filename=path.join(directory,item.name),key=`${relative}/${item.name}`;
    if(item.isDirectory()){result.push(...await collect(filename,key));continue;}
    if(!item.isFile())throw Error(`Entrée de bibliothèque invalide : ${key}`);
    const stat=await lstat(filename);
    result.push({key:key.replaceAll('\\','/'),bytes:stat.size,sha256:await digest(filename),storage:stat.size>24*1024*1024?'private-object':'protected-asset'});
  }
  return result;
}

const retainedAssets=report.assets.filter(asset=>!prefixes.has(asset.key.split('/')[0]));
const added=[];
for(const prefix of prefixes)added.push(...await collect(path.join(library,prefix),prefix));
const retainedTemplates=report.templates.filter(item=>!prefixes.has(item.id));
const templates=[...retainedTemplates,...extensions.map(item=>({id:item.id,version:item.version,fields:Object.keys(item.fields).length,legacyOfflineDeclared:item.legacyOfflineDeclared}))];
const next={...report,templates,assets:[...retainedAssets,...added].sort((a,b)=>a.key.localeCompare(b.key))};
const temporary=`${reportPath}.tmp`;
await writeFile(temporary,`${JSON.stringify(next,null,2)}\n`);
await rename(temporary,reportPath);
console.log(JSON.stringify({templates:templates.length,addedAssets:added.length,totalAssets:next.assets.length},null,2));
