import { z } from 'zod';
import type { Member } from '../src/studio/domain';
import { HttpError,json,readJson,checkOrigin } from './http';
import type {SessionMember} from './firebase-auth';
import {effectiveRoleSql} from './tool-access';
import {invitationFromActivity,requestMemberInvitation,type MemberInvitation} from './member-invitation';
export async function memberRoutes(request: Request, env: Env, member: SessionMember): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path === '/api/me' && request.method === 'GET') {
    const {sessionExpiresAt,...identity}=member,response=json(identity);
    if(sessionExpiresAt!==undefined)response.headers.set('X-SRTB-Session-Remaining-Ms',String(Math.max(0,sessionExpiresAt-Date.now())));
    return response;
  }
  if (path === '/api/activity' && request.method === 'GET') {
    if (member.role !== 'admin') throw new HttpError(403,'Journal réservé à l’administrateur.');
    return json((await env.DB.prepare('SELECT * FROM activity ORDER BY id DESC LIMIT 200').all()).results);
  }
  if (path !== '/api/members'&&path !== '/api/members/invitation') return null;
  if (member.role !== 'admin') throw new HttpError(403,'Gestion des membres réservée à l’administrateur.');
  checkOrigin(request);
  if(path==='/api/members/invitation'){
    if(request.method!=='POST')throw new HttpError(405,'Action non disponible.');
    const {email}=z.object({email:z.email().max(254).transform(value=>value.toLowerCase())}).strict().parse(await readJson(request));
    const invitation=await requestMemberInvitation(env,member,email);
    return json({ok:true,invitation,notice:invitation.message});
  }
  if (request.method === 'GET') {
    const result=await env.DB.prepare(`SELECT m.email,m.name,${effectiveRoleSql('m')},m.active,m.created_at,m.updated_at,m.firebase_uid IS NOT NULL AS has_connected,a.action AS invitation_action,a.created_at AS invitation_at FROM members m LEFT JOIN activity a ON a.id=(SELECT MAX(i.id) FROM activity i WHERE i.target=m.email AND i.action IN ('member.invitation_pending','member.invitation_requested','member.invitation_failed')) WHERE m.email NOT LIKE '%@system.invalid' AND (m.removed_at IS NULL OR ?=1) ORDER BY m.name LIMIT 500`).bind(new URL(request.url).searchParams.get('includeRemoved')==='1'?1:0).all<Record<string,unknown>>();
    return json(result.results.map(({invitation_action,invitation_at,has_connected,...row})=>({...row,has_connected:Boolean(has_connected),invitation:invitationFromActivity(invitation_action,invitation_at)})));
  }
  if (request.method === 'DELETE') {
    const input = z.object({email:z.email().max(254).transform(value=>value.toLowerCase())}).strict().parse(await readJson(request));
    if (input.email === member.email.toLowerCase()) throw new HttpError(409,'Vous ne pouvez pas supprimer votre propre compte administrateur.');
    const target = await env.DB.prepare('SELECT email,name,role,active FROM members WHERE email=? AND removed_at IS NULL').bind(input.email).first<{email:string;name:string;role:Member['role'];active:number}>();
    if (!target) throw new HttpError(404,'Ce membre n’existe plus ou a déjà été supprimé.');
    if (target.role === 'admin' && target.active) {
      const admins = await env.DB.prepare("SELECT COUNT(*) AS count FROM members WHERE role='admin' AND active=1").first<{count:number}>();
      if ((admins?.count ?? 0) <= 1) throw new HttpError(409,'Le dernier administrateur actif doit être conservé.');
    }
    try {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM app_sessions WHERE email=?').bind(target.email),
        env.DB.prepare("UPDATE members SET active=0,removed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_by=? WHERE email=? AND removed_at IS NULL").bind(member.email,target.email),
        env.DB.prepare("INSERT INTO activity(actor,action,target,detail) VALUES(?,?,?,?)").bind(member.email,'member.access_removed',target.email,`${target.name} · ${target.role} · identité et historique conservés`),
      ]);
    } catch (error) {
      const detail = String(error).toLowerCase();
      if (detail.includes('last_admin')) throw new HttpError(409,'Le dernier administrateur actif doit être conservé.');
      throw error;
    }
    return json({ok:true,notice:`L’accès Graphics de ${target.name} est supprimé et ses sessions sont révoquées. Ses projets et son identifiant de connexion sont conservés. Vous pouvez réautoriser la même adresse ; le membre pourra se connecter ou choisir un nouveau mot de passe.`});
  }
  if (request.method === 'POST') {
    const input = z.object({email:z.email().max(254).transform(v=>v.toLowerCase()),name:z.string().trim().min(1).max(100),role:z.enum(['admin','designer','broadcaster','commercial']),active:z.boolean()}).strict().parse(await readJson(request));
    if(input.email.endsWith('@system.invalid'))throw new HttpError(400,'Cette adresse est réservée aux références anonymes du système.');
    if(await env.DB.prepare('SELECT id FROM member_purge_jobs WHERE email=?').bind(input.email).first())throw new HttpError(409,'La suppression de ce compte reste à terminer avant de recréer un accès.');
    if (input.email === member.email && (!input.active || input.role !== 'admin')) throw new HttpError(409,'Vous ne pouvez pas retirer votre propre accès administrateur.');
    const existing=await env.DB.prepare('SELECT removed_at,firebase_uid,active FROM members WHERE email=?').bind(input.email).first<{removed_at:string|null;firebase_uid:string|null;active:number}>();
    try {
      // Suspension revokes existing cookies permanently. Keep this atomic with
      // the member update so reactivation cannot restore a compromised session.
      await env.DB.batch([
        env.DB.prepare("INSERT INTO members(email,name,role,active,updated_by,tool_scope) VALUES(?,?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET name=excluded.name,role=excluded.role,tool_scope=excluded.tool_scope,active=excluded.active,removed_at=NULL,updated_by=excluded.updated_by,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')")
          .bind(input.email,input.name,input.role==='commercial'?'designer':input.role,input.active?1:0,member.email,input.role==='commercial'?'commercial':'graphics'),
        env.DB.prepare('DELETE FROM app_sessions WHERE email=? AND EXISTS(SELECT 1 FROM members WHERE email=? AND active=0)')
          .bind(input.email,input.email),
      ]);
    } catch (error) {
      if (String(error).includes('last_admin')) throw new HttpError(409,'Le dernier administrateur actif doit être conservé.');
      throw error;
    }
    let invitation:MemberInvitation|undefined;
    if(input.active&&(!existing||existing.removed_at||!existing.active)){
      try{invitation=await requestMemberInvitation(env,member,input.email);}
      catch(error){invitation={status:'failed',at:new Date().toISOString(),message:error instanceof HttpError?error.message:'L’accès est enregistré, mais l’envoi de l’invitation n’est pas confirmé. Réessayez.'};}
    }
    const saved=existing?.firebase_uid?'Accès enregistré. Ce membre conserve son identifiant de connexion.':'Accès enregistré.';
    return json({ok:true,notice:invitation?`${saved} ${invitation.message}`:saved,invitation});
  }
  throw new HttpError(405,'Action non disponible.');
}
