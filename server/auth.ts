import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import type { Member } from '../src/studio/domain';
import { HttpError } from './http';
import {authenticateSession} from './firebase-auth';
import {effectiveRoleSql} from './tool-access';

const identity = z.object({ email: z.email().max(254), sub: z.string().min(1), exp: z.number() });
export async function authenticate(request: Request, env: Env): Promise<Member> {
  if(env.AUTH_MODE==='firebase')return authenticateSession(request,env);
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_TEAM_DOMAIN) ||
      !/^[a-f\d]{64}$/.test(env.ACCESS_AUDIENCE))
    throw new HttpError(503, 'La connexion sécurisée n’est pas encore configurée. Aucun contenu privé n’est accessible.');
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) throw new HttpError(401, 'Connexion nécessaire. Ouvrez SRTB Graphics puis reconnectez-vous.');
  let email: string;
  try {
    const keys = createRemoteJWKSet(new URL('/cdn-cgi/access/certs', env.ACCESS_TEAM_DOMAIN), { timeoutDuration: 5000 });
    const verified = await jwtVerify(token, keys, {
      issuer: env.ACCESS_TEAM_DOMAIN, audience: env.ACCESS_AUDIENCE, algorithms: ['RS256'],
      requiredClaims: ['exp', 'iat', 'sub', 'email'], clockTolerance: 5,
    });
    email = identity.parse(verified.payload).email.toLowerCase();
  } catch { throw new HttpError(401, 'Session expirée ou invalide. Reconnectez-vous.'); }
  const member = await env.DB.prepare(`SELECT email,name,${effectiveRoleSql()},active FROM members WHERE email=? AND active=1`).bind(email).first<Member>();
  if (!member) throw new HttpError(403, 'Cette adresse n’est pas invitée ou son accès a été suspendu. Contactez l’administrateur.');
  return member;
}
