import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// @ts-ignore The release utility is a native JavaScript module.
import {copyHashedAssets} from '../scripts/studio-asset-history.mjs';

test('release history retains the hashed PDF module across builds and rejects collisions',async()=>{
  const root=await mkdtemp(join(tmpdir(),'srtb-assets-'));
  try{
    const source=join(root,'source'),target=join(root,'history');
    await mkdir(source);
    const name='pdf.worker.min-Dswkl-cV.mjs';
    await writeFile(join(source,name),'export const version = 1;');
    assert.equal(await copyHashedAssets(source,target),1);
    assert.equal(await readFile(join(target,name),'utf8'),'export const version = 1;');
    assert.equal(await copyHashedAssets(source,target),1);
    await writeFile(join(source,name),'export const version = 2;');
    await assert.rejects(copyHashedAssets(source,target),/Collision/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('release history continues to reject unversioned modules, maps and HTML',async()=>{
  const root=await mkdtemp(join(tmpdir(),'srtb-assets-'));
  try{
    for(const [index,name]of ['worker.mjs','app-12345678.js.map','index-12345678.html'].entries()){
      const source=join(root,String(index));await mkdir(source);
      await writeFile(join(source,name),'private');
      await assert.rejects(copyHashedAssets(source,join(root,'history')),/non versionnée/);
    }
  }finally{await rm(root,{recursive:true,force:true});}
});
