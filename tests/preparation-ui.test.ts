import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import PreparationPanel from '../src/studio/PreparationPanel.tsx';
import PreparationProfileEditor,{ProfileAssetPicker,ProgrammePalette,WholeVoiceRange,setProgrammePrimary,toggleProgrammeColour} from '../src/studio/PreparationProfileEditor.tsx';
import {createVoiceRangeDraft} from '../src/studio/voice-range-draft';
import {charterColours,programmeDataSchema} from '../src/studio/preparation-profile-model.ts';
import {getTemplate,templateDefaults} from '../src/studio/domain.ts';
import type {MediaAsset,Project} from '../src/studio/domain.ts';
import {preparationEntryKind} from '../src/studio/preparation-entry';

const template=getTemplate('BTV_BA_1P'),data=templateDefaults(template);
const project:Project={id:'project-test',title:'Brouillon',template_id:template.id,template_version:template.version,library_version:template.libraryVersion,status:'draft',revision:1,data,created_by:'test@example.com',updated_by:'test@example.com',created_at:'2026-09-23T00:00:00Z',updated_at:'2026-09-23T00:00:00Z',archived:0};
const props={open:true,onClose(){},project,template,data,media:[],member:{email:'test@example.com',name:'Test',role:'designer' as const,active:1},disabled:false,onApply(){}};

test('preparation dialog has a referenced visible heading, named regions and non-submit actions',()=>{
  const html=renderToStaticMarkup(createElement(PreparationPanel,props));
  assert.match(html,/<dialog[^>]+aria-labelledby="preparation-heading"/);
  assert.match(html,/<h2 id="preparation-heading">/);
  for(const name of ['Types de fiches','Fiches partagées','Détail et proposition'])assert.ok(html.includes(`aria-label="${name}"`));
  assert.match(html,/<button[^>]+type="button"[^>]+aria-label="Fermer"/);
  for(const button of html.matchAll(/<button\b[^>]*>/g))assert.match(button[0],/type="button"/);
});

test('closed preparation dialog renders no hidden interactive content',()=>{
  assert.equal(renderToStaticMarkup(createElement(PreparationPanel,{...props,open:false})), '');
});

test('the direct team voice entry opens the real voice catalogue, not a preset form',()=>{
  const html=renderToStaticMarkup(createElement(PreparationPanel,{...props,initialKind:'voice'}));
  assert.match(html,/<button[^>]*aria-pressed="true"[^>]*>Voix<\/button>/);assert.match(html,/Classer une voix/);assert.doesNotMatch(html,/Mémoriser ce brouillon/);
});

test('entry target changes only on opening and never resets a live form or open dialogue',()=>{
  const base={open:true,wasOpen:false,editing:false,kind:'preset' as const,initialKind:'voice' as const};
  assert.equal(preparationEntryKind(base),'voice');
  assert.equal(preparationEntryKind({...base,wasOpen:true}),'preset');
  assert.equal(preparationEntryKind({...base,editing:true}),'preset');
  assert.equal(preparationEntryKind({...base,open:false}),'preset');
  assert.equal(preparationEntryKind({...base,initialKind:undefined}),'preset');
  // A list request is gated until state reaches this exact entry target.
  assert.notEqual(preparationEntryKind(base),base.kind);
  assert.equal(preparationEntryKind({...base,wasOpen:true,kind:'voice'}),'voice');
});

test('non-draft and archived projects explicitly show read-only preparation guidance',()=>{
  for(const changed of [{status:'approved' as const},{status:'draft' as const,archived:1}]){
    const html=renderToStaticMarkup(createElement(PreparationPanel,{...props,project:{...project,...changed}}));
    assert.ok(html.includes('Ce projet n’est pas un brouillon actif'));
    assert.ok(html.includes('dupliquez le projet pour appliquer une préparation'));
  }
});

