import {test,afterEach,mock} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {announcementVoiceSelectionKey,announcementVoiceSources,announcementVoicesReady,reconnectAnnouncementVoice} from '../src/studio/announcement-local-voices';
import AnnouncementLocalVoices from '../src/studio/AnnouncementLocalVoices';
import type {DerivationAnnouncement} from '../src/studio/derivation-announcements';
import {connectedLocal,localURL} from '../src/studio/local-media';
import {localBindings} from '../src/studio/local-files';
import {fingerprintStream} from '../src/studio/local-fingerprint-stream';

const asset=(text:string,name='Voix.wav')=>({url:`local-media:${createHash('sha256').update(text).digest('hex')}:${Buffer.byteLength(text)}`,name,mimeType:'audio/wav'});
const a=asset('abcdef'),b=asset('ghijkl');
const profile=(id='voice-a',revision=1,source=a)=>({id,revision,data:{source}});
const announcement=(id='voice-a',revision=1,key:DerivationAnnouncement['key']='today'):DerivationAnnouncement=>({key,time:'',formats:['tv'],voice:{mode:'profile',profileId:id,revision}});
let gate:Promise<unknown>|undefined,workers=0;
class HashWorker{
  onmessage:((event:{data:{progress?:number;hash?:string}})=>void)|null=null;onerror:((cause:unknown)=>void)|null=null;controller=new AbortController();
  constructor(){workers++;}
  postMessage(message:{type:string;file:File}){if(message.type!=='hash')return;void Promise.resolve(gate).then(()=>fingerprintStream(message.file,progress=>this.onmessage?.({data:{progress}}),this.controller.signal,async()=>{})).then(hash=>{if(!this.controller.signal.aborted)this.onmessage?.({data:{hash}});},cause=>{if(!this.controller.signal.aborted)this.onerror?.(cause);});}
  terminate(){this.controller.abort();}
}
const previousWorker=Object.getOwnPropertyDescriptor(globalThis,'Worker');
function hashing(){Object.defineProperty(globalThis,'Worker',{configurable:true,value:HashWorker});}
afterEach(()=>{mock.restoreAll();gate=undefined;workers=0;for(const url of new Set([...localBindings.values()].map(binding=>binding.url)))URL.revokeObjectURL(url);localBindings.clear();if(previousWorker)Object.defineProperty(globalThis,'Worker',previousWorker);else Reflect.deleteProperty(globalThis,'Worker');});

test('aggregate resolves only exact selected revisions and deduplicates shared source bytes',()=>{
  const values=[announcement(),announcement('voice-b',3,'tomorrow')],profiles=[profile('voice-a',2,b),profile(),profile('voice-b',3,a),profile('unused',1,b)],before=structuredClone({values,profiles});
  const selected=announcementVoiceSources(values,profiles);
  assert.deepEqual(selected.references,[a]);assert.equal(selected.unresolved,0);assert.deepEqual({values,profiles},before);
  assert.equal(announcementVoiceSelectionKey(values),announcementVoiceSelectionKey([...values].reverse()));
  assert.equal(announcementVoiceSources([announcement()],profiles.filter(item=>item.revision!==1)).unresolved,1);
});

test('export waits for exact current pins and local bindings, not a stale catalogue callback',()=>{
  const values=[announcement()],selected=announcementVoiceSources(values,[profile()]);
  assert.equal(announcementVoicesReady(values,null,()=>true),false);
  assert.equal(announcementVoicesReady(values,selected,()=>false),false);
  assert.equal(announcementVoicesReady(values,selected,()=>true),true);
  assert.equal(announcementVoicesReady([announcement('voice-a',2)],selected,()=>true),false);
  assert.equal(announcementVoicesReady(values,announcementVoiceSources(values,[profile('voice-a',2)]),()=>true),false);
  assert.equal(announcementVoicesReady([{...values[0],voice:{mode:'none'}}],null),true);
  assert.equal(announcementVoicesReady([{...values[0],voice:{mode:'pending'}}],null),true,'The separate explicit pending-voice guard still owns pending voices.');
});

test('private shared sources need no local picker; malformed or provisional sources are not treated as available',()=>{
  const values=[announcement()],shared={...a,url:'/api/graphics/media/00000000-0000-4000-8000-000000000001/content'};
  assert.deepEqual(announcementVoiceSources(values,[profile('voice-a',1,shared)]).references,[]);
  assert.equal(announcementVoicesReady(values,announcementVoiceSources(values,[profile('voice-a',1,shared)]),()=>false),true);
  for(const source of [{...a,url:'blob:temporary'},{...a,url:'https://external.example/a.wav'},{...a,mimeType:'image/png'}])assert.equal(announcementVoiceSources(values,[profile('voice-a',1,source)]).unresolved,1);
});

test('matching bytes reconnect only after hashing, without fetch, name replacement or revision mutation',async()=>{
  hashing();const requests=mock.method(globalThis,'fetch',async()=>{throw Error('No network permitted');});
  let release!:()=>void;gate=new Promise<void>(resolve=>{release=resolve;});
  const source=Object.freeze({...a}),values=Object.freeze([announcement()]),before=structuredClone(values);
  const pending=reconnectAnnouncementVoice(source,new File(['abcdef'],'Different name.wav',{type:'audio/wav'}),()=>{});
  assert.equal(connectedLocal(source.url),false);release();await pending;
  assert.equal(connectedLocal(source.url),true);assert.match(localURL(source.url),/^blob:/);assert.equal(source.name,'Voix.wav');assert.deepEqual(values,before);assert.equal(requests.mock.callCount(),0);
  assert.equal(announcementVoicesReady(values,announcementVoiceSources(values,[profile()])),true);
});

