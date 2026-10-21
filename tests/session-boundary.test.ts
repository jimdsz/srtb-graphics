import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import SessionBoundary from '../src/studio/SessionBoundary.tsx';

test('uncertain expiry retains the same draft subtree in memory but hides and disables its interface',()=>{
  const child=createElement('textarea',{'aria-label':'Brouillon',defaultValue:'Saisie à conserver'});
  const render=(suspended:boolean)=>renderToStaticMarkup(createElement(SessionBoundary,{suspended,error:'Service temporairement indisponible',checking:false,onRetry(){},children:child}));
  const blocked=render(true),active=render(false);
  assert.match(blocked,/<div hidden="" inert="" class="session-protected-view">/);
  assert.ok(blocked.includes('Saisie à conserver'));assert.ok(active.includes('Saisie à conserver'));
  assert.match(blocked,/<dialog[^>]+aria-labelledby="session-verification-title"/);
  assert.ok(blocked.includes('Réessayer le contrôle'));assert.ok(blocked.includes('les actions sont suspendus'));
  assert.ok(!active.includes('<div hidden='));assert.ok(active.includes('Vérifier la connexion'));
});

test('temporary checks do not force session end or replay mutations, and local playback is paused',()=>{
  const hook=readFileSync('src/studio/useSession.ts','utf8'),guard=readFileSync('src/studio/SessionBoundary.tsx','utf8'),preview=readFileSync('src/studio/Preview.tsx','utf8');
  assert.ok(!hook.includes("catch(()=>{\n        if(current())sessionState.end"));
  assert.ok(hook.includes('connected(await api.me(requestController.signal))'));
  assert.ok(guard.includes('media.pause()'));assert.ok(guard.includes('event.preventDefault()'));
  assert.ok(preview.includes('audioControl.current?.volume(0)'));assert.ok(preview.includes('transport.current?.pause()'));
  assert.ok(!guard.includes('localStorage'));assert.ok(!guard.includes('sessionStorage'));
  const pack=readFileSync('src/studio/ExportPanel.tsx','utf8'),trim=readFileSync('src/studio/MediaTrim.tsx','utf8');
  assert.ok(pack.includes('bindVideoSession(task)'));assert.ok(pack.includes('stopSessionGuard()'));
  assert.ok(trim.includes('allowed=sessionState.permission()'));assert.ok(trim.includes('if(!allowed()){node.pause()'));
});
