import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {getTemplate,templateDefaults,validateProjectData} from '../src/studio/domain';
import {engineData} from '../src/studio/presentation';
import {liveTextEdit} from '../src/studio/live-preview';
import {RENVOI_AD,RENVOI_RATING,renvoiSignageKeys,renvoiSignageAvailable,renvoiSignageShapeContract,renvoiSignageVisible} from '../src/studio/renvoi-signage';
import {matchesInspectorQuery} from '../src/studio/inspector-search';

const template=getTemplate('BTV_Renvoi');
test('new renvois have no implicit classification/AD; saved projects keep native defaults',()=>{
  const fresh=templateDefaults(template),legacy=validateProjectData(template,{});
  for(const key of renvoiSignageKeys){
    assert.equal(fresh[key],false);assert.equal(legacy[key],true);
    assert.equal(renvoiSignageVisible({},key),true);
    assert.equal(renvoiSignageVisible({[key]:'false'},key),false,'portable XML false');
    assert.equal(renvoiSignageVisible({[key]:'true'},key),true);
  }
});
test('all four independent choices survive validation, JSON reload and engine handoff',()=>{
  for(const rating of [true,false])for(const ad of [true,false]){
    const data=validateProjectData(template,{variant:'2L',title:'STREET ART',title2:'SANS FRONTIÈRES',[RENVOI_RATING]:rating,[RENVOI_AD]:ad});
    for(const next of [data,validateProjectData(template,JSON.parse(JSON.stringify(data))),engineData(data),engineData(data,true)]){
      assert.equal(next[RENVOI_RATING],rating);assert.equal(next[RENVOI_AD],ad);
    }
  }
  for(const key of renvoiSignageKeys)for(const value of ['false',0,1,null])assert.throws(()=>validateProjectData(template,{[key]:value}));
});
test('controls are only available for the pinned TV two-line Renvoi composition',()=>{
  const data={variant:'2L',_studio_format:'tv'};
  assert.equal(renvoiSignageAvailable(template,data),true);
  for(const patch of [{variant:'1L'},{_studio_format:'portrait'},{_studio_format:'vertical'}])assert.equal(renvoiSignageAvailable(template,{...data,...patch}),false);
  for(const patch of [{id:'BTV_Evenement'},{version:'2.0.0'},{libraryVersion:'1.8.0'}])assert.equal(renvoiSignageAvailable({...template,...patch},data),false);
});
test('only valid visibility-only edits use the no-rebuild preview path',()=>{
  const before={...templateDefaults(template),variant:'2L',title2:'DEUX'};
  for(const key of renvoiSignageKeys){
    const next={...before,[key]:true};assert.equal(liveTextEdit(template,before,next),true);
    assert.equal(liveTextEdit(template,before,next,true),false);
    for(const patch of [{[key]:'false'},{[key]:true,variant:'1L'},{[key]:true,_audio_enabled:true},{[key]:true,_out_duration_seconds:20},{[key]:true,_media_renvoi_url:'other.mp4'}])assert.equal(liveTextEdit(template,before,{...before,...patch}),false);
  }
});
test('exact frozen shapes identify AD and minus-ten without modifying sources',async()=>{
  const read=async(variant:string)=>JSON.parse(await readFile(`public/library/v1.7.0/BTV_Renvoi/source/${variant}/animation.json`,'utf8'));
  const two=await read('2L'),one=await read('1L'),mentions=two.layers.find((l:any)=>l.nm==='MENTIONS');
  assert.equal(one.layers.some((l:any)=>l.nm==='MENTIONS'),false);
  assert.equal(renvoiSignageShapeContract(mentions),true);
  const changed=structuredClone(mentions);changed.shapes.reverse();assert.equal(renvoiSignageShapeContract(changed),false);
  assert.equal(renvoiSignageShapeContract({...mentions,parent:7}),false);
});
test('signalétique labels can be found using the terms operators see on screen',()=>{
  for(const [key,queries] of [[RENVOI_RATING,['10','pictogramme','signalétique']],[RENVOI_AD,['AD','audiodescription','signalétique']]] as [string,string[]][]){
    const field=template.fields[key];for(const query of queries)assert.ok(matchesInspectorQuery(query,field.title!,field['x-section']!));
  }
});
