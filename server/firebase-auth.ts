import {decodeProtectedHeader,importX509,jwtVerify} from 'jose';
import {z} from 'zod';
import {effectiveRoleSql} from './tool-access';
import type {Member} from '../src/studio/domain';
import {HttpError,json,readJson,checkOrigin} from './http';
import {passwordRecoveryRoutes} from './password-recovery';

const cookieName='__Host-srtb_session';
const firebaseIdentity=z.object({sub:z.string().min(1).max(128),email:z.email(),email_verified:z.literal(true),exp:z.number(),iat:z.number(),auth_time:z.number(),firebase:z.object({sign_in_provider:z.string()})});
export const firebaseConfigured=(env:Env)=>/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(env.FIREBASE_PROJECT_ID)&&/^AIza[\w-]{30,50}$/.test(env.FIREBASE_API_KEY);
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
function cookie(request:Request){const value=request.headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);return value&&/^[a-f\d]{64}$/.test(value)?value:null;}
const unavailable=()=>new HttpError(503,'Service de connexion temporairement indisponible. Réessayez dans un instant.');
const invalidIdentity=()=>new HttpError(401,'Connexion invalide, expirée ou adresse non vérifiée. Reconnectez-vous après vérification de votre e-mail.');
const rejectedGoogleIdentity=new Set(['INVALID_ID_TOKEN','TOKEN_EXPIRED','USER_DISABLED','USER_NOT_FOUND','CREDENTIAL_TOO_OLD_LOGIN_AGAIN']);
async function googleJSON(url:string,init:RequestInit={},accountLookup=false){
  let response:Response;
  try{response=await fetch(url,{...init,signal:AbortSignal.timeout(8000)});}catch{throw unavailable();}
  if(response.status>=500||response.status===408||response.status===429)throw unavailable();
  let value:unknown;
  try{value=await readJson(new Request('https://internal.invalid',{method:'POST',headers:{'Content-Type':'application/json'},body:response.body}),128*1024);}catch{throw unavailable();}
  if(!response.ok){
    const error=z.object({error:z.object({message:z.string()})}).safeParse(value);
    if(accountLookup&&error.success&&rejectedGoogleIdentity.has(error.data.error.message.split(' : ')[0]))throw invalidIdentity();
    // Configuration/provider errors must not be mistaken for a revoked user.
    throw unavailable();
  }
  return {value,headers:response.headers};
}

