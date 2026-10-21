import test from 'node:test';
import assert from 'node:assert/strict';
import {getTemplate,templateDefaults,validateProjectData} from '../src/studio/domain.ts';
import {cataloguePreviewData,catalogueMediaExample,catalogueMediaExampleSvg,isCatalogueMediaExample} from '../src/studio/catalogue-preview.ts';
import {localURL} from '../src/studio/local-media.ts';

test('library examples cover the native media occluders without changing project defaults',async()=>{
 for(const [id,count]of [['BTV_Renvoi',1],['BTV_Evenement',2],['BTV_Semainier',9]]as const){
  const t=getTemplate(id),before=templateDefaults(t),preview=cataloguePreviewData(t);
  const examples=Object.entries(preview).filter(([,v])=>typeof v==='object'&&v.url.startsWith('blob:'));
  assert.equal(examples.length,count,id);assert.deepEqual(templateDefaults(t),before);
  assert.doesNotThrow(()=>validateProjectData(t,preview,true));
  assert.throws(()=>validateProjectData(t,preview,false));
  for(const [key,value]of examples){assert.equal(before[key],'',key);assert.ok(typeof value==='object');assert.equal(localURL(value.url),value.url);const svg=await(await fetch(value.url)).text();assert.ok(svg.length<2500);assert.match(svg,/width="1920" height="1080"/);assert.match(svg,/M0 0H1920V1080H0z/);assert.doesNotMatch(svg,/<script|https?:\/\/[^w]|<image/);}
 }
});
test('labels in examples are escaped and cannot inject SVG nodes',()=>{
 assert.match(catalogueMediaExampleSvg('<script>&"'),/&lt;script&gt;&amp;&quot;/);
 assert.strictEqual(catalogueMediaExample('Renvoi'),catalogueMediaExample('Renvoi'));
 assert.equal(isCatalogueMediaExample('blob:unknown'),false);
 assert.throws(()=>localURL('blob:unknown'),/média local manque/);
});
