import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreMedia} from '../src/studio/media-match-score';
const row={title:'Bonjour le Bénin',subtitle:'',airDate:'2026-09-28'};
test('programme searches downgrade existing promos, audio signatures and numbered images but retain ordinary pictures',()=>{
 for(const path of ['BANDES ANNONCES BTV/BONJOUR LE BENIN tout de suite.mp4','TRANCHES PUB BONJOUR LE BENIN/1-BTV_JINGLE_PUB_01.mxf','POPUP/BONJOUR LE BENIN_00001.png','BONJOUR LE BENIN demain.mp4','BONJOUR LE BENIN.wav']){
  const match=scoreMedia(row,'local',{path,name:path.split('/').at(-1)!,size:100,modified:1});
  assert.equal(match.manual,true,path);assert.ok(match.score<=45,path);
 }
 for(const path of ['BONJOUR LE BENIN 2026-09-28.mp4','BONJOUR LE BENIN affiche.jpg']){
  const match=scoreMedia(row,'local',{path,name:path,size:100,modified:1});assert.equal(match.manual,false,path);assert.ok(match.score>=80,path);
 }
});
test('a programme directory is not proof that its unrelated feature is the full programme',()=>{
 const path='REGIE/BONJOUR LE BENIN/DESTINATION BENIN/DESTINATION BENIN N°1.mp4';
 const match=scoreMedia(row,'local',{path,name:path.split('/').at(-1)!,size:100,modified:1});
 assert.equal(match.manual,true);assert.ok(match.score<=55);assert.match(match.reason,/nom du fichier différent/);
});
