import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'..'),native=resolve(root,'public/library/v1.7.0/BTV_BA_1P');
const generated=JSON.parse(await readFile(resolve(root,'src/studio/ba-editor.generated.json'),'utf8'));
const voiceURL='data:text/javascript;base64,'+Buffer.from(generated.voiceLayout).toString('base64');
const clockURL='data:text/javascript;base64,'+Buffer.from(generated.audioClock).toString('base64');
const audioURL='data:text/javascript;base64,'+Buffer.from(generated.audio.replace("'./studio-voice-layout.mjs'",JSON.stringify(voiceURL)).replace("'./studio-audio-clock.mjs'",JSON.stringify(clockURL))).toString('base64');
const portable=generated.config.replace(/from '\.\/([^']+)'/g,(_all:string,path:string)=>`from '${path==='studio-audio.mjs'?audioURL:pathToFileURL(resolve(native,path)).href}'`);
const engine=await import('data:text/javascript;base64,'+Buffer.from(portable).toString('base64'));
test('single immediate BA keeps genuinely empty time, all original media/music and input untouched',()=>{
  const data={...engine.DEFAULTS,_jour_1:'Tout de suite',_heure_1:'',_jour_2:'',_heure_2:'',_jour_3:'',_heure_3:''},before=structuredClone(data);
  const normalized=engine.normalizeConfig(data);assert.equal(normalized._jour_1,'Tout de suite');assert.equal(normalized._heure_1,'');assert.deepEqual(data,before);assert.deepEqual(normalized,data);
});
test('unknown time and hidden appointments are allowed without fake hours; ambiguous hours are rejected',()=>{
  const base={...engine.DEFAULTS,_jour_2:'',_heure_2:'',_jour_3:'',_heure_3:''};
  for(const day of ['Lundi','Aujourd’hui','Demain','Ce soir'])assert.equal(engine.normalizeConfig({...base,_jour_1:day,_heure_1:''})._heure_1,'');
  assert.throws(()=>engine.normalizeConfig({...base,_jour_1:'Tout de suite',_heure_1:'20h30'}),/sans horaire/);
  assert.throws(()=>engine.normalizeConfig({...base,_jour_1:'Tout de suite',_heure_1:'',_jour_2:'Demain',_heure_2:'20h30'}),/seule/);
  assert.equal(engine.normalizeConfig({...base,_jour_1:'',_heure_1:''})._jour_1,'');
  assert.throws(()=>engine.normalizeConfig({...base,_jour_1:'',_heure_1:'20h30'}),/libellé/);
});
test('native library config stays byte-pinned; online and portable adapters use only the explicit copy',async()=>{
  assert.equal(createHash('sha256').update(await readFile(resolve(native,'config.mjs'))).digest('hex'),'57966f23bca37af92b9df90a7735eea92db220efee63606e9506894218388aca');
  assert.match(generated.graphic,/from '\.\/studio-config\.mjs'/);
  const online=await readFile(resolve(root,'public/studio-engines/ba-text-v2/graphic.mjs'),'utf8');assert.match(online,/from '\.\/config\.mjs'/);assert.doesNotMatch(online,/from '\/library\/v1\.7\.0\/BTV_BA_1P\/config.mjs'/);
});
