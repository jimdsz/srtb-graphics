import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {getTemplate,templateDefaults} from '../src/studio/domain';
import type {Project} from '../src/studio/domain';
import {buildDeliveryPlan} from '../src/studio/delivery-plan';
import {packageDocuments} from '../src/studio/delivery-runtime';
import {writeDeliveryZip} from '../src/studio/delivery-zip';

const template=getTemplate('BTV_PopUp'),inventory=JSON.parse(await readFile('reports/library-intake.json','utf8'));
const project:Project={id:'recette-locale-popup',title:'Recette Pop-up',template_id:template.id,template_version:template.version,library_version:template.libraryVersion,status:'approved',revision:1,created_by:'recette@example.test',updated_by:'recette@example.test',created_at:'',updated_at:'',archived:0,data:{...templateDefaults(template),_background_visible:false,_media_background_url:{url:`local-media:${'a'.repeat(64)}:120`,name:'fond-absent.mp4',mimeType:'video/mp4'}}};
const plan=buildDeliveryPlan(project,template,inventory.assets,[]),chunks:Uint8Array[]=[],signal=new AbortController().signal;
assert.ok(!plan.files.some(f=>f.url.startsWith('local-media:')));
let closed=false;
await writeDeliveryZip(plan,packageDocuments(plan,template),{
  write:async bytes=>{chunks.push(bytes);},close:async()=>{closed=true;},abort:async()=>{chunks.length=0;}
},signal,()=>{},async (url,init)=>fetch(new URL(String(url),'http://127.0.0.1:5192'),init));
assert.ok(closed);
const archive=Buffer.concat(chunks),files=unzipSync(archive),manifest=JSON.parse(new TextDecoder().decode(files['INVENTAIRE.json']));
for(const file of manifest.files){assert.equal(files[file.path].length,file.bytes);assert.equal(createHash('sha256').update(files[file.path]).digest('hex'),file.sha256);}
await mkdir('reports/reliability',{recursive:true});
await writeFile('reports/reliability/popup-delivery.zip',archive);
await writeFile('reports/reliability/delivery.json',JSON.stringify({files:Object.keys(files).length,bytes:archive.length,hashesVerified:manifest.files.length,unusedMediaRequired:false},null,2));
console.log(`PASS Pop-up ZIP créé et décompressé : ${Object.keys(files).length} fichiers, ${manifest.files.length} empreintes vérifiées.`);
