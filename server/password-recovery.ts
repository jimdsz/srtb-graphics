import {z} from 'zod';
import {checkOrigin,HttpError,json,readJson} from './http';

const codeSchema=z.string().min(10).max(2048);
const emailSchema=z.email().max(254).transform(value=>value.toLowerCase());
const generic='Si un compte correspond à cette adresse, un e-mail de récupération sera envoyé. Vérifiez aussi les courriers indésirables.';
const digest=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
async function limit(env:Env,subject:string,maximum:number){
  const key=await digest(`recovery:${subject}:${Math.floor(Date.now()/600000)}`);
  const row=await env.DB.prepare('INSERT INTO login_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(key,Date.now()+1200000).first<{count:number}>();
  if(!row||row.count>maximum)throw new HttpError(429,'Trop de demandes. Patientez quelques minutes avant de réessayer.',{'Retry-After':'600'});
}
async function provider(env:Env,endpoint:string,body:unknown){
  let response:Response;
  try{response=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${endpoint}?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`,{method:'POST',headers:{'Content-Type':'application/json','X-Firebase-Locale':'fr'},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});}catch{throw new HttpError(503,'Le service de récupération ne répond pas. Réessayez dans un instant.');}
  let data:unknown;
  try{data=await readJson(new Request('https://internal.invalid',{method:'POST',headers:{'Content-Type':'application/json'},body:response.body}),32*1024);}catch{throw new HttpError(503,'Réponse incomplète. Réessayez dans un instant.');}
  if(!response.ok){
    const parsed=z.object({error:z.object({message:z.string()})}).safeParse(data);
    const code=parsed.success?parsed.data.error.message.split(' : ')[0]:'';
    if(endpoint==='sendOobCode'&&['EMAIL_NOT_FOUND','USER_DISABLED'].includes(code))return {};
    if(['EXPIRED_OOB_CODE','INVALID_OOB_CODE'].includes(code))throw new HttpError(410,'Ce lien a expiré ou a déjà été utilisé. Demandez un nouveau lien.');
    if(code==='USER_DISABLED')throw new HttpError(403,'Ce compte est suspendu. La récupération ne peut pas rétablir son accès.');
    if(code.startsWith('WEAK_PASSWORD')||code==='PASSWORD_DOES_NOT_MEET_REQUIREMENTS')throw new HttpError(422,'Choisissez un mot de passe d’au moins 12 caractères, conforme aux critères affichés.');
    if(response.status===429||code==='TOO_MANY_ATTEMPTS_TRY_LATER')throw new HttpError(429,'Trop de tentatives. Patientez avant de réessayer.');
    throw new HttpError(503,'La récupération est momentanément indisponible. Réessayez dans un instant.');
  }
  return data;
}
async function identity(env:Env,code:string){
  const parsed=z.object({email:emailSchema,requestType:z.literal('PASSWORD_RESET')}).safeParse(await provider(env,'resetPassword',{oobCode:code}));
  if(!parsed.success)throw new HttpError(410,'Ce lien ne permet pas de changer le mot de passe. Demandez un nouveau lien.');
  return parsed.data.email;
}
export async function passwordRecoveryRoutes(request:Request,env:Env):Promise<Response|null>{
  const path=new URL(request.url).pathname;
  if(!path.startsWith('/api/auth/recovery/'))return null;
  checkOrigin(request);
  if(request.method!=='POST')throw new HttpError(405,'Action non disponible.');
  if(env.AUTH_MODE!=='firebase'||!env.FIREBASE_API_KEY)throw new HttpError(503,'Service de récupération indisponible.');
  await env.DB.prepare('DELETE FROM login_limits WHERE expires_at<?').bind(Date.now()).run();
  await limit(env,`ip:${request.headers.get('CF-Connecting-IP')||'unknown'}`,60);
  const body=await readJson(request,8192);
  if(path==='/api/auth/recovery/request'){
    const {email}=z.object({email:emailSchema}).strict().parse(body);
    await limit(env,`email:${email}`,5);
    await provider(env,'sendOobCode',{requestType:'PASSWORD_RESET',email,continueUrl:'https://srtb-graphics.pages.dev/login'});
    return json({ok:true,message:generic});
  }
  if(path==='/api/auth/recovery/verify'){
    const {code}=z.object({code:codeSchema}).strict().parse(body);
    return json({email:await identity(env,code)});
  }
  if(path==='/api/auth/recovery/confirm'){
    const {code,password}=z.object({code:codeSchema,password:z.string().min(12).max(4096)}).strict().parse(body);
    const email=await identity(env,code),operation=crypto.randomUUID(),now=Date.now();
    // Only the provider identifies the account. Revoke before confirmation and
    // exclude concurrent login writes. Never accept a browser-supplied email.
    const acquired=await env.DB.prepare('INSERT INTO recovery_barriers(email,operation,blocked_until,changed_at) VALUES(?,?,?,?) ON CONFLICT(email) DO UPDATE SET operation=excluded.operation,blocked_until=excluded.blocked_until,changed_at=excluded.changed_at WHERE recovery_barriers.blocked_until<=? RETURNING email').bind(email,operation,now+120000,now,now).first();
    if(!acquired)throw new HttpError(409,'Une récupération est déjà en cours. Patientez puis reconnectez-vous ou demandez un nouveau lien.');
    await env.DB.prepare('DELETE FROM app_sessions WHERE email=?').bind(email).run();
    try{await provider(env,'resetPassword',{oobCode:code,newPassword:password});}
    catch(error){
      // A lost response may still mean the provider changed the password. Keep
      // the short barrier in that case; existing sessions remain invalidated.
      if(error instanceof HttpError&&error.status<500)await env.DB.prepare('UPDATE recovery_barriers SET blocked_until=0,changed_at=? WHERE email=? AND operation=?').bind(Date.now(),email,operation).run();
      throw error;
    }
    await env.DB.batch([
      env.DB.prepare('DELETE FROM app_sessions WHERE email=?').bind(email),
      env.DB.prepare('UPDATE recovery_barriers SET blocked_until=0,changed_at=? WHERE email=? AND operation=?').bind(Date.now(),email,operation),
      env.DB.prepare("INSERT INTO activity(actor,action,target,detail) VALUES(?,'account.password-recovered',?,'Sessions antérieures révoquées')").bind(email,email),
    ]);
    return json({ok:true,message:'Mot de passe modifié. Reconnectez-vous avec votre nouveau mot de passe.'});
  }
  throw new HttpError(404,'Action de récupération inconnue.');
}
