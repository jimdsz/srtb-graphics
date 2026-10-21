import {beforeAll,afterEach,it,expect,vi} from 'vitest';
import {generateKeyPair,exportPKCS8,decodeJwt} from 'jose';
import {firebaseAccountAdmin} from '../../server/firebase-account-admin';

let config:Env;
beforeAll(async()=>{
  const pair=await generateKeyPair('RS256',{extractable:true});
  config={FIREBASE_PROJECT_ID:'srtb-graphics',FIREBASE_ACCOUNT_DELETER:JSON.stringify({project_id:'srtb-graphics',client_email:'graphics-account-deleter@srtb-graphics.iam.gserviceaccount.com',private_key:await exportPKCS8(pair.privateKey)})} as Env;
});
afterEach(()=>vi.restoreAllMocks());
function mockIdentity(handler:(action:string,body:Record<string,unknown>)=>unknown){
  return vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
    const req=new Request(input,init);expect(req.redirect).toBe('manual');
    if(req.url==='https://oauth2.googleapis.com/token'){
      const form=new URLSearchParams(new TextDecoder().decode(await req.arrayBuffer())),claims=decodeJwt(form.get('assertion')!);
      expect(claims.scope).toBe('https://www.googleapis.com/auth/identitytoolkit');
      expect(claims.iss).toBe('graphics-account-deleter@srtb-graphics.iam.gserviceaccount.com');
      expect(claims.aud).toBe('https://oauth2.googleapis.com/token');expect(claims.exp!-claims.iat!).toBe(300);
      return Response.json({access_token:'test-server-token'});
    }
    expect(req.url).toMatch(/^https:\/\/identitytoolkit\.googleapis\.com\/v1\/projects\/srtb-graphics\/accounts:(lookup|delete)$/);
    expect(req.headers.get('authorization')).toBe('Bearer test-server-token');
    const body=await req.json() as Record<string,unknown>;expect(body).not.toHaveProperty('idToken');
    return Response.json(handler(req.url.split(':').at(-1)!,body));
  });
}
it('uses a server credential and pinned UID, verifies absence, and safely retries',async()=>{
  let present=true,deletes=0;
  const spy=mockIdentity((action,body)=>{
    if(action==='delete'){expect(body).toEqual({localId:'target-uid'});present=false;deletes++;return {};}
    return present?{users:[{localId:'target-uid',email:'person@example.test'}]}:{};
  });
  const admin=await firebaseAccountAdmin(config).catch(async e=>{for(const r of spy.mock.results)await r.value;throw e;});expect(await admin.lookup('person@example.test')).toBe('target-uid');
  await admin.remove('target-uid','person@example.test');await admin.remove('target-uid','person@example.test');expect(deletes).toBe(1);expect(await admin.lookup('person@example.test')).toBeNull();
});
it('refuses a replaced UID or mismatched e-mail without a delete',async()=>{
  const calls:string[]=[];mockIdentity(action=>{calls.push(action);return {users:[{localId:'replacement',email:'other@example.test'}]};});
  const admin=await firebaseAccountAdmin(config);await expect(admin.remove('target-uid','person@example.test')).rejects.toMatchObject({status:409});await expect(admin.lookup('person@example.test')).rejects.toMatchObject({status:503});expect(calls).not.toContain('delete');
});
it('fails closed without credentials, with cross-project credentials, and on provider failures',async()=>{
  const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({error:'private-provider-detail'},{status:403}));
  await expect(firebaseAccountAdmin({...config,FIREBASE_ACCOUNT_DELETER:undefined})).rejects.toMatchObject({status:503});
  await expect(firebaseAccountAdmin({...config,FIREBASE_PROJECT_ID:'another-project'})).rejects.toMatchObject({status:503});expect(fetch).not.toHaveBeenCalled();
  await expect(firebaseAccountAdmin(config)).rejects.toMatchObject({status:503});
  await expect(firebaseAccountAdmin(config)).rejects.not.toThrow('private-provider-detail');
});
it('does not announce success when provider still returns the deleted identity',async()=>{
  mockIdentity(action=>action==='delete'?{}:{users:[{localId:'target-uid',email:'person@example.test'}]});
  const admin=await firebaseAccountAdmin(config);await expect(admin.remove('target-uid','person@example.test')).rejects.toMatchObject({status:503});
});