test('asset picker exposes only ready media of its requested kind and escapes filenames',()=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'window');
  Object.defineProperty(globalThis,'window',{configurable:true,value:{}});
  try{
    const asset=(id:string,mime_type:string,status:MediaAsset['status'],name:string):MediaAsset=>({id,name,mime_type,status,bytes:123,created_by:'test@example.com',created_at:'2026-09-23T00:00:00Z'});
    const media=[asset('voice','audio/wav','ready','Voix <script>alert(1)</script>.wav'),asset('picture','image/png','ready','Image.png'),asset('pending','audio/wav','uploading','Pas encore.wav')];
    const html=renderToStaticMarkup(createElement(ProfileAssetPicker,{label:'Source audio',kind:'audio',value:null,media,onChange(){}}));
    assert.ok(html.includes('/api/graphics/media/voice/content'));assert.ok(!html.includes('/api/graphics/media/picture/content'));assert.ok(!html.includes('/api/graphics/media/pending/content'));
    assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));
    assert.match(html,/<label>Source audio<select/);
    for(const button of html.matchAll(/<button\b[^>]*>/g))assert.match(button[0],/type="button"/);
    assert.ok(html.includes('Aucun téléversement automatique'));
  }finally{if(original)Object.defineProperty(globalThis,'window',original);else Reflect.deleteProperty(globalThis,'window');}
});

test('every preparation action declares its button type, including nested local-file actions',()=>{
  for(const file of ['PreparationPanel.tsx','PreparationProfileEditor.tsx','LocalMedia.tsx']){
    const source=readFileSync(new URL(`../src/studio/${file}`,import.meta.url),'utf8');
    const component=file==='LocalMedia.tsx'?source.split('export function LocalFileButton')[1]?.split('export default function')[0]:source;
    assert.ok(component);let buttons=0,submits=0;
    // Source guard supplements the rendered picker/dialog checks. The action's
    // static type must be declared before its event handler expression.
    for(const button of component.matchAll(/<button\b[^>]*>/g)){
      buttons++;const type=/\btype="(button|submit)"/.exec(button[0]);
      assert.ok(type,`${file}: button requires an explicit static type before handlers`);
      if(type[1]==='submit')submits++;
    }
    assert.ok(buttons>0);assert.equal(submits,file==='PreparationProfileEditor.tsx'?1:0);
  }
});

test('primary colour adds or promotes without dropping colours; removal selects the next and keeps at least one',()=>{
  assert.deepEqual(setProgrammePrimary(['#f0b900','#ffffff'],'#007300'),['#007300','#f0b900','#ffffff']);
  assert.deepEqual(setProgrammePrimary(['#f0b900','#ffffff','#007300'],'#ffffff'),['#ffffff','#f0b900','#007300']);
  assert.deepEqual(toggleProgrammeColour(['#ffffff','#f0b900','#007300'],'#ffffff'),['#f0b900','#007300']);
  assert.deepEqual(toggleProgrammeColour(['#ffffff'],'#ffffff'),['#ffffff']);
  for(let subset=1;subset<32;subset++){
    const palette=charterColours.filter((_,index)=>subset&(1<<index));
    for(const colour of charterColours){
      for(const changed of [setProgrammePrimary(palette,colour),toggleProgrammeColour(palette,colour)]){
        assert.doesNotThrow(()=>programmeDataSchema.parse({title:'Programme',palette:changed}));
      }
      const primary=setProgrammePrimary(palette,colour);
      assert.equal(primary[0],colour);
      assert.ok(palette.every(previous=>primary.includes(previous)));
    }
  }
});

test('palette exposes a labelled five-colour selector and disables removal of the last colour',()=>{
  const html=renderToStaticMarkup(createElement(ProgrammePalette,{palette:['#007300'],onChange(){}}));
  assert.match(html,/<label>Couleur principale<select/);
  assert.equal([...html.matchAll(/<option /g)].length,5);
  assert.match(html,/<option value="#007300" selected="">Vert<\/option>/);
  assert.match(html,/<input type="checkbox" disabled="" checked=""\/>/);
  assert.ok(!html.includes('décochez les couleurs précédentes'));
});

