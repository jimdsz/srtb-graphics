import test from 'node:test';
import assert from 'node:assert/strict';
import {broadcastTemplates,templateDefaults,validateProjectData} from '../src/studio/domain';
import {textFields,patchTextStyle,currentStyle,parseStyles,shapedText} from '../src/studio/typography-model';
import {engineData} from '../src/studio/presentation';
test('all seven engines expose independent text formatting in all three formats',()=>{
 for(const t of broadcastTemplates){assert.ok(textFields(t).length>=3);const [key]=textFields(t)[0],data=templateDefaults(t);
  const next={...data,...patchTextStyle(data,key,{size:65,x:-200,font:'suisse',case:'typed'})};
  const saved=validateProjectData(t,next);assert.deepEqual(currentStyle(saved,key),{size:65,x:-200,font:'suisse',case:'typed'});
  assert.equal(currentStyle({...saved,_studio_format:'vertical'},key),undefined);assert.equal(engineData(saved)._studio_typography,undefined);assert.ok(engineData(saved,true)._studio_typography);
  assert.equal(shapedText('Olympe B.Quenum',currentStyle(saved,key)!,true),'Olympe B.Quenum');
  assert.equal(currentStyle({...saved,...patchTextStyle(saved,key,null)},key),undefined);
 }
});
test('only local font identifiers, known fields and finite presentation values are saved',()=>{
 const t=broadcastTemplates[0];for(const style of [{x:Infinity},{x:5000},{size:0},{font:'url(https://attacker.test/font)'},{colour:'red;position:fixed'},{fontName:'<script>'},{align:'inherit'},{unexpected:true}])assert.throws(()=>parseStyles(JSON.stringify({'tv:_titre_ligne_1':style})));
 assert.throws(()=>validateProjectData(t,{_studio_typography:JSON.stringify({'tv:_password':{size:100}})}));
 assert.throws(()=>parseStyles('{"__proto__":{"polluted":true}}'));
 const payload=JSON.stringify({'tv:_titre_ligne_1':{font:'local-font:'+'a'.repeat(64),fontName:'Police SRTB.otf'}});assert.equal(validateProjectData(t,{_studio_typography:payload})._studio_typography,payload);
});
test('text styles do not mutate saved content or choices in another aspect ratio',()=>{
 const t=broadcastTemplates[1],data={...templateDefaults(t),_title:'Interview\nOlympe B.Quenum'},snapshot=structuredClone(data);
 const tv={...data,...patchTextStyle(data,'_title',{size:80,x:100})},social={...tv,_studio_format:'vertical'};
 const both={...social,...patchTextStyle(social,'_title',{size:120,y:-60})};
 assert.deepEqual(data,snapshot);assert.equal(both._title,snapshot._title);assert.equal(currentStyle({...both,_studio_format:'tv'},'_title')?.x,100);assert.equal(currentStyle(both,'_title')?.y,-60);
});
