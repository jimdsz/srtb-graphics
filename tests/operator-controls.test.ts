import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ProgressGauge from '../src/studio/ui/ProgressGauge';
import Activity from '../src/studio/Activity';
test('determinate progress exposes bounded measured values and never invents indeterminate percentages',()=>{
  for(const [value,expected] of [[61.8,61],[-12,0],[114,100],[NaN,0]]){
    const html=renderToStaticMarkup(createElement(ProgressGauge,{label:'Calcul des images',value}));
    assert.ok(html.includes(`aria-valuenow="${expected}"`));assert.ok(html.includes(`${expected} %`));
  }
  const pending=renderToStaticMarkup(createElement(Activity,{label:'Préparation du son'}));
  assert.ok(pending.includes('role="status"'));assert.ok(pending.includes('Préparation du son'));
  assert.ok(!pending.includes('aria-valuenow'));assert.ok(!pending.includes('%'));
});
