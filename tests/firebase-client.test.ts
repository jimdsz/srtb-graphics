import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {User} from 'firebase/auth';
import {refreshSession,isExistingIdentity} from '../src/studio/firebase-client';
import {ApiError} from '../src/studio/api';
import {sessionState} from '../src/studio/session-state';

const transientMessage='Service de connexion momentanément indisponible. Réessayez sans fermer cet onglet.';
const rejectedMessage='Connexion refusée. Reconnectez-vous.';
test('only the precise provider email-exists error opens account reuse, never disabled/network/invalid errors',()=>{
  assert.equal(isExistingIdentity({code:'auth/email-already-in-use'}),true);
  for(const error of [null,undefined,'auth/email-already-in-use',{},new Error('auth/email-already-in-use'),{code:'auth/network-request-failed'},{code:'auth/user-disabled'},{code:'auth/invalid-credential'}])assert.equal(isExistingIdentity(error),false);
});

for(const renew of [true,false])for(const fresh of [true,false])test(`refreshSession sends one ${fresh?'fresh':'cached'} token and one ${renew?'renewal':'login'} request`,async t=>{
  const getIdToken=t.mock.fn(async()=>'test-id-token');
  // refreshSession consumes only this User method; no Firebase app is initialised.
  const user={getIdToken} as User;
  const request=t.mock.method(globalThis,'fetch',async()=>new Response(null,{status:204}));
  const before=sessionState.snapshot();
  assert.equal(await refreshSession(user,renew,fresh),undefined);
  assert.equal(getIdToken.mock.callCount(),1);assert.deepEqual(getIdToken.mock.calls[0].arguments,[fresh]);
  assert.equal(request.mock.callCount(),1);
  const [url,options]=request.mock.calls[0].arguments as unknown as [string,RequestInit];
  assert.ok(options.signal instanceof AbortSignal);
  const {signal,...requestOptions}=options;
  assert.deepEqual([url,requestOptions],[renew?'/api/auth/refresh':'/api/auth/session',{
    method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:'test-id-token'}),
  }]);
  assert.deepEqual(sessionState.snapshot(),before);
});

for(const status of [503,401,403])for(const body of ['json','malformed-json','html'] as const){
  test(`refreshSession preserves HTTP ${status} with ${body}, without retry or local session mutation`,async t=>{
    const getIdToken=t.mock.fn(async()=>'test-id-token'),user={getIdToken} as User;
    const response=body==='json'?Response.json({error:'Provider response'},{status}):new Response(body==='html'?'<html>Gateway</html>':'{',{status,headers:{'Content-Type':body==='html'?'text/html':'application/json'}});
    const request=t.mock.method(globalThis,'fetch',async()=>response),before=sessionState.snapshot();
    await assert.rejects(refreshSession(user),(error:unknown)=>{
      assert.ok(error instanceof ApiError);assert.equal(error.status,status);
      assert.equal(error.message,body==='json'?'Provider response':status===503?transientMessage:rejectedMessage);return true;
    });
    assert.equal(getIdToken.mock.callCount(),1);assert.equal(request.mock.callCount(),1);
    assert.deepEqual(sessionState.snapshot(),before);
  });
}

test('refreshSession propagates a rejected network request without recasting it as 401 or retrying',async t=>{
  const failure=new TypeError('Network unavailable'),getIdToken=t.mock.fn(async()=>'test-id-token');
  const request=t.mock.method(globalThis,'fetch',async()=>{throw failure;}),before=sessionState.snapshot();
  await assert.rejects(refreshSession({getIdToken} as User),error=>error===failure);
  assert.equal(getIdToken.mock.callCount(),1);assert.equal(request.mock.callCount(),1);
  assert.deepEqual(sessionState.snapshot(),before);
});

for(const code of ['auth/network-request-failed','auth/user-token-expired'])test(`refreshSession preserves SDK ${code} and does not submit an absent token`,async t=>{
  const failure=Object.assign(new Error('SDK failure'),{code}),getIdToken=t.mock.fn(async()=>{throw failure;});
  const request=t.mock.method(globalThis,'fetch',async()=>new Response(null,{status:204})),before=sessionState.snapshot();
  await assert.rejects(refreshSession({getIdToken} as User),error=>error===failure);
  assert.equal(getIdToken.mock.callCount(),1);assert.equal(request.mock.callCount(),0);
  assert.deepEqual(sessionState.snapshot(),before);
});
