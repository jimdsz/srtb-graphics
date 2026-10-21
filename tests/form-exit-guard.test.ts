import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createFormExitGuard} from '../src/studio/form-exit-guard';
import FormExitPrompt from '../src/studio/FormExitPrompt';

test('cancel close keeps the exact editor instance and unsaved fields, without executing close or reset',()=>{
  const events:boolean[]=[],guard=createFormExitGuard(value=>events.push(value)),form={name:'Recette non enregistrée — voix',start:0,end:3.6};
  let mounted=form,closed=0,resets=0;guard.request(true,()=>{closed++;resets++;mounted={name:'',start:0,end:0};});
  assert.equal(guard.pending,true);assert.equal(mounted,form);guard.cancel();
  assert.equal(guard.pending,false);assert.equal(closed,0);assert.equal(resets,0);assert.equal(mounted,form);assert.equal(mounted.name,'Recette non enregistrée — voix');assert.deepEqual(events,[true,false]);
  guard.confirm();assert.equal(closed,0,'A delayed confirm after cancel cannot run a discarded action.');
});

test('repeat close requests do not replace pending action; explicit discard executes once',()=>{
  const guard=createFormExitGuard(()=>{}),called:string[]=[];guard.request(true,()=>called.push('close'));guard.request(true,()=>called.push('replace'));
  guard.confirm();guard.confirm();assert.deepEqual(called,['close']);assert.equal(guard.pending,false);
});

test('cancel a profile switch performs no profile read or editor replacement',()=>{
  const guard=createFormExitGuard(()=>{});let reads=0;guard.request(true,()=>{reads++;});guard.cancel();assert.equal(reads,0);
  guard.request(true,()=>{reads++;});guard.confirm();assert.equal(reads,1);
});

test('with no live form close proceeds directly and creates no confirmation',()=>{
  let closed=0,prompts=0;const guard=createFormExitGuard(()=>prompts++);guard.request(false,()=>closed++);assert.equal(closed,1);assert.equal(prompts,0);
});

test('confirmation has named native buttons; editor stays rendered under inert content, not a discard conditional',()=>{
  const html=renderToStaticMarkup(createElement(FormExitPrompt,{onContinue(){},onDiscard(){}}));assert.match(html,/role="alertdialog"/);assert.match(html,/Continuer la saisie/);assert.match(html,/Quitter sans enregistrer/);assert.equal((html.match(/type="button"/g)||[]).length,2);
  const source=readFileSync(new URL('../src/studio/PreparationPanel.tsx',import.meta.url),'utf8');
  assert.match(source,/<div className="preparation-content" inert=\{discardPending\?true:undefined\}>/);assert.match(source,/\{editor\?<PreparationProfileEditor/);
  assert.doesNotMatch(source,/window\.confirm\('Quitter ce formulaire/);assert.doesNotMatch(source,/discardPending\s*\?[^\n]*<PreparationProfileEditor/);
});