type PublicCertificates={keys:ReadonlyMap<string,CryptoKey>;expiresAt:number};
// Only public Google verification keys are shared across requests. No identity,
// account lookup, membership, session or verification result is cached here.
let publicCertificates:PublicCertificates|undefined;
function certificateTtl(headers:Headers){
  const directives=(headers.get('Cache-Control')??'').split(',').map(value=>value.trim());
  if(directives.some(value=>/^(?:no-store|no-cache)(?:\s*=|$)/i.test(value)))return 0;
  const ages=directives.filter(value=>/^max-age\s*=/i.test(value));
  if(ages.length!==1)return 0;
  const match=ages[0].match(/^max-age\s*=\s*"?(\d+)"?$/i),ageHeader=headers.get('Age')??'0';
  if(!match||!/^\d+$/.test(ageHeader))return 0;
  const maxAge=Number(match[1]),age=Number(ageHeader);
  if(!Number.isSafeInteger(maxAge)||!Number.isSafeInteger(age))return 0;
  return Math.min(24*3600000,Math.max(0,maxAge-age)*1000);
}
async function refreshCertificates(){
  // A fetch belongs to its initiating Worker request. Sharing its Promise can
  // strand other requests when that owner ends, even with cross-request promise
  // resolution enabled. Cache only fully resolved public keys, never pending I/O.
  const started=Date.now();
  const {value,headers}=await googleJSON('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
  const parsed=z.record(z.string().min(1).max(256),z.string().min(1).max(16384)).safeParse(value);
  if(!parsed.success)throw unavailable();
  const certificates=Object.entries(parsed.data);
  if(!certificates.length||certificates.length>64)throw unavailable();
  const keys=new Map<string,CryptoKey>();
  try{for(const [kid,certificate] of certificates)keys.set(kid,await importX509(certificate,'RS256'));}catch{throw unavailable();}
  const result={keys,expiresAt:started+certificateTtl(headers)};
  publicCertificates=result;return result;
}
async function firebasePublicKey(kid:string){
  let certificates=publicCertificates;
  // Missing/expired keys and a rotation miss each get one request-owned fetch.
  // Warm requests reuse resolved keys; unknown kids/users are not negative-cached.
  if(!certificates||certificates.expiresAt<=Date.now()||!certificates.keys.has(kid))certificates=await refreshCertificates();
  const key=certificates.keys.get(kid);if(!key)throw invalidIdentity();return key;
}
export async function verifyFirebaseToken(token:string,env:Env){
  if(!firebaseConfigured(env))throw new HttpError(503,'Le service de connexion n’est pas encore configuré.');
  try{
    const header=decodeProtectedHeader(token);if(header.alg!=='RS256'||typeof header.kid!=='string'||!header.kid||header.kid.length>256)throw invalidIdentity();
    const key=await firebasePublicKey(header.kid);
    const result=await jwtVerify(token,key,{algorithms:['RS256'],issuer:`https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,audience:env.FIREBASE_PROJECT_ID,requiredClaims:['exp','iat','auth_time','sub','email','email_verified']});
    const identity=firebaseIdentity.parse(result.payload),now=Math.floor(Date.now()/1000);
    if(identity.iat>now+5||identity.auth_time>now+5||identity.firebase.sign_in_provider==='anonymous')throw Error('Invalid identity');
    // A valid signature alone does not detect a disabled/deleted Firebase account.
    const {value}=await googleJSON(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:token})},true);
    const account=z.object({users:z.array(z.object({localId:z.string(),email:z.email(),emailVerified:z.boolean(),disabled:z.boolean().optional(),validSince:z.string().regex(/^\d+$/).optional()})).max(1)}).safeParse(value);
    if(!account.success)throw unavailable();
    const current=account.data.users[0];
    if(!current||current.disabled||!current.emailVerified||current.localId!==identity.sub||current.email.toLowerCase()!==identity.email.toLowerCase()||Number(current.validSince||0)>identity.auth_time||identity.exp*1000<=Date.now())throw invalidIdentity();
    return {...identity,email:identity.email.toLowerCase()};
  }catch(error){if(error instanceof HttpError&&error.status===503)throw error;throw invalidIdentity();}
}
export type SessionMember = Member & {sessionExpiresAt?:number};
export async function authenticateSession(request:Request,env:Env):Promise<SessionMember>{
  if(!firebaseConfigured(env))throw new HttpError(503,'La connexion Firebase n’est pas encore configurée. Les contenus privés restent protégés.');
  const token=cookie(request);if(!token)throw new HttpError(401,'Connectez-vous avec votre compte SRTB Graphics.');
  const member=await env.DB.prepare(`SELECT m.email,m.name,${effectiveRoleSql('m')},m.active,s.expires_at AS sessionExpiresAt FROM app_sessions s JOIN members m ON m.email=s.email AND m.firebase_uid=s.firebase_uid WHERE s.token_hash=? AND s.expires_at>? AND m.active=1 AND NOT EXISTS(SELECT 1 FROM recovery_barriers b WHERE b.email=m.email AND (b.blocked_until>? OR s.created_at<=b.changed_at))`).bind(await hash(token),Date.now(),Date.now()).first<SessionMember>();
  if(!member)throw new HttpError(401,'Session expirée ou accès suspendu. Reconnectez-vous.');return member;
}
export function isPublicAppPath(path:string){return ['/', '/index.html','/studio.html','/graphics','/commercial','/signatures','/login','/auth/action','/favicon.ico'].includes(path)||/^\/assets\/[A-Za-z\d_.-]+$/.test(path)||/^\/fonts\/[A-Za-z\d_.-]+\.(?:otf|ttf|woff2?)$/.test(path);}
export async function firebaseRoutes(request:Request,env:Env):Promise<Response|null>{
  const path=new URL(request.url).pathname;
  if(!path.startsWith('/api/auth/'))return null;
  if(env.AUTH_MODE!=='firebase')throw new HttpError(404,'Connexion non disponible.');
  const recovery=await passwordRecoveryRoutes(request,env);if(recovery)return recovery;
  if(path==='/api/auth/config'&&request.method==='GET')return json(firebaseConfigured(env)?{enabled:true,apiKey:env.FIREBASE_API_KEY,projectId:env.FIREBASE_PROJECT_ID,authDomain:`${env.FIREBASE_PROJECT_ID}.firebaseapp.com`}:{enabled:false});
  checkOrigin(request);
  if(path==='/api/auth/logout'&&request.method==='POST'){
    const token=cookie(request);if(token)await env.DB.prepare('DELETE FROM app_sessions WHERE token_hash=?').bind(await hash(token)).run();
    const response=json({ok:true});response.headers.set('Set-Cookie',`${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);return response;
  }
  if(!['/api/auth/session','/api/auth/refresh'].includes(path)||request.method!=='POST')throw new HttpError(404,'Connexion non disponible.');
  const renewing=path==='/api/auth/refresh';
  // A background renewal can only extend a still-valid session, never recreate one.
  const current=renewing?await authenticateSession(request,env):null;
  if(!firebaseConfigured(env))throw new HttpError(503,'La connexion n’est pas encore configurée.');
  const now=Date.now(),period=Math.floor(now/600000),ip=request.headers.get('CF-Connecting-IP')||'unknown';
  // Authenticated renewals are isolated per session; a newsroom behind one NAT
  // must not consume the anonymous login budget every ten minutes.
  const limitKey=await hash(renewing?`renew:${cookie(request)}:${period}`:`login:${ip}:${period}`);
  const count=await env.DB.prepare('INSERT INTO login_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(limitKey,now+1200000).first<{count:number}>();
  if(!count||count.count>(renewing?30:120))throw new HttpError(429,'Trop de tentatives. Réessayez dans dix minutes.');
  const input=z.object({idToken:z.string().min(100).max(8192)}).strict().parse(await readJson(request,10000));
  const verificationStarted=Date.now();
  const identity=await verifyFirebaseToken(input.idToken,env);
  const barrier=await env.DB.prepare('SELECT blocked_until,changed_at FROM recovery_barriers WHERE email=?').bind(identity.email).first<{blocked_until:number;changed_at:number}>();
  if(barrier&&(barrier.blocked_until>Date.now()||barrier.changed_at>=verificationStarted))throw new HttpError(409,'La récupération de votre compte est en cours. Reconnectez-vous dans un instant.');
  if(current&&current.email!==identity.email)throw new HttpError(401,'Le compte de la session a changé. Reconnectez-vous.');
  const existing=await env.DB.prepare('SELECT email,firebase_uid FROM members WHERE email=? AND active=1').bind(identity.email).first<{email:string;firebase_uid:string|null}>();
  if(!existing||existing.firebase_uid&&existing.firebase_uid!==identity.sub)throw new HttpError(403,'Ce compte n’est pas autorisé. Contactez l’administrateur Graphics.');
  const expires=Math.min(identity.exp*1000,Date.now()+3600000);
  const old=cookie(request);
  if(renewing){
    // Keep the opaque cookie stable across tabs. UPDATE cannot revive a session
    // deleted by logout while the Firebase verification was in flight.
    const updated=await env.DB.prepare('UPDATE app_sessions SET expires_at=MAX(expires_at,?) WHERE token_hash=? AND email=? AND firebase_uid=? AND expires_at>? AND EXISTS(SELECT 1 FROM members WHERE email=? AND firebase_uid=? AND active=1) RETURNING expires_at').bind(expires,await hash(old!),identity.email,identity.sub,Date.now(),identity.email,identity.sub).first<{expires_at:number}>();
    if(!updated)throw new HttpError(401,'Session fermée ou expirée. Reconnectez-vous.');
    const response=json({ok:true,expiresAt:updated.expires_at});response.headers.set('Set-Cookie',`${cookieName}=${old}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(0,Math.floor((updated.expires_at-Date.now())/1000))}`);return response;
  }
  const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
  const writes=await env.DB.batch([
    env.DB.prepare('UPDATE members SET firebase_uid=? WHERE email=? AND active=1 AND (firebase_uid IS NULL OR firebase_uid=?)').bind(identity.sub,identity.email,identity.sub),
    env.DB.prepare('INSERT INTO app_sessions(token_hash,email,firebase_uid,expires_at,created_at) SELECT ?,email,firebase_uid,?,? FROM members WHERE email=? AND firebase_uid=? AND active=1 AND NOT EXISTS(SELECT 1 FROM recovery_barriers WHERE email=members.email AND (blocked_until>? OR changed_at>=?))').bind(await hash(token),expires,now,identity.email,identity.sub,Date.now(),verificationStarted),
    env.DB.prepare('DELETE FROM app_sessions WHERE expires_at<=? OR token_hash=?').bind(now,old?await hash(old):''),
    env.DB.prepare('DELETE FROM login_limits WHERE expires_at<=?').bind(now),
  ]);
  if(writes[1].meta.changes!==1)throw new HttpError(409,'Votre compte a changé pendant la connexion. Reconnectez-vous.');
  const response=json({ok:true,expiresAt:expires});response.headers.set('Set-Cookie',`${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(0,Math.floor((expires-now)/1000))}`);return response;
}
