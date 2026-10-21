import type {Member} from '../src/studio/domain';
import {HttpError} from './http';

/** Both authentication providers expose the same effective application role. */
export function effectiveRoleSql(alias='') {
  const prefix=alias?`${alias}.`:'';
  return `CASE WHEN ${prefix}tool_scope='commercial' THEN 'commercial' ELSE ${prefix}role END AS role`;
}
export function assertCommercialAccess(member:Member) {
  if(member.active!==1||!['admin','commercial'].includes(member.role))throw new HttpError(403,'Cet outil est réservé au service commercial et à l’administration.');
}
export function assertGraphicsAccess(member:Member) {
  if(member.active!==1||member.role==='commercial')throw new HttpError(403,'Votre compte commercial donne accès à Annonces. L’espace Graphics est réservé à son équipe.');
}