test('same name, size and MIME with wrong bytes is refused without binding either reference',async()=>{
  hashing();const before=structuredClone(a);
  await assert.rejects(reconnectAnnouncementVoice(a,new File(['fedcba'],'Voix.wav',{type:'audio/wav'}),()=>{}),/Empreinte différente.*refusé/);
  assert.deepEqual(a,before);assert.equal(connectedLocal(a.url),false);assert.equal(localBindings.size,0);
  assert.equal(announcementVoicesReady([announcement()],announcementVoiceSources([announcement()],[profile()])),false);
});

test('wrong size or non-audio choice is refused before hash work; no metadata reconnect',async()=>{
  hashing();await assert.rejects(reconnectAnnouncementVoice(a,new File(['abc'],'Voix.wav',{type:'audio/wav'}),()=>{}),/taille différente/);
  await assert.rejects(reconnectAnnouncementVoice(a,new File(['abcdef'],'Voix.png',{type:'image/png'}),()=>{}),/fichier audio/);
  assert.equal(workers,0);assert.equal(localBindings.size,0);
});

test('wrong file cannot replace an already connected pin; ready panel no longer asks for that file',async()=>{
  hashing();await reconnectAnnouncementVoice(a,new File(['abcdef'],'Voix.wav',{type:'audio/wav'}),()=>{});const before=localURL(a.url);
  await assert.rejects(reconnectAnnouncementVoice(a,new File(['fedcba'],'Voix.wav',{type:'audio/wav'}),()=>{}),/Empreinte différente/);
  assert.equal(localURL(a.url),before);assert.equal(localBindings.size,1);
  const sources=announcementVoiceSources([announcement()],[profile()]),html=renderToStaticMarkup(createElement(AnnouncementLocalVoices,{sources}));
  assert.match(html,/1\/1 disponibles/);assert.doesNotMatch(html,/type="file"/);assert.doesNotMatch(html,/L’export attend la reconnexion/);assert.equal(announcementVoicesReady([announcement()],sources),true);
});

test('cancellation preserves pins and prevents late bytes from becoming connected',async()=>{
  hashing();let release!:()=>void;gate=new Promise<void>(resolve=>{release=resolve;});
  const task=new AbortController(),pending=reconnectAnnouncementVoice(a,new File(['abcdef'],'Voix.wav',{type:'audio/wav'}),()=>{},task.signal);
  task.abort();await assert.rejects(pending,{name:'AbortError'});release();await new Promise(resolve=>setTimeout(resolve,10));assert.equal(connectedLocal(a.url),false);assert.equal(localBindings.size,0);
});

test('aggregated panel exposes explicit labelled local reconnect actions without replacing selected profiles',()=>{
  const sources=announcementVoiceSources([announcement()],[profile('voice-a',1,{...a,name:'<Voix>.wav'})]);
  const html=renderToStaticMarkup(createElement(AnnouncementLocalVoices,{sources}));
  assert.match(html,/aria-label="Reconnecter les fichiers des voix choisies"/);assert.match(html,/0\/1 disponibles/);assert.match(html,/Reconnecter le fichier · &lt;Voix&gt;\.wav/);assert.match(html,/type="file"/);assert.match(html,/aucun téléversement/);assert.match(html,/L’export attend la reconnexion/);
  for(const button of html.matchAll(/<button\b[^>]*>/g))assert.match(button[0],/type="button"/);
});

test('missing revision remains visible without inventing a source or showing a newer file',()=>{
  const sources=announcementVoiceSources([announcement('voice-a',7)],[profile('voice-a',8)]);
  const html=renderToStaticMarkup(createElement(AnnouncementLocalVoices,{sources}));
  assert.match(html,/1 révision\(s\) épinglée\(s\) non chargée/);assert.doesNotMatch(html,/type="file"/);assert.equal(announcementVoicesReady([announcement('voice-a',7)],sources),false);
});

test('create modal keeps reconnect outside locked choices and gates export button plus imperative handler, not draft preparation',()=>{
  const source=readFileSync(new URL('../src/studio/DerivationPanel.tsx',import.meta.url),'utf8');
  assert.match(source,/<\/fieldset>\s*\{currentVoiceSources\?<AnnouncementLocalVoices/);
  assert.match(source,/<AnnouncementLocalVoices[^>]+disabled=\{busy\|\|disabled\}/);
  assert.match(source,/if\(exportNow&&!announcementVoicesReady\(announcements,voiceSources\)\)/);
  assert.match(source,/disabled=\{busy\|\|disabled\|\|invalid\|\|!!attempt\|\|pendingVoice\|\|!localVoicesReady\}/);
  assert.match(source,/disabled=\{busy\|\|disabled\|\|invalid\|\|!!attempt\} onClick=\{\(\)=>void submit\(false\)\}/);
});
