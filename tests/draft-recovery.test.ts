import test from 'node:test';
import assert from 'node:assert/strict';
import {draftTextIssue,recordDraftChange,undoDraftChange} from '../src/studio/draft-recovery';
import {broadcastTemplates,getTemplate,templateDefaults,validateProjectData} from '../src/studio/domain';
import {textFields} from '../src/studio/typography-model';
import {installPreviewTransport} from '../src/studio/preview-transport';
import type {LegacyGraphic} from '../src/studio/video/engine';

test('empty required titles are intermediate drafts; optional lines remain valid and data stays intact',()=>{
  const ba=getTemplate('BTV_BA_1P'),popup=getTemplate('BTV_PopUp'),data=templateDefaults(ba),copy=structuredClone(data);
  assert.match(draftTextIssue(ba,{...data,_titre_ligne_1:''}),/première ligne/);
  assert.match(draftTextIssue(ba,{...data,_titre_ligne_2:'',_titre_ligne_3:'TROIS'}),/troisième ligne/);
  assert.equal(draftTextIssue(ba,{...data,_titre_ligne_2:'',_titre_ligne_3:''}),'');
  assert.match(draftTextIssue(popup,{_title:' \n '}),/demande un titre/);assert.equal(draftTextIssue(popup,{_title:'CORRIGÉ'}),'');
  assert.equal(draftTextIssue({...popup,libraryVersion:'2.0.0'},{_title:''}),'');assert.deepEqual(data,copy);
});
test('undo restores the whole typing burst, preserves unrelated work and never mutates snapshots',()=>{
  const initial={_title:'Émission',_jour:'Lundi'},one={...initial,_title:''},two={...one,_title:'Nouveau'};
  let history=recordDraftChange([],initial,one,1000);history=recordDraftChange(history,one,two,1200);
  assert.equal(history.length,1);assert.deepEqual(undoDraftChange({...two,_jour:'Mardi'},history[0]),{...initial,_jour:'Mardi'});assert.equal(two._title,'Nouveau');
  assert.equal(undoDraftChange({...two,_title:'Texte ultérieur'},history[0])._title,'Texte ultérieur');
});
test('undo history is bounded and a later field or typing burst creates its own entry',()=>{
  let value={_title:'0'},history=recordDraftChange([],{},value,0);
  for(let i=1;i<=40;i++){const next={_title:String(i)};history=recordDraftChange(history,value,next,i*1000);value=next;}
  assert.equal(history.length,32);assert.equal(undoDraftChange(value,history.at(-1)!)._title,'39');
  const extra=recordDraftChange(history,value,{...value,_day:'Lundi'},41001);assert.equal(extra.at(-1)?.after._day,'Lundi');assert.equal('_day' in undoDraftChange({...value,_day:'Lundi'},extra.at(-1)!),false);
});
test('a rejected legacy update no longer poisons Clear or the next corrected update',async()=>{
  const calls:string[]=[],g=Object.assign(new EventTarget(),{
    state:{animation:{isPaused:true,pause(){},hide(){}},actionChain:Promise.reject(Error('Le titre ne peut pas être vide.')),playStack:[]},
    autoOut:{active:false,cancel(){}},tracks:{},_drainPlayStack(){},_triggerPlayStack(){},_performStopAction(){},_completeStopAction(){},
  }) as unknown as LegacyGraphic;
  const controls=installPreviewTransport(g,getTemplate('BTV_PopUp'),()=>templateDefaults(getTemplate('BTV_PopUp')));
  await controls.clear();assert.equal(controls.snapshot().phase,'stopped');
  g.state.actionChain=g.state.actionChain.catch(()=>{}).then(()=>calls.push('corrected title accepted'));
  await g.state.actionChain;assert.deepEqual(calls,['corrected title accepted']);controls.dispose();
});

for(const template of broadcastTemplates)test(`${template.id}: clearing every editable text stays a reversible draft in all three formats`,()=>{
  const fields=textFields(template).map(([key])=>key);
  assert.ok(fields.length>0);
  for(const format of ['tv','portrait','vertical']){
    const original={...templateDefaults(template),_studio_format:format};
    const empty={...original,...Object.fromEntries(fields.map(key=>[key,'']))};
    assert.doesNotThrow(()=>validateProjectData(template,empty));
    const history=recordDraftChange([],original,empty,1000);
    assert.equal(history.length,1);
    assert.deepEqual(undoDraftChange(empty,history[0]),original);
    assert.deepEqual(undoDraftChange({...empty,_studio_block_scale:80},history[0]),{...original,_studio_block_scale:80});
    // Fields are kept empty, not silently substituted with invisible or sample text.
    for(const field of fields)assert.equal(empty[field],'');
  }
});
