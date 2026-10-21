import {z} from 'zod';
import type {SessionMember} from './firebase-auth';
import {HttpError,readJson} from './http';

export interface MemberInvitation {status:'requested'|'failed'|'pending';at:string;message?:string}
const messages={
  pending:'Envoi de l’invitation en cours.',
  requested:'Firebase a accepté l’envoi du lien pour choisir le mot de passe. La réception dans la messagerie n’est pas encore confirmée.',
  failed:'L’accès est enregistré, mais l’envoi de l’invitation n’est pas confirmé. Vous pouvez réessayer.',
};
const digest=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
export const memberInvitationLockKey=(email:string)=>digest(`member-invitation-inflight:${email.toLowerCase()}`);
export async function assertNoMemberInvitation(db:D1Database,email:string){
  if(await db.prepare('SELECT key FROM login_limits WHERE key=? AND expires_at>?').bind(await memberInvitationLockKey(email),Date.now()).first())throw new HttpError(409,'Une invitation est en cours pour ce membre. Patientez deux minutes avant de supprimer le compte.');
}
export function invitationFromActivity(action:unknown,at:unknown):MemberInvitation|undefined{
  if(typeof action!=='string'||typeof at!=='string')return;
  const status=action.replace('member.invitation_','');
  if(status!=='requested'&&status!=='failed'&&status!=='pending')return;
  return {status,at,message:messages[status]};
}
const eligibility='EXISTS(SELECT 1 FROM members WHERE email=? AND active=1 AND removed_at IS NULL) AND NOT EXISTS(SELECT 1 FROM member_purge_jobs WHERE email=?)';
async function eligible(env:Env,email:string){
  if(!await env.DB.prepare(`SELECT 1 WHERE ${eligibility}`).bind(email,email).first())throw new HttpError(409,'Ce membre est absent, suspendu ou en cours de suppression. Aucune invitation ne peut être envoyée.');
}
async function status(env:Env,actor:string,email:string,state:MemberInvitation['status']):Promise<MemberInvitation>{
  const at=new Date().toISOString();
  await env.DB.prepare('INSERT INTO activity(actor,action,target,detail,created_at) VALUES(?,?,?,?,?)').bind(actor,`member.invitation_${state}`,email,messages[state],at).run();
  return {status:state,at,message:messages[state]};
}
class InvitationProviderError extends Error {
  constructor(readonly uncertain:boolean,readonly code:string=''){super('Invitation provider request failed');}
}
async function provider(env:Env,action:'signUp'|'sendOobCode',body:object){
  let response:Response;
  try{response=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${action}?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`,{
    method:'POST',headers:{'Content-Type':'application/json','X-Firebase-Locale':'fr'},body:JSON.stringify(body),
    redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(12000),
  });}catch{throw new InvitationProviderError(true);}
  let data:unknown;
  try{data=await readJson(response,32*1024);}catch{throw new InvitationProviderError(true);}
  if(!response.ok){
    const error=z.object({error:z.object({message:z.string()})}).safeParse(data);
    const code=error.success?error.data.error.message.split(' : ')[0]:'';
    throw new InvitationProviderError(response.status>=500||response.status===408,code);
  }
  return data;
}

/** No passwords, provider tokens or action links are persisted or returned. */
export async function requestMemberInvitation(env:Env,member:SessionMember,email:string):Promise<MemberInvitation>{
  if(member.role!=='admin'||!member.active)throw new HttpError(403,'Gestion des invitations réservée à l’administrateur actif.');
  email=z.email().max(254).parse(email).toLowerCase();
  if(email.endsWith('@system.invalid'))throw new HttpError(400,'Cette adresse est réservée au système.');
  await eligible(env,email);
  const now=Date.now(),key=await memberInvitationLockKey(email),lease=now+120000;
  // The lease and eligibility check are one SQLite write. Account purges use
  // this same key in their transaction; uncertain provider writes retain it.
  const lock=await env.DB.prepare(`INSERT INTO login_limits(key,count,expires_at) SELECT ?,1,? WHERE ${eligibility} ON CONFLICT(key) DO UPDATE SET count=1,expires_at=excluded.expires_at WHERE login_limits.expires_at<=? AND ${eligibility} RETURNING key`)
    .bind(key,lease,email,email,now,email,email).first();
  if(!lock){await eligible(env,email);throw new HttpError(429,'Une invitation est déjà en cours. Patientez deux minutes avant de réessayer.',{'Retry-After':'120'});}
  let uncertain=false;
  try{
    const budgetKey=await digest(`member-invitation-admin:${member.email}:${Math.floor(now/600000)}`);
    const budget=await env.DB.prepare('INSERT INTO login_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(budgetKey,now+1200000).first<{count:number}>();
    if(!budget||budget.count>20)throw new HttpError(429,'Trop d’invitations. Patientez dix minutes avant de réessayer.',{'Retry-After':'600'});
    const cooldown=await env.DB.prepare('INSERT INTO login_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=1,expires_at=excluded.expires_at WHERE login_limits.expires_at<=? RETURNING key').bind(await digest(`member-invitation-cooldown:${email}`),now+60000,now).first();
    if(!cooldown)throw new HttpError(429,'Une invitation a été demandée récemment. Patientez une minute.',{'Retry-After':'60'});
    await status(env,member.email,email,'pending');
    try{
      if(env.AUTH_MODE!=='firebase'||!/^AIza[\w-]{30,50}$/.test(env.FIREBASE_API_KEY))throw new InvitationProviderError(false);
      await eligible(env,email);
      // Provision only a missing identity. EMAIL_EXISTS never changes an
      // existing user's password, verification, sessions or profile.
      const random=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
      try{
        const created=z.object({localId:z.string().min(1).max(128),email:z.email()}).safeParse(await provider(env,'signUp',{email,password:`Aa1!${random}`}));
        if(!created.success||created.data.email.toLowerCase()!==email)throw new InvitationProviderError(true);
      }catch(error){if(!(error instanceof InvitationProviderError&&error.code==='EMAIL_EXISTS'))throw error;}
      await eligible(env,email);
      const sent=z.object({email:z.email().optional()}).safeParse(await provider(env,'sendOobCode',{requestType:'PASSWORD_RESET',email,continueUrl:'https://srtb-graphics.pages.dev/login'}));
      if(!sent.success||(sent.data.email&&sent.data.email.toLowerCase()!==email))throw new InvitationProviderError(true);
      return await status(env,member.email,email,'requested');
    }catch(error){
      uncertain=error instanceof InvitationProviderError&&error.uncertain;
      return await status(env,member.email,email,'failed');
    }
  }finally{
    if(!uncertain)await env.DB.prepare('DELETE FROM login_limits WHERE key=? AND expires_at=?').bind(key,lease).run();
  }
}
