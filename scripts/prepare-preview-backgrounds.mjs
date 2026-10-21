import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {zipSync,unzipSync} from 'fflate';
// Derived transport bundles only. Never modify the versioned delivery library.
const output=resolve('public/preview-media/v2');await mkdir(output,{recursive:true});
for(const id of ['BTV_BA_TDS','BTV_BA_TDS_SUIVI_DE']){
  const root=resolve('public/library/v1.7.0',id),data=JSON.parse(await readFile(resolve(root,'lib/lottie-template.json'),'utf8')),config=data.btvAutomation.backgroundSequence;
  const entries={};
  for(let frame=config.firstFrame;frame<=config.lastFrame;frame++)entries[String(frame)]=new Uint8Array(await readFile(resolve(root,config.path.replace('{frame:04}',String(frame).padStart(4,'0')))));
  const files={},frames={};
  for(const [frame,bytes]of Object.entries(entries)){
    const name=createHash('sha256').update(bytes).digest('hex')+'.png';frames[frame]=name;files[name]=bytes;
  }
  files['index.json']=new TextEncoder().encode(JSON.stringify({version:2,frames}));
  const bundle=zipSync(files,{level:6,mtime:new Date('2026-01-01T00:00:00Z')}),decoded=unzipSync(bundle);
  for(const [key,bytes]of Object.entries(entries))if(!Buffer.from(bytes).equals(Buffer.from(decoded[frames[key]])))throw Error('Frame bundle mismatch: '+id+' '+key);
  if(bundle.length>24*1024*1024)throw Error('Bundle exceeds safe Pages size');
  await writeFile(resolve(output,id+'.zip'),bundle);
  console.log(JSON.stringify({id,frames:Object.keys(entries).length,uniqueFrames:Object.keys(files).length-1,bytes:bundle.length,sha256:createHash('sha256').update(bundle).digest('hex')}));
}
