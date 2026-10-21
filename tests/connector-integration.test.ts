import test from 'node:test';
import assert from 'node:assert/strict';
import {safeMediaUrl,getTemplate,templateDefaults,validateProjectData} from '../src/studio/domain';
import {profileAssetSchema} from '../src/studio/preparation-profile-model';
import {secureHeaders} from '../server/http';
import {isPublicAppPath} from '../server/firebase-auth';
import connectorRelease from '../connector/windows/release.json';
import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const events=new EventTarget();Object.assign(globalThis,{window:events});
const media=await import('../src/studio/local-media');
const url='http://127.0.0.1:43871/v1/media/'+'a'.repeat(64);
const descriptor={url:'local-media:'+'b'.repeat(64)+':32',name:'programme.mp4',mimeType:'video/mp4'};
test('connector ticket allowed only for in-memory rendering, never for saved project or shared profile',()=>{
 assert.equal(safeMediaUrl(url,true),true);assert.equal(safeMediaUrl(url),false);assert.equal(profileAssetSchema.safeParse({...descriptor,url}).success,false);
 for(const wrong of [url.replace('43871','43872'),url.replace('127.0.0.1','example.org'),url+'?token=1',url+'/../roots',url.replace('http:','https:')])assert.equal(safeMediaUrl(wrong,true),false);
 const t=getTemplate('BTV_PopUp'),data={...templateDefaults(t),_media_popup_url:descriptor};
 media.bindConnectorMedia(descriptor,url);assert.equal(media.connectedLocal(descriptor.url),true);assert.equal(media.localURL(descriptor.url),url);
 const stable=media.stableLocalData(t,data);assert.equal(JSON.stringify(stable).includes('127.0.0.1'),false);assert.doesNotThrow(()=>validateProjectData(t,stable));
 const resolved=media.resolveLocalData(t,data);assert.doesNotThrow(()=>validateProjectData(t,resolved,true));assert.throws(()=>validateProjectData(t,resolved));
 events.dispatchEvent(new Event('srtb-connector-disconnect'));assert.equal(media.connectedLocal(descriptor.url),false);assert.throws(()=>media.localURL(descriptor.url));
});
test('security policy permits only fixed local media endpoint, not localhost scripts or any network hosts',()=>{
 const csp=secureHeaders(new Response('ok')).headers.get('Content-Security-Policy')!;
 const directives=Object.fromEntries(csp.split(';').map(s=>{const [key,...value]=s.trim().split(' ');return [key,value];}));
 for(const key of ['connect-src','media-src','img-src'])assert.ok(directives[key].includes('http://127.0.0.1:43871'));
 for(const key of ['script-src','frame-src','font-src'])assert.ok(!directives[key].some(s=>s.includes('127.0.0.1')));
 assert.equal(csp.includes('*'),false);
});

test('the internal Windows download is private and byte-identical to the qualified package',async()=>{
 const route='/downloads/'+connectorRelease.file;
 assert.equal(isPublicAppPath(route),false);
 assert.equal(connectorRelease.status,'internal-pilot-unsigned');
 assert.match(connectorRelease.file,/^graphics-connector-windows-x64-[a-f\d]{8}\.exe$/);
 const file=new URL('../public'+route,import.meta.url),bytes=await readFile(file);
 assert.equal((await stat(file)).size,connectorRelease.bytes);
 assert.equal(bytes.length,connectorRelease.bytes);assert.ok(bytes.length<25*1024**2);
 assert.equal(createHash('sha256').update(bytes).digest('hex'),connectorRelease.sha256);
});
