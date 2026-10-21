// Resolve the archived repositories' gitlinks through public, pinned Git trees.
// No credentials, software execution, extraction, build, or publication.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const audit=JSON.parse(await readFile(resolve(root,'reports/encoder-source-audit/archive-content-audit-2026-09-23.json'),'utf8'));
const records=[];
for(const component of audit.components.filter(item=>item.gitmodules.length)){
  if(!/^[\w.-]+\/[\w.-]+$/.test(component.repository)||!/^[a-f0-9]{40}$/.test(component.commit))throw Error('Invalid pinned repository');
  const url=`https://api.github.com/repos/${component.repository}/git/trees/${component.commit}?recursive=1`;
  const response=await fetch(url,{headers:{Accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('Git tree HTTP '+response.status);
  const json=await response.json();if(json.truncated||!Array.isArray(json.tree)||json.tree.length>100000)throw Error('Incomplete Git tree');
  const declared=component.gitmodules.flatMap(item=>item.gitmodules.split(/\[submodule[^\]]+\]/).slice(1).map(section=>({path:section.match(/^\s*path\s*=\s*(.+)$/m)?.[1].trim(),url:section.match(/^\s*url\s*=\s*(.+)$/m)?.[1].trim()})));
  const gitlinks=json.tree.filter(item=>item.mode==='160000');
  for(const link of gitlinks){
    const declaration=declared.find(item=>item.path===link.path);
    if(!declaration?.url||!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?$/.test(declaration.url)||!/^[a-f0-9]{40}$/.test(link.sha))throw Error('Unresolved or unexpected gitlink');
    const repository=declaration.url.replace('https://github.com/','').replace(/\.git$/,'');
    records.push({parent:component.name,parentRepository:component.repository,parentCommit:component.commit,path:link.path,repository,commit:link.sha,evidence:url,archive:`https://codeload.github.com/${repository}/tar.gz/${link.sha}`});
  }
  if(gitlinks.length!==declared.length)throw Error('Declared/gitlink counts differ');
  console.log(component.name+': '+gitlinks.length+' pinned gitlinks');
}
await writeFile(resolve(root,'reports/encoder-source-audit/gitlinks-2026-09-23.json'),JSON.stringify({status:'pinned-source-gitlinks-not-build-attestation',checkedAt:new Date().toISOString(),records},null,2)+'\n');
console.log(JSON.stringify(records));