test('studio credits its designer once without removing BTV template branding',()=>{
  const source=readFileSync(new URL('../src/studio/Studio.tsx',import.meta.url),'utf8');
  assert.equal(source.split('Conçu par Ji:mmy de Souza').length-1,1);
  assert.ok(!source.includes('navigation-monogram'));
  assert.ok(source.includes('SRTB Graphics · Préparation hors antenne'));
  assert.match(source,/<footer>.*Conçu par Ji:mmy de Souza.*<\/footer>/);
});

test('whole-file UI visibly reports pending/error states and has an explicit cancellation action',async()=>{
  const draft=createVoiceRangeDraft({source:{url:'blob:voice',name:'Voix.wav',mimeType:'audio/wav'},start:0,end:1});
  let reject!:(cause:Error)=>void;const pending=draft.measure(()=>new Promise<number>((_yes,no)=>{reject=no;}));
  const render=()=>renderToStaticMarkup(createElement(WholeVoiceRange,{state:draft.snapshot(),onMeasure(){},onCancel(){}}));
  assert.match(render(),/aria-busy="true"/);assert.match(render(),/<button type="button"[^>]* disabled="">Mesure/);assert.match(render(),/Interrompre la mesure/);assert.match(render(),/role="status"/);assert.match(render(),/confirmation suspendues/);
  reject(Error('Fichier illisible'));await pending;
  assert.match(render(),/role="alert">Fichier illisible/);assert.doesNotMatch(render(),/Interrompre la mesure/);assert.match(render(),/La confirmation reste manuelle/);
});

test('new voice editor has no implicit one-second range and cannot confirm or save before an explicit range and audition',()=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'window');Object.defineProperty(globalThis,'window',{configurable:true,value:{}});
  try{
    const html=renderToStaticMarkup(createElement(PreparationProfileEditor,{kind:'voice',template,data,media:[],onSaved(){},onCancel(){},onBusyChange(){}}));
    assert.match(html,/Fin \(s\)<input[^>]*value="0"/);assert.match(html,/<input type="checkbox" disabled=""\/>/);assert.match(html,/<button class="primary" type="submit" disabled="">Créer la fiche/);
    const source=readFileSync(new URL('../src/studio/PreparationProfileEditor.tsx',import.meta.url),'utf8');
    assert.doesNotMatch(source,/<WholeVoiceRange key=/);assert.match(source,/blocked=\{!rangeReady\}/);assert.match(source,/if\(!voiceRangeReady\(rangeDraft\.snapshot\(\)\)/);
    assert.doesNotMatch(source,/attachVoiceRangeDiagnostics|voiceRangeDebug|data-voice-range-debug/);
  }finally{if(original)Object.defineProperty(globalThis,'window',original);else Reflect.deleteProperty(globalThis,'window');}
});

test('voice measurement follows local selection but precedes the changing fingerprint controls',()=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'window');Object.defineProperty(globalThis,'window',{configurable:true,value:{showOpenFilePicker(){}}});
  try{
    const draft=createVoiceRangeDraft({source:{url:'blob:voice',name:'Voix.wav',mimeType:'audio/wav'},start:0,end:1});
    const action=createElement(WholeVoiceRange,{state:draft.snapshot(),onMeasure(){},onCancel(){}});
    const html=renderToStaticMarkup(createElement(ProfileAssetPicker,{label:'Source audio',kind:'audio',value:draft.snapshot().source,media:[],onChange(){},selectionAction:action}));
    const picker=html.indexOf('class="local-media-picker"'),choose=html.indexOf('Choisir sur cet ordinateur'),remember=html.indexOf('Mémoriser l’accès'),measure=html.indexOf('data-voice-action="measure"');
    assert.ok(picker<choose&&choose<remember&&remember<measure);
    const source=readFileSync(new URL('../src/studio/LocalMedia.tsx',import.meta.url),'utf8');
    assert.match(source,/\{selectionAction\}\{busy\?<button[^>]+onClick=.*Interrompre la vérification/);
    assert.ok(source.indexOf('{selectionAction}{busy?')<source.indexOf('{message?<small'));
  }finally{if(original)Object.defineProperty(globalThis,'window',original);else Reflect.deleteProperty(globalThis,'window');}
});
