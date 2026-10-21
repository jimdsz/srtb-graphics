import type {Member} from '../src/studio/domain';
import {HttpError,readJson} from './http';
import {assertGraphicsAccess} from './tool-access';
export const requestChannel=(request:Request)=>request.headers.get('X-SRTB-Channel')||'benin-tv';
export async function authorizeChannel(db:D1Database,member:Member,id:string){
  assertGraphicsAccess(member);
  if(member.active!==1)throw new HttpError(403,'Compte inactif.');
  if(!/^[a-z0-9-]{1,64}$/.test(id))throw new HttpError(404,'Chaîne indisponible.');
  const row=await db.prepare('SELECT id FROM channels c WHERE c.id=? AND c.archived=0 AND (?=1 OR EXISTS(SELECT 1 FROM channel_members cm WHERE cm.channel_id=c.id AND cm.email=?))').bind(id,Number(member.role==='admin'),member.email).first();
  if(!row)throw new HttpError(404,'Chaîne indisponible ou non autorisée.');
  return id;
}
/** Enforce scope before any resource handler, including derived project routes. */
export async function guardChannelRequest(request:Request,env:Env,member:Member){
  const path=new URL(request.url).pathname;
  // Native image/audio/video requests do not carry our workspace header. Their
  // actual resource determines the channel; membership is still mandatory.
  const content=path.match(/^\/api\/media\/([a-f0-9-]{36})\/content$/);
  if(content&&['GET','HEAD'].includes(request.method)){
    const media=await env.DB.prepare("SELECT channel_id FROM media WHERE id=? AND tool_scope='graphics'").bind(content[1]).first<{channel_id:string}>();
    if(!media)throw new HttpError(404,'Média introuvable.');
    return authorizeChannel(env.DB,member,media.channel_id);
  }
  const channel=await authorizeChannel(env.DB,member,requestChannel(request));
  const resources:Record<string,string>={projects:'projects',media:'media','preparation-profiles':'preparation_profiles',planner:'planner_documents',programmes:'programmes'};
  const match=path.match(/^\/api\/([^/]+)\/([a-f0-9-]{36})(?:\/|$)/);
  if(match&&resources[match[1]]){
    const row=await env.DB.prepare(`SELECT channel_id FROM ${resources[match[1]]} WHERE id=?`).bind(match[2]).first<{channel_id:string}>();
    if(row&&row.channel_id!==channel)throw new HttpError(404,'Élément introuvable dans cette chaîne.');
  }
  // JSON writes may reference private media, voices and directories by ID. Read
  // a bounded clone without changing the body consumed by the actual handler.
  if(request.body&&!['GET','HEAD'].includes(request.method)&&request.headers.get('Content-Type')?.includes('application/json')){
    const body=await readJson(request.clone(),1024*1024),refs=new Map<string,Set<string>>();
    const add=(table:string,id:string)=>{if(!refs.has(table))refs.set(table,new Set());refs.get(table)!.add(id);};
    function visit(value:unknown,key=''){
      if(typeof value==='string'){
        if(channel!=='benin-tv'&&value.startsWith('/library/'))throw new HttpError(422,'Les ressources Bénin TV ne sont pas disponibles dans cette chaîne.');
        const media=value.match(/^\/api\/graphics\/media\/([a-f0-9-]{36})\/content$/);if(media)add('media',media[1]);
        if(/^[a-f0-9-]{36}$/.test(value)){if(['profileId','voiceProfileId'].includes(key))add('preparation_profiles',value);if(['directoryId','directoryIds'].includes(key))add('planner_documents',value);if(key==='programmeId')add('programmes',value);}
      }else if(Array.isArray(value)){for(const item of value)visit(item,key);}else if(value&&typeof value==='object'){for(const [name,item]of Object.entries(value))visit(item,name);}
    }
    visit(body);
    for(const [table,ids]of refs){const rows=await env.DB.prepare(`SELECT id,channel_id${table==='media'?',tool_scope':''} FROM ${table} WHERE id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify([...ids])).all<{id:string;channel_id:string;tool_scope?:string}>();if(rows.results.some(row=>row.channel_id!==channel||row.tool_scope&&row.tool_scope!=='graphics'))throw new HttpError(422,'Une ressource appartient à un autre espace. Choisissez une ressource autorisée.');}
  }
  return channel;
}
