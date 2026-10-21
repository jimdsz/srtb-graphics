import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {broadcastTemplates} from '../src/studio/domain';
import {PRESENTATIONS} from '../src/studio/presentation';
import {catalogueCompositions,QUALIFICATION_FORMATS,SOCIAL_FORMATS,MODEL_COUNT,COMPOSITION_COUNT,SOCIAL_COMPOSITION_COUNT,assertCompositionCoverage} from './catalogue-matrix';

test('qualification derives all ten active engines and thirty compositions, including converted models',()=>{
  assert.equal(MODEL_COUNT,10);assert.equal(COMPOSITION_COUNT,30);assert.equal(SOCIAL_COMPOSITION_COUNT,20);
  assert.deepEqual(QUALIFICATION_FORMATS,Object.keys(PRESENTATIONS));assert.deepEqual(SOCIAL_FORMATS,['portrait','vertical']);
  const cases=catalogueCompositions();assert.equal(new Set(cases.map(c=>c.template.id+':'+c.format)).size,30);
  for(const template of broadcastTemplates)assert.deepEqual(cases.filter(c=>c.template.id===template.id).map(c=>c.format),QUALIFICATION_FORMATS);
  for(const id of ['BTV_Renvoi','BTV_Evenement','BTV_Semainier'])assert.equal(cases.filter(c=>c.template.id===id).length,3);
});
test('coverage refuses subsets, duplicates, unknown formats and engines rather than printing a false PASS',()=>{
  const records=catalogueCompositions().map(({template,format})=>({id:template.id,format}));
  assert.doesNotThrow(()=>assertCompositionCoverage(records));
  assert.throws(()=>assertCompositionCoverage(records.slice(0,-1)),/Couverture incomplète/);
  assert.throws(()=>assertCompositionCoverage([...records.slice(1),records[1]]),/Couverture incomplète/);
  assert.throws(()=>assertCompositionCoverage([...records.slice(1),{...records[0],format:'square'}]),/Couverture incomplète/);
  assert.throws(()=>assertCompositionCoverage([...records.slice(1),{...records[0],id:'unknown'}]),/Couverture incomplète/);
  assert.doesNotThrow(()=>assertCompositionCoverage(records.filter(record=>record.format==='tv'),['tv']));
});
test('general performance, fades, typography, transport and position benches use the shared complete matrix and completion guard',()=>{
  for(const name of ['preview-performance','fade-end-contracts','typography-contracts','preview-transport-contracts','native-position-contracts']){
    const source=readFileSync(new URL('./'+name+'.ts',import.meta.url),'utf8');
    assert.match(source,/of catalogueCompositions\(\)/,name);assert.match(source,/assertCompositionCoverage\(records\)/,name);
  }
});
test('active bench labels no longer hardcode historic catalogue counts',()=>{
  for(const name of ['social-qualification.tsx','social-qualification.html','overlay-logo-qualification.html','overlay-logo-qualification.ts','text-position-qualification.tsx','native-position-contracts.ts','video-render.html','video-render.ts']){
    const source=readFileSync(new URL('./'+name,import.meta.url),'utf8');
    assert.doesNotMatch(source,/(?:\b(?:7|14|21)|sept) (?:modèles|compositions|déplacements|modules)|\/21\b/,name);
  }
});

test('browser helper cannot resolve to the Node-only Playwright runner',()=>{
  assert.equal(existsSync(new URL('./catalogue-matrix.mjs',import.meta.url)),false);
  assert.equal(existsSync(new URL('./catalogue-matrix-browser.mjs',import.meta.url)),true);
  assert.doesNotMatch(readFileSync(new URL('./catalogue-matrix.ts',import.meta.url),'utf8'),/@playwright|node:/);
});
