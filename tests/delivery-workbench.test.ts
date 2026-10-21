import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import ExportFormatPicker from '../src/studio/ExportFormatPicker';

test('export choices retain the four engine values and a single selected native radio',()=>{
  for(const value of ['mp4','mov','png','alpha'] as const){
    const html=renderToStaticMarkup(createElement(ExportFormatPicker,{value,onChange(){}}));
    const radios=html.match(/<input\b[^>]*>/g)||[];
    assert.equal(radios.length,4);assert.equal(radios.filter(radio=>radio.includes('checked=""')).length,1);
    assert.match(radios.find(radio=>radio.includes('checked=""'))!,new RegExp(`value="${value}"`));
    for(const format of ['mp4','mov','png','alpha'])assert.ok(radios.some(radio=>radio.includes(`value="${format}"`)));
    assert.match(html,/MP4 · H.264 · Fond opaque/);assert.match(html,/MOV · ProRes 4444 · Transparence alpha/);
  }
});
test('format controls share a name within a picker, never across two pickers',()=>{
  const html=renderToStaticMarkup(createElement('div',null,createElement(ExportFormatPicker,{value:'mp4',onChange(){}}),createElement(ExportFormatPicker,{value:'mov',onChange(){}})));
  const names=[...html.matchAll(/name="([^"]+)"/g)].map(match=>match[1]);
  assert.equal(new Set(names.slice(0,4)).size,1);assert.equal(new Set(names.slice(4)).size,1);assert.notEqual(names[0],names[4]);
});
test('export presentation preserves guarded render, format arguments, cancellation and real progress',()=>{
  const source=readFileSync(new URL('../src/studio/VideoExport.tsx',import.meta.url),'utf8');
  assert.match(source,/if\(!permitted\|\|controller.current\)return/);
  assert.ok(source.includes('{format,audio,manualOut,removeBackground,background},task.signal,p=>{setPercent(p.percent);setMessage(p.message);}'));
  assert.match(source,/<fieldset disabled=\{running\}>/);assert.match(source,/disabled=\{!permitted\|\|running\}/);
  assert.match(source,/controller.current\?\.abort\(\)/);assert.match(source,/percent=\{percent>=5\?percent:undefined\}/);
  assert.match(source,/report.bitrateWarning\?<p className="notice warning" role="alert"/);
  assert.match(source,/report.checkedFrames.length/);assert.match(source,/minimumOneSecondVideoBitrate/);
});
