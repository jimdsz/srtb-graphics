import {ApiError} from '../api';
import {sessionState} from '../session-state';
import type {MediaAsset} from '../domain';
import type {CommercialData} from './model';

export interface CommercialProject {id:string;title:string;template_id:string;revision:number;data:CommercialData;created_by:string;updated_by:string;created_at:string;updated_at:string;archived:number}
export interface CommercialRevision {revision:number;title:string;data:CommercialData;actor:string;created_at:string}
export type CommercialCursor={before:string;afterId:string}|null;
export async function commercialRequest<T>(path:string,init:RequestInit={}):Promise<T>{
  const epoch=sessionState.snapshot().epoch;
  if(!sessionState.permitted(epoch))throw new ApiError('Vérifiez votre connexion avant de continuer.',401);
  const headers=new Headers(init.headers);
  if(typeof init.body==='string')headers.set('Content-Type','application/json');
  let response:Response;
  try{response=await fetch(`/api/commercial${path}`,{...init,headers,credentials:'same-origin',cache:'no-store'});}
  catch(error){init.signal?.throwIfAborted();throw new ApiError('Connexion interrompue. Conservez votre saisie et réessayez.',0);}
  if(response.status===401)sessionState.end('expired',epoch);
  if(!response.headers.get('Content-Type')?.includes('application/json'))throw new ApiError('Réponse du service indisponible. Votre saisie est conservée.',response.status);
  const body=await response.json();
  if(!response.ok)throw new ApiError(body.error||'Action non confirmée.',response.status);
  if(!sessionState.permitted(epoch))throw new ApiError('La session a changé. Reconnectez-vous.',401);
  return body as T;
}
const post=<T>(path:string,data:unknown,signal?:AbortSignal)=>commercialRequest<T>(path,{method:'POST',body:JSON.stringify(data),signal});
export const commercialApi={
  projects:(archived=false,next:CommercialCursor=null)=>commercialRequest<{projects:CommercialProject[];next:CommercialCursor}>(`/projects?archived=${archived?1:0}${next?`&${new URLSearchParams(next)}`:''}`),
  project:(id:string)=>commercialRequest<CommercialProject>(`/projects/${encodeURIComponent(id)}`),
  save:(project:CommercialProject|null,title:string,data:CommercialData)=>project?commercialRequest<CommercialProject>(`/projects/${project.id}`,{method:'PUT',body:JSON.stringify({title,data,revision:project.revision})}):post<CommercialProject>('/projects',{title,data}),
  archive:(project:CommercialProject,archived:boolean)=>post<CommercialProject>(`/projects/${project.id}/archive`,{revision:project.revision,archived}),
  remove:(project:CommercialProject)=>commercialRequest<{deleted:true}>(`/projects/${encodeURIComponent(project.id)}`,{method:'DELETE',body:JSON.stringify({revision:project.revision})}),
  revisions:(id:string)=>commercialRequest<CommercialRevision[]>(`/projects/${id}/revisions`),
  media:()=>commercialRequest<MediaAsset[]>('/media'),
};
export async function shareCommercialFile(file:File,mimeType:string,signal:AbortSignal,progress:(p:number)=>void){
  const transfer=await post<{id:string;partSize:number}>('/media',{name:file.name,mimeType,bytes:file.size,consent:true},signal);
  try{
    for(let offset=0,part=1;offset<file.size;offset+=transfer.partSize,part++){
      signal.throwIfAborted();
      await commercialRequest(`/media/${transfer.id}/part/${part}`,{method:'PUT',body:file.slice(offset,offset+transfer.partSize),headers:{'Content-Type':'application/octet-stream'},signal});
      progress(Math.min(99,Math.round((offset+transfer.partSize)/file.size*100)));
    }
    await post(`/media/${transfer.id}/complete`,{},signal);progress(100);
    return {url:`/api/commercial/media/${transfer.id}/content`,name:file.name};
  }catch(error){if(signal.aborted)await post(`/media/${transfer.id}/cancel`,{}).catch(()=>undefined);throw error;}
}
