import {canApprove} from './domain';
import type {Member,Role} from './domain';

export interface TeamTask {key:string;owner:string;ownerName:string;revision:number;state:string}
export type TaskFilter='all'|'mine'|'free';
export const taskStateLabels:Record<string,string>={assigned:'À préparer',draft:'En cours',submitted:'À valider',approved:'Validé',rejected:'À corriger',archived:'Archivé'};
export function defaultTaskFilter(role:Role,mine:number):TaskFilter{return canApprove(role)?'all':mine>0?'mine':'free';}
/** Display permissions only. The assignment endpoint remains authoritative. */
export function canChangeTaskOwner(member:Member,task?:TeamTask){return (!task||task.state==='assigned')&&(canApprove(member.role)||!task||task.owner===member.email);}
