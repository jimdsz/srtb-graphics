import test from 'node:test';
import assert from 'node:assert/strict';
import {textStyleUndo,undoTextStyle} from '../src/studio/typography-history';
import {patchTextStyle,textStyles} from '../src/studio/typography-model';
test('typography undo preserves later movement and other fields/formats',()=>{
 const before={_studio_format:'tv'},after={...before,...patchTextStyle(before,'_title',{size:80})},undo=textStyleUndo(before,after,'_title');
 let later={...after,...patchTextStyle(after,'_title',{x:10,y:20})};later={...later,...patchTextStyle(later,'_label',{font:'suisse'})};
 const social={...later,_studio_format:'portrait'};later={...social,...patchTextStyle(social,'_title',{size:70})};
 const result=textStyles({...later,...undoTextStyle(later,undo)});
 assert.deepEqual(result,{'tv:_title':{x:10,y:20},'tv:_label':{font:'suisse'},'portrait:_title':{size:70}});
});
test('typography undo does not overwrite a subsequent change to the same property',()=>{
 const before={_studio_typography:'{"tv:_title":{"size":100,"x":1}}'},after={...before,...patchTextStyle(before,'_title',{size:80})},undo=textStyleUndo(before,after,'_title');
 const later={...after,...patchTextStyle(after,'_title',{size:60,x:9})};assert.deepEqual(textStyles({...later,...undoTextStyle(later,undo)})['tv:_title'],{size:60,x:9});
});
test('undo reset restores only missing original properties while preserving a newer position',()=>{
 const before={_studio_typography:'{"tv:_title":{"size":80,"font":"suisse","x":1}}'},after={...before,...patchTextStyle(before,'_title',null)},undo=textStyleUndo(before,after,'_title');
 const later={...after,...patchTextStyle(after,'_title',{x:12})};assert.deepEqual(textStyles({...later,...undoTextStyle(later,undo)})['tv:_title'],{x:12,size:80,font:'suisse'});
});
