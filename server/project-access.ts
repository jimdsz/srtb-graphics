import {canApprove} from '../src/studio/domain';
import type {Member} from '../src/studio/domain';
import {HttpError} from './http';

export function assertProjectAccess(member:Member,project:{created_by:string;visibility?:string}){
  if(member.active!==1||(!canApprove(member.role)&&project.created_by.toLowerCase()!==member.email.toLowerCase()&&project.visibility!=='team'))throw new HttpError(404,'Projet introuvable ou non partagé avec vous.');
}
/** Bound parameters only; reused by lists and direct access, never a UI filter. */
export function projectAccessSql(member:Member,alias='projects'){
  return {sql:`(${alias}.created_by=? COLLATE NOCASE OR ${alias}.visibility='team' OR ?=1)`,values:[member.email,Number(member.active===1&&canApprove(member.role))]};
}
