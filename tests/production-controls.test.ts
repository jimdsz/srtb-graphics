import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import PreviewControls from '../src/studio/PreviewControls';
import TimeRuler from '../src/studio/TimeRuler';

const base={ready:true,working:false,playing:false,paused:false,muted:true,soundLoading:false,onPlayPause(){},onRestart(){},onOut(){},onClear(){},onSound(){}};
test('transport describes the actual action for new, playing and paused previews',()=>{
  const initial=renderToStaticMarkup(createElement(PreviewControls,base));
  const playing=renderToStaticMarkup(createElement(PreviewControls,{...base,playing:true}));
  const paused=renderToStaticMarkup(createElement(PreviewControls,{...base,paused:true}));
  assert.match(initial,/aria-label="Lire l’aperçu"/);assert.match(playing,/aria-label="Mettre l’aperçu en pause"/);assert.match(paused,/aria-label="Reprendre l’aperçu"/);
  assert.match(initial,/aria-label="Recommencer l’aperçu \(IN\)"/);assert.match(initial,/aria-label="Effacer l’aperçu"/);
});
test('loading and export prevent every playback action; audio state is explicit',()=>{
  for(const state of [{ready:false},{working:true}]){
    const html=renderToStaticMarkup(createElement(PreviewControls,{...base,...state}));
    const buttons=html.match(/<button\b[^>]*>/g)||[];
    assert.equal(buttons.length,5);assert.ok(buttons.every(button=>button.includes('disabled=""')));
  }
  assert.match(renderToStaticMarkup(createElement(PreviewControls,{...base,muted:false})),/aria-label="Couper le son"[^>]*aria-pressed="true"/);
});
test('ruler exposes a labelled native slider, frame-aligned current time and known duration',()=>{
  const html=renderToStaticMarkup(createElement(TimeRuler,{value:7.52,duration:72.92,onSeek(){},phase:'En pause'}));
  assert.match(html,/aria-label="Position dans l’aperçu"/);assert.match(html,/aria-valuetext="00:00:07.52"/);assert.match(html,/step=".04"/);assert.match(html,/00:01:12.92/);assert.doesNotMatch(html,/role="status"/);
});
