import {importPKCS8,SignJWT} from 'jose';
import {z} from 'zod';
import {HttpError,readJson} from './http';

const unavailable=()=>new HttpError(503,'La suppression du compte de connexion n’est pas disponible. Aucun effacement complet n’est confirmé. Réessayez ou contactez l’administrateur.');
const account=z.object({localId:z.string().min(1).max(128),email:z.email()});
const credentials=z.object({project_id:z.string(),client_email:z.email(),private_key:z.string().max(16384)});
export interface AccountAdmin { lookup(email:string):Promise<string|null>; remove(uid:string,email:string):Promise<void> }
// One request-owned token, limited by IAM to firebaseauth.users.get/delete.
// Never use a browser ID token: that would delete the requesting administrator.
export async function firebaseAccountAdmin(env:Env):Promise<AccountAdmin> {
  if(!env.FIREBASE_ACCOUNT_DELETER)throw unavailable();
  let credential:z.infer<typeof credentials>;
  try{credential=credentials.parse(JSON.parse(env.FIREBASE_ACCOUNT_DELETER));}catch{throw unavailable();}
  if(!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(env.FIREBASE_PROJECT_ID)||credential.project_id!==env.FIREBASE_PROJECT_ID||credential.client_email!=='graphics-account-deleter@'+env.FIREBASE_PROJECT_ID+'.iam.gserviceaccount.com')throw unavailable();
  async function call(url:string,init:RequestInit){
    try{
      const response=await fetch(url,{...init,redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(10000)});
      if(!response.ok){await response.body?.cancel();throw unavailable();}
      const value=await readJson(response,65536);
      return value;
    }catch{throw unavailable();}
  }
  let assertion:string;
  try{
    assertion=await new SignJWT({scope:'https://www.googleapis.com/auth/identitytoolkit'})
      .setProtectedHeader({alg:'RS256'}).setIssuer(credential.client_email).setAudience('https://oauth2.googleapis.com/token')
      .setIssuedAt().setExpirationTime('5m').sign(await importPKCS8(credential.private_key,'RS256'));
  }catch{throw unavailable();}
  const token=z.object({access_token:z.string().min(1).max(8192)}).safeParse(await call('https://oauth2.googleapis.com/token',{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),
  }));
  if(!token.success)throw unavailable();
  async function api(action:'lookup'|'delete',body:object){return call(`https://identitytoolkit.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/accounts:${action}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token.data!.access_token}`},body:JSON.stringify(body)});}
  async function lookup(body:object){
    const result=z.object({users:z.array(account).max(1).optional()}).safeParse(await api('lookup',body));
    if(!result.success)throw unavailable();return result.data.users?.[0]??null;
  }
  return {
    lookup:async email=>{const user=await lookup({email:[email]});if(user&&user.email.toLowerCase()!==email.toLowerCase())throw unavailable();return user?.localId??null;},
    remove:async(uid,email)=>{
      const user=await lookup({localId:[uid]});
      if(!user)return; // Retry after a successful delete with a lost response.
      if(user.localId!==uid||user.email.toLowerCase()!==email.toLowerCase())throw new HttpError(409,'L’identité de connexion a changé. Suppression interrompue pour protéger le nouveau compte.');
      await api('delete',{localId:uid});
      if(await lookup({localId:[uid]}))throw unavailable();
    },
  };
}
