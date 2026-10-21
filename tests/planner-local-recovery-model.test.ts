import assert from 'node:assert/strict';
import test from 'node:test';
import {plannerRecoveryFingerprint} from '../src/studio/planner-local-recovery-model';

test('local recovery equality ignores object key order at every depth',()=>{
 assert.equal(plannerRecoveryFingerprint({base:{id:'a',data:{name:'',rows:[{id:'line',title:''}]}},plan:{title:'retouche'}}),plannerRecoveryFingerprint({plan:{title:'retouche'},base:{data:{rows:[{title:'',id:'line'}],name:''},id:'a'}}));
});
test('local recovery equality detects altered content even with identical revision',()=>{
 assert.notEqual(plannerRecoveryFingerprint({revision:4,data:{title:'Avant'}}),plannerRecoveryFingerprint({revision:4,data:{title:'Après'}}));
});
test('local recovery equality retains row and selection order',()=>{
 assert.notEqual(plannerRecoveryFingerprint({rows:[{id:'a'},{id:'b'}]}),plannerRecoveryFingerprint({rows:[{id:'b'},{id:'a'}]}));
});
test('local recovery equality does not turn blank or null fields into missing data',()=>{
 assert.notEqual(plannerRecoveryFingerprint({title:'',logo:null}),plannerRecoveryFingerprint({title:''}));
 assert.notEqual(plannerRecoveryFingerprint({title:''}),plannerRecoveryFingerprint({title:'Titre'}));
});
