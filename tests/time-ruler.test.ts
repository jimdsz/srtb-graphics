import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import TimeRuler from '../src/studio/TimeRuler';
import {timeLabel} from '../src/studio/media-trim';

test('responsive ruler retains exact endpoints, accessible time and native 25 fps seek step',()=>{
  for(const duration of [72.92,3723.48,86400]){
    const value=36.44,html=renderToStaticMarkup(createElement(TimeRuler,{value,duration,onSeek(){}}));
    const input=html.match(/<input\b[^>]+>/)?.[0]||'';
    assert.match(input,/type="range"/);assert.match(input,/step="\.04"/);assert.match(input,/min="0"/);
    assert.equal(Number(input.match(/max="([^"]+)"/)?.[1]),duration-.04);
    assert.equal(Number(input.match(/value="([^"]+)"/)?.[1]),value);
    assert.ok(input.includes(`aria-valuetext="${timeLabel(value)}"`));
    const ticks=html.match(/class="time-ruler-ticks" aria-hidden="true">(.*?)<\/div>/)?.[1]||'';
    assert.equal((ticks.match(/<span>/g)||[]).length,5);
    assert.ok(ticks.startsWith(`<span>${timeLabel(0)}</span>`));
    assert.ok(ticks.endsWith(`<span>${timeLabel(duration)}</span>`));
  }
});

test('narrow ruler CSS reacts to its container and never hides either endpoint',async()=>{
  const css=await readFile(new URL('../src/studio/studio.css',import.meta.url),'utf8');
  assert.match(css,/\.time-ruler\{[^}]*container:time-ruler\s*\/\s*inline-size/);
  assert.match(css,/\.time-ruler-ticks>span\{[^}]*flex:0 0 auto;white-space:nowrap/);
  // Leave the shared accessible focus outline untouched (up to 3px + 4px
  // offset) and reserve more than its 7px outside the 44px input track.
  assert.match(css,/\.time-ruler-ticks\{[^}]*margin-top:8px/);
  const rules=[...css.matchAll(/@container time-ruler \(max-width:(\d+)px\)\{([^\n]+)\}/g)];
  assert.deepEqual(rules.map(rule=>Number(rule[1])),[360,220]);
  assert.match(rules[0][2],/nth-child\(even\)\{display:none\}/);
  assert.match(rules[1][2],/nth-child\(3\)\{display:none\}/);
  assert.match(rules[1][2],/\.time-ruler-label output span\{display:block\}/);
  for(const rule of rules)assert.doesNotMatch(rule[2],/first-child|last-child|nth-child\([15]\)/);
});

test('editor qualification imports the same stylesheet order as the real studio',async()=>{
  const paths=['../src/studio/main.tsx','./live-editor-qualification.tsx'];
  for(const path of paths){
    const source=await readFile(new URL(path,import.meta.url),'utf8');
    const styles=[...source.matchAll(/import ['"][^'"]*\/(studio|responsive|workbench)\.css['"]/g)].map(match=>match[1]);
    assert.deepEqual(styles,['studio','responsive','workbench']);
  }
});
