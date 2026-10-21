// Data inspection only: no archive extraction to disk, compiler or source execution.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const root=resolve(import.meta.dirname,'..'),folder=resolve(root,'.tools/cbr-source-candidates');
const inventory=JSON.parse(await readFile(resolve(folder,'inventory.json'),'utf8'));
if(inventory.status!=='source-candidates-not-approved-for-release')throw Error('Unapproved inventory type');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function tar(args,maxBuffer=16*1024**2){
  const result=spawnSync('tar.exe',args,{encoding:'utf8',maxBuffer,windowsHide:true,timeout:20000});
  if(result.error||result.status!==0)throw Error(result.error?.message||'Archive read failed: '+result.stderr);
  return result.stdout;
}
const report={status:'candidate-source-data-inspected-not-release-approval',checkedAt:new Date().toISOString(),components:[],notes:[
  'No source compiled, installed, executed, or extracted to the filesystem.',
  'Archive integrity and presence of notices do not prove that the qualified binary was built from these sources.',
  'Nested notices are inventoried, not automatically interpreted as the effective license of the full binary.',
  'Gitlink commits must be resolved separately; GitHub source archives omit their contents.',
]};
for(const component of inventory.components){
  if(!/^[A-Za-z0-9_.-]+--[A-Za-z0-9_.-]+-[0-9a-f]{40}\.tar\.gz$/.test(component.file))throw Error('Unexpected source filename');
  const path=resolve(folder,component.file),bytes=await readFile(path);
  if(bytes.length!==component.bytes||sha(bytes)!==component.sha256)throw Error('Candidate archive changed: '+component.name);
  const paths=tar(['-tf',path]).split(/\r?\n/).filter(Boolean);
  const prefix=paths[0]?.split('/')[0]+'/';
  if(!prefix||paths.some(name=>!name.startsWith(prefix)||name.includes('\\')||name.split('/').includes('..')))throw Error('Archive names invalid: '+component.name);
  const files=paths.filter(name=>!name.endsWith('/'));
  const extraNotices=component.name==='zlib'?['README','zlib.h']:component.name==='FreeType'?['docs/FTL.TXT','docs/GPLv2.TXT']:[];
  const rootNotices=files.filter(name=>{const relative=name.slice(prefix.length);return extraNotices.includes(relative)||relative.split('/').length<=2&&/^(?:COPYING|LICENSE|LICENCE|COPYRIGHT|NOTICE)(?:[._-].*)?$/i.test(relative.split('/').at(-1));});
  const gitmodules=files.filter(name=>name.split('/').at(-1)==='.gitmodules');
  const records=[];
  for(const name of [...new Set([...rootNotices,...gitmodules])]){
    const content=tar(['-xOf',path,name],1024*1024);
    records.push({path:name.slice(prefix.length),bytes:Buffer.byteLength(content),sha256:sha(content),...(name.endsWith('/.gitmodules')?{gitmodules:content}:{})});
  }
  report.components.push({name:component.name,repository:component.repository,commit:component.sha,archiveSha256:component.sha256,archiveBytes:component.bytes,fileCount:files.length,notices:records.filter(record=>!Object.hasOwn(record,'gitmodules')),gitmodules:records.filter(record=>Object.hasOwn(record,'gitmodules'))});
  console.log(component.name+': '+files.length+' files, '+rootNotices.length+' primary notice files, '+gitmodules.length+' .gitmodules');
}
const destination=resolve(root,'reports/encoder-source-audit');await mkdir(destination,{recursive:true});
await writeFile(resolve(destination,'archive-content-audit-2026-09-23.json'),JSON.stringify(report,null,2)+'\n');
console.log('Candidate sources inspected: '+report.components.length+'. Release barrier unchanged.');
