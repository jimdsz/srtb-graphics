import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {getTemplate,templateDefaults,validateProjectData} from '../src/studio/domain';
import {relayGeometry,relayKeys} from '../src/studio/relay-placement';
import {engineData} from '../src/studio/presentation';
import {replayAddress,replayCatalogue} from '../src/studio/replay-catalogue';
import {derivePreviewEngine} from '../scripts/build-preview-network.mjs';

test('relay new default is compact at the right, leaving the centre and bottom clear; old projects stay intact',()=>{
  const template=getTemplate('BTV_Relais_Antenne');
  assert.deepEqual(relayGeometry(validateProjectData(template,{})),{scale:1,width:1632,height:249,x:144,y:728});
  const compact=relayGeometry(templateDefaults(template));
  assert.equal(compact.scale,.4);assert.equal(compact.x,1123.2);
  assert.ok(compact.width<=1920*.35&&compact.height<=1080*.1);
  assert.ok(compact.y>=700&&compact.y+compact.height<=840);
  assert.ok(compact.x>960,'the right preset must leave the middle of the image clear');
  assert.equal(compact.x+compact.width,1776);
  const previous={_studio_relay_scale:75,_studio_relay_x:50,_studio_relay_y:0};
  assert.deepEqual(relayGeometry(validateProjectData(template,previous)),{scale:.75,width:1224,height:186.75,x:348,y:108});
  for(const scale of [25,40,50,75,100])for(const x of [0,50,100])for(const y of [0,50,80,100]){
    const data=validateProjectData(template,{_studio_relay_scale:scale,_studio_relay_x:x,_studio_relay_y:y}),p=relayGeometry(data);
    assert.ok(p.x>=144&&p.y>=108&&p.x+p.width<=1776&&p.y+p.height<=977);
    for(const key of relayKeys){assert.equal(engineData(data,true)[key],data[key]);assert.equal(engineData(data,false)[key],undefined);}
  }
  assert.throws(()=>validateProjectData(template,{_studio_relay_scale:0}));
});
test('official replay catalogue has unique, compact HTTP links and source evidence',()=>{
  assert.equal(replayCatalogue.length,12);assert.equal(new Set(replayCatalogue.map(item=>item.url)).size,12);
  for(const item of replayCatalogue){assert.equal(replayAddress(item.url),item.url);assert.ok(item.url.length<=84);assert.match(item.source,/^https:\/\/srtb.bj\//);}
  assert.equal(replayAddress('  https://srtb.bj/bonjour-le-benin/ '),'https://srtb.bj/bonjour-le-benin/');
  assert.equal(replayAddress(''),'');
  for(const url of ['javascript:alert(1)','https://user:secret@example.com','example.com','https://example.com/'+ 'x'.repeat(201)])assert.throws(()=>replayAddress(url));
});
test('draft replay only removes two missing-link guards, retaining frozen export guards',async()=>{
  const name='BTV_Passerelle_Replay/graphic.mjs',raw=await readFile('public/library/v1.7.0/'+name);
  const old=derivePreviewEngine(name,raw),draft=derivePreviewEngine(name,raw,false,true);
  assert.match(old,/Renseigner l’adresse officielle du replay avant IN/);assert.doesNotMatch(draft,/Renseigner l’adresse officielle du replay avant IN/);
  assert.match(raw.toString(),/Renseigner l’adresse officielle du replay avant IN/);
  assert.match(await readFile('src/studio/video/engine.ts','utf8'),/Renseignez l’adresse du replay/);
});
