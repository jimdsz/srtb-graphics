import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalSocialText,socialTextRuns,socialLineRuns} from '../src/studio/social-text-runs';
test('native joined titles preserve field ownership through newlines and wrapped lines',()=>{
 const {text,runs}=socialTextRuns([{field:'_title_1',text:'Une  grande histoire'},{field:'_title_2',text:'À\nl’antenne'}]);
 assert.equal(text,'Une grande histoire\nÀ\nl’antenne');
 assert.deepEqual(socialLineRuns('grande histoire',4,runs),[{field:'_title_1',text:'grande histoire',prefix:''}]);
 assert.deepEqual(socialLineRuns('l’antenne',22,runs),[{field:'_title_2',text:'l’antenne',prefix:''}]);
});
test('day and hour runs preserve separator and exact native placement',()=>{
 const native=socialTextRuns([{field:'_day',text:'Ce soir'},{field:'_hour',text:'20H30',separator:' · '}]);
 assert.equal(native.text,'Ce soir · 20H30');assert.deepEqual(socialLineRuns(native.text,0,native.runs),[{field:'_day',text:'Ce soir',prefix:''},{field:'',text:' · ',prefix:'Ce soir'},{field:'_hour',text:'20H30',prefix:'Ce soir · '}]);
});
test('empty optional fields do not introduce delimiters or phantom handles',()=>{
 assert.deepEqual(socialTextRuns([{field:'_day',text:''},{field:'_hour',text:'20H30',separator:' · '}]),{text:'20H30',runs:[{field:'_hour',start:0,end:5}]});assert.equal(canonicalSocialText(' e\u0301té \r\n grand   jour'),'été\ngrand jour');
});
