import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {distributeTitle,baTextDefaults,studioEngineModule} from '../src/studio/text-editing';
import {getTemplate,validateProjectData} from '../src/studio/domain';
import {engineData} from '../src/studio/presentation';
// Browser-independent geometry adapter; no fonts or media are opened here.
// @ts-expect-error The pinned engine adapter is native ESM, not a TS module.
import {applyTextEditing,normalizeTextConfig} from '../public/studio-engines/ba-text-v1/text-layout.mjs';

test('title proposals preserve every word and require an explicit patch',()=>{
  const lines=['INTERVIEW','Olympe B.Quenum',''];
  const split=distributeTitle(lines,3);assert.deepEqual(split,['INTERVIEW','Olympe','B.Quenum']);
  assert.equal(distributeTitle(lines,2).filter(Boolean).join(' '),lines.filter(Boolean).join(' '));
  assert.deepEqual(lines,['INTERVIEW','Olympe B.Quenum','']);
  assert.deepEqual(distributeTitle(['Un','',''],3),['Un','','']);
});
test('BA typography survives save/runtime validation and stays scoped to the BA',()=>{
  const template=getTemplate('BTV_BA_1P'),data=validateProjectData(template,{_studio_ba_pack_scale:64,_studio_ba_pack_x:-90});
  assert.equal(engineData(data,true)._studio_ba_pack_scale,64);assert.equal(engineData(data,true)._studio_ba_pack_x,-90);
  assert.equal(engineData(data)._studio_ba_pack_scale,undefined);
  assert.ok(studioEngineModule(template).includes('ba-text-v2'));
  assert.equal(studioEngineModule(getTemplate('BTV_PopUp')),getTemplate('BTV_PopUp').module);
  assert.throws(()=>validateProjectData(template,{_studio_ba_pack_scale:201}));
  assert.throws(()=>validateProjectData(getTemplate('BTV_PopUp'),{_studio_ba_pack_scale:64}));
});
test('normalization checks typography without passing it to the frozen validator',()=>{
  const result=normalizeTextConfig({_studio_ba_pack_scale:60,_titre_ligne_1:'TITRE'}, {},(raw:Record<string,unknown>)=>{
    assert.ok(!Object.keys(raw).some(key=>key.startsWith('_studio_')));return raw;
  });assert.equal(result._studio_ba_pack_scale,60);assert.equal(result._studio_ba_body_scale,100);
  assert.throws(()=>normalizeTextConfig({_studio_ba_pack_scale:NaN},{},()=>({})),/limites/);
});
test('width becomes advice, structural errors stay errors; sizes and mattes are independent',()=>{
  const layer=(ind:number,nm:string)=>({ind,nm,ty:5,t:{d:{k:[{s:{s:100,lh:120,t:'OLYMPE B.QUENUM'}}]}},ks:{p:{a:0,k:[1800,500,0]}}});
  const title={...layer(21,'2 LIGNES HAUT'),tt:1,tp:20},matte={ind:20,nm:'matte',ty:4,ks:{p:{a:0,k:[1800,500,0]}}};
  const data={assets:[{nm:'BA1P_Typo_PACK',layers:[title,matte]},{nm:'BA_1P_RDV_Corps',layers:[layer(6,'TYPO 2L 3')]}]};
  const input=structuredClone(data);
  applyTextEditing(input,{...baTextDefaults,_studio_ba_pack_scale:60,_studio_ba_pack_x:-100},()=>{throw Error('2 LIGNES HAUT : texte trop large ; répartir le titre');});
  const changed=input.assets[0].layers.find(l=>l.ind===21)! as typeof title;
  assert.equal(changed.t.d.k[0].s.s,60);assert.equal(changed.ks.p.k[0],1700);assert.notEqual(changed.tp,20);
  assert.equal(input.assets[0].layers.find(l=>l.ind===20)!.ks.p.k[0],1800);
  assert.equal(data.assets[0].layers[0].ks.p.k[0],1800);
  assert.equal((input as any).__studioTextWarnings.length,1);
  assert.throws(()=>applyTextEditing(structuredClone(data),baTextDefaults,()=>{throw Error('Emprise sponsor source manquante.');}),/sponsor/);
});
test('original broadcast engine is untouched and generated portable engine has no cloud dependency',async()=>{
  const source=await readFile('public/library/v1.7.0/BTV_BA_1P/graphic.mjs');
  assert.equal(createHash('sha256').update(source).digest('hex'),'8c454acd5377678fb575222177c037380e42729a0415e7b3d67290802501bdd7');
  const portable=await readFile('public/studio-engines/ba-text-v2/portable.mjs','utf8');
  assert.match(portable,/normalizeTextConfig\(raw/);assert.match(portable,/applyTextEditing\(configured.data/);
  assert.doesNotMatch(portable,/from ['"]\//);assert.match(portable,/const BASE=import.meta.url/);
});
