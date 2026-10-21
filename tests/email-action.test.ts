import test from 'node:test';
import assert from 'node:assert/strict';
import type {ActionCodeInfo} from 'firebase/auth';
import {EmailActionError,emailActionMode,reviewEmailAction,waitForEmailProvider} from '../src/studio/email-action';

const target='destination@example.test',current='actuelle@example.test';
function info(operation:ActionCodeInfo['operation'],data:ActionCodeInfo['data']={email:target,previousEmail:current}):ActionCodeInfo{return {operation,data};}
const reason=(expected:string)=>(error:unknown)=>error instanceof EmailActionError&&error.reason===expected;

test('only the three qualified modes are supported',()=>{
 for(const mode of ['verifyEmail','recoverEmail','verifyAndChangeEmail'])assert.equal(emailActionMode(mode),true);
 for(const mode of [null,'resetPassword','signIn','revertSecondFactorAddition','constructor','toString','VERIFY_EMAIL',''])assert.equal(emailActionMode(mode),false);
});
test('verification uses only the provider destination and needs no previous address',()=>{
 assert.deepEqual(reviewEmailAction('verifyEmail',info('VERIFY_EMAIL',{email:target})),{mode:'verifyEmail',operation:'VERIFY_EMAIL',email:target,previousEmail:null});
});
test('recovery restores data.email and replaces data.previousEmail',()=>{
 assert.deepEqual(reviewEmailAction('recoverEmail',info('RECOVER_EMAIL')),{mode:'recoverEmail',operation:'RECOVER_EMAIL',email:target,previousEmail:current});
});
test('verified change uses the same destination contract',()=>{
 assert.deepEqual(reviewEmailAction('verifyAndChangeEmail',info('VERIFY_AND_CHANGE_EMAIL')),{mode:'verifyAndChangeEmail',operation:'VERIFY_AND_CHANGE_EMAIL',email:target,previousEmail:current});
});
test('crossed operations, password, sign-in and MFA never qualify',()=>{
 for(const mode of ['verifyEmail','recoverEmail','verifyAndChangeEmail'])for(const operation of ['EMAIL_SIGNIN','PASSWORD_RESET','REVERT_SECOND_FACTOR_ADDITION'] as const)assert.throws(()=>reviewEmailAction(mode,info(operation)),reason('mismatch'));
 assert.throws(()=>reviewEmailAction('verifyEmail',info('RECOVER_EMAIL')),reason('mismatch'));
 assert.throws(()=>reviewEmailAction('recoverEmail',info('VERIFY_EMAIL')),reason('mismatch'));
 assert.throws(()=>reviewEmailAction('verifyAndChangeEmail',info('RECOVER_EMAIL')),reason('mismatch'));
 assert.throws(()=>reviewEmailAction('revertSecondFactorAddition',info('REVERT_SECOND_FACTOR_ADDITION')),reason('unsupported'));
});
test('missing provider addresses fail closed',()=>{
 for(const data of [{},{email:target},{previousEmail:current}])for(const mode of ['recoverEmail','verifyAndChangeEmail'] as const)assert.throws(()=>reviewEmailAction(mode,info(mode==='recoverEmail'?'RECOVER_EMAIL':'VERIFY_AND_CHANGE_EMAIL',data)),reason('data'));
 assert.throws(()=>reviewEmailAction('verifyEmail',info('VERIFY_EMAIL',{})),reason('data'));
});
test('malformed or visually ambiguous provider addresses fail closed',()=>{
 for(const email of ['', 'not-an-email','<img@example.test>','line\n@example.test','name\u202e@example.test',' name@example.test','a'.repeat(250)+'@example.test'])assert.throws(()=>reviewEmailAction('verifyEmail',info('VERIFY_EMAIL',{email})),reason('data'));
});
test('identical replacement addresses fail closed without claiming a change',()=>{
 assert.throws(()=>reviewEmailAction('recoverEmail',info('RECOVER_EMAIL',{email:target,previousEmail:target.toUpperCase()})),reason('data'));
});
test('a provider response received in time is preserved',async()=>{
 assert.equal(await waitForEmailProvider(Promise.resolve('verified'),100),'verified');
});
test('a timely provider rejection is preserved for safe classification',async()=>{
 const error=Object.assign(new Error('private provider detail'),{code:'auth/expired-action-code'});
 await assert.rejects(waitForEmailProvider(Promise.reject(error),100),value=>value===error);
});
test('local timeout does not cancel, retry or await an eventual provider result',async()=>{
 let finish!:(value:string)=>void,settled=false;
 const original=new Promise<string>(resolve=>{finish=resolve;}).then(value=>{settled=true;return value;});
 await assert.rejects(waitForEmailProvider(original,5),error=>typeof error==='object'&&error!==null&&'code'in error&&error.code==='auth/network-request-failed');
 assert.equal(settled,false);finish('eventual result');assert.equal(await original,'eventual result');assert.equal(settled,true);
});
