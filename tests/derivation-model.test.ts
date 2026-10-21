import test from 'node:test';
import assert from 'node:assert/strict';
import {getTemplate,templateDefaults} from '../src/studio/domain';
import {deriveProjects,derivationChoices,derivationRequestSchema} from '../src/studio/derivation-model';
import type {DerivationSource} from '../src/studio/derivation-model';
const template=getTemplate('BTV_BA_1P');
function source():DerivationSource{return {templateId:template.id,templateVersion:template.version,libraryVersion:template.libraryVersion,title:'Campagne test',data:{...templateDefaults(template),_titre_ligne_1:'Première ligne',_titre_ligne_2:'Deuxième ligne',_titre_ligne_3:'Troisième ligne'}};}

test('social derivations clone the entire snapshot and only change the format, never the source',()=>{
  const input=source(),before=structuredClone(input);
  input.data._studio_typography='{"tv:_titre_ligne_1":{"size":64}}';
  const social=deriveProjects(input,['ba-vertical','ba-portrait']);
  for(const [index,item] of social.entries())assert.deepEqual(item.data,{...input.data,_studio_format:index?'portrait':'vertical'});
  assert.equal(input.data._studio_format,before.data._studio_format);assert.equal(social[0].templateId,template.id);
});
test('simple BA never derives pop-ups from hidden second and third appointments',()=>{
  const input=source();input.data._studio_ba_mode='simple';input.data._jour_3='Dimanche';input.data._heure_3='18h00';
  assert.deepEqual(derivationChoices(input.data).filter(item=>item.selected).map(item=>item.key),['ba-vertical','ba-portrait','popup-1']);
  assert.throws(()=>deriveProjects(input,['popup-2']),/visibles/);
});
test('multiple appointments produce distinct labels and preserve all three title lines without target examples',()=>{
  const input=source();input.data._jour_3='Demain';input.data._heure_3='18h00';input.data._sous_titre_visible=false;
  const children=deriveProjects(input,['popup-1','popup-2','popup-3']);
  assert.equal(children[0].data._title,'Première ligne\nDeuxième ligne\nTroisième ligne');assert.equal(children[2].data._label,'Demain · 18h00');
  for(const item of children){assert.equal(item.data._subtitle,'');assert.equal(item.data._background_visible,false);assert.equal(item.data._media_background_url,'');assert.equal(item.data._media_background_sequence,'[]');assert.equal(item.data._media_popup_audio_enabled,false);assert.equal(item.data._studio_typography,'{}');assert.equal(item.data._out_duration_seconds,12);assert.equal(item.data._out_mode,'duration');assert.ok(!JSON.stringify(item.data).includes('MAGAZINE DES SPORTS'));}
});
test('absent appointments offer an explicit non-default À SUIVRE variant and invent no date',()=>{
  const input=source();for(const n of [1,2,3]){input.data[`_jour_${n}`]='';input.data[`_heure_${n}`]='';}
  const choices=derivationChoices(input.data);assert.equal(choices.filter(choice=>choice.key.startsWith('popup-')).length,1);assert.equal(choices.find(choice=>choice.key==='popup-follow')?.selected,false);
  assert.equal(deriveProjects(input,['popup-follow'])[0].data._label,'À SUIVRE');assert.throws(()=>deriveProjects(input,['popup-1']),/visibles/);
});
test('source library paths, bounds and playlists remain pinned to BA, never re-rooted to popup',()=>{
  const input=source(),path='/library/v1.7.0/BTV_BA_1P/lib/media/programme.mp4';
  const item=deriveProjects(input,['popup-1'])[0];assert.equal(item.data._media_popup_url,path);assert.equal(item.data._media_popup_start_seconds,3);assert.equal(item.data._media_popup_end_seconds,64.8);
  input.data._media_body_sequence=JSON.stringify([{url:'lib/media/prepared/native-v102/slow-25b341c2aeb35dc28530.mp4',start:1.2,end:4.4}]);input.data._media_body_loop=true;
  const playlist=deriveProjects(input,['popup-1'])[0];assert.equal(playlist.data._media_popup_url,'');assert.equal(playlist.data._media_popup_loop,true);
  assert.deepEqual(JSON.parse(String(playlist.data._media_popup_sequence)),[{url:'/library/v1.7.0/BTV_BA_1P/lib/media/prepared/native-v102/slow-25b341c2aeb35dc28530.mp4',start:1.2,end:4.4}]);
});
test('local and private descriptors are reused unchanged, while provisional blobs remain unpersistable',()=>{
  for(const url of [`local-media:${'a'.repeat(64)}:120`,'/api/graphics/media/00000000-0000-4000-8000-000000000001/content']){
    const input=source(),asset={url,name:'Extrait.mp4',mimeType:'video/mp4'};input.data._media_body_url=asset;
    assert.deepEqual(deriveProjects(input,['popup-1'])[0].data._media_popup_url,asset);
  }
  const input=source();input.data._media_body_url={url:'blob:https://app/temporary',name:'Extrait.mp4',mimeType:'video/mp4'};assert.throws(()=>deriveProjects(input,['popup-1']),/média partagé/);
});
test('unsupported speed blocks only the converted target rather than silently changing playback',()=>{
  const input=source();input.data._media_body_rate=.5;
  assert.throws(()=>deriveProjects(input,['popup-1']),/vitesse/);assert.throws(()=>deriveProjects(input,['tds']),/vitesse/);
  assert.equal(deriveProjects(input,['ba-vertical'])[0].data._media_body_rate,.5);
});
test('Tout de suite preserves editorial fields and custom sponsor but never stale day voice or sample logo',()=>{
  const input=source();input.data._sponsor_visible=true;
  let item=deriveProjects(input,['tds'])[0];assert.equal(item.data._sponsor_visible,false);assert.equal(item.data._sponsor_logo,'');assert.equal(item.data._audio_voice_enabled,false);assert.equal(item.data._audio_voice_url,'');assert.equal(item.data._audio_bed_enabled,true);assert.equal(item.data._audio_bed_url,'lib/audio/BTV_BA TDS -23LUFS.wav');assert.equal(item.data._color_artwork,'original');assert.ok(item.warnings.some(warning=>warning.includes('palette')));
  input.data._sponsor_original=false;input.data._sponsor_url='lib/media/sponsor.png';
  item=deriveProjects(input,['tds'])[0];assert.equal(item.data._sponsor_logo,'/library/v1.7.0/BTV_BA_1P/lib/media/sponsor.png');assert.equal(item.data._theme,input.data._thematique);assert.equal(item.data._titre_ligne_3,'Troisième ligne');assert.equal(item.data._media_background_audio_enabled,false);
});
test('Replay requires explicit HTTPS without credentials and copies no demonstration content',()=>{
  const input=source();for(const url of ['', 'http://example.test/replay','https://user:pass@example.test/replay','javascript:alert(1)'])assert.throws(()=>deriveProjects(input,['replay'],url));
  const item=deriveProjects(input,['replay'],'https://example.test/replay')[0];assert.equal(item.data._replay_url,'https://example.test/replay');assert.equal(item.data._audio_enabled,false);assert.equal(item.data._title,'Première ligne\nDeuxième ligne\nTroisième ligne');
});
test('social identity inherits typography but never TV geometry or an existing target style',()=>{
  const input=source(),font='local-font:'+ 'a'.repeat(64);
  input.data._studio_typography=JSON.stringify({'tv:_titre_ligne_1':{font,fontName:'Ma police.otf',bold:true,italic:true,case:'typed',colour:'#ffffff',size:88,x:120,y:240,rotation:15},'portrait:_titre_ligne_1':{font:'suisse',size:55}});
  const [vertical,portrait]=deriveProjects(input,['ba-vertical','ba-portrait']);
  assert.deepEqual(JSON.parse(String(vertical.data._studio_typography))['vertical:_titre_ligne_1'],{font,fontName:'Ma police.otf',bold:true,italic:true,case:'typed',colour:'#ffffff'});
  assert.deepEqual(JSON.parse(String(portrait.data._studio_typography))['portrait:_titre_ligne_1'],{font:'suisse',size:55});
});
test('mapping rejects another engine/version, duplicate outputs and forged child payloads',()=>{
  const input=source();assert.throws(()=>deriveProjects({...input,templateId:'BTV_Ce_Soir'},['ba-portrait']));assert.throws(()=>deriveProjects({...input,templateVersion:'99'},['ba-portrait']));assert.throws(()=>deriveProjects(input,['ba-portrait','ba-portrait']));
  assert.equal(derivationRequestSchema.safeParse({requestId:'00000000-0000-4000-8000-000000000001',name:'Ensemble',sourceRevision:1,sourceTitle:input.title,sourceData:input.data,targets:['ba-portrait'],children:[{}]}).success,false);
});
