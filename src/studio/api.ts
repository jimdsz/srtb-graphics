import type { MediaAsset, Member, MemberInvitation, PendingTransfer, Project, ProjectData, ProjectStatus, Revision } from './domain';
import {sessionState} from './session-state';
import {activeChannelId,CHANNEL_HEADER} from './channel-context';
import type {Channel,Programme,ProgrammeData,SearchResults} from './channel-model';
import {DERIVATIONS_ENABLED} from './derivation-feature';
import {CLIENT_CAPABILITIES_HEADER,DERIVATIONS_CAPABILITY} from './client-capabilities';

export class ApiError extends Error {
  constructor(message: string, public status: number, public retryAfterMs: number|null = null) { super(message); }
}
function retryAfter(response:Response) {
  const value=response.headers.get('Retry-After');if(value===null)return null;
  const seconds=Number(value);if(Number.isFinite(seconds)&&seconds>=0)return seconds*1000;
  const date=Date.parse(value);return Number.isFinite(date)?Math.max(0,date-Date.now()):null;
}
export async function request<T>(path: string, init: RequestInit = {}, context?:{channelId:string}): Promise<T> {
  const epoch=sessionState.snapshot().epoch;
  if(sessionState.snapshot().ended)throw new ApiError('Votre session doit être renouvelée. Reconnectez-vous.',401);
  if(path!=='/me'&&!sessionState.permitted(epoch))throw new ApiError('Vérification de session nécessaire. Votre brouillon reste en mémoire ; réessayez le contrôle de connexion avant de continuer.',503);
  const started=performance.now();
  const headers=new Headers(init.headers);
  const channel=context?.channelId??activeChannelId();if(path!=='/me')headers.set(CHANNEL_HEADER,channel);
  if(init.body&&typeof init.body==='string'&&!headers.has('Content-Type'))headers.set('Content-Type','application/json');
  // Capability follows this compiled client, never a cached user/session value.
  if(DERIVATIONS_ENABLED)headers.set(CLIENT_CAPABILITIES_HEADER,DERIVATIONS_CAPABILITY);
  else headers.delete(CLIENT_CAPABILITIES_HEADER);
  let response:Response;
  try{
    response = await fetch(path==='/me'?'/api/me':`/api/graphics${path}`, { ...init, credentials: 'same-origin', cache: 'no-store',
      headers });
  }catch{
    init.signal?.throwIfAborted();
    throw new ApiError('Connexion interrompue : action non confirmée. Vos saisies restent dans le formulaire. Vérifiez la connexion puis la version partagée avant de réessayer.',0);
  }
  if(response.status===401||(path==='/me'&&response.status===403))sessionState.end('expired',epoch);
  if (!response.headers.get('Content-Type')?.includes('application/json')) {
    if(response.ok)sessionState.end('expired',epoch);
    throw new ApiError(response.ok||response.status===401?'Votre session doit être renouvelée. Reconnectez-vous.':'Service momentanément indisponible : action non confirmée. Conservez vos saisies et réessayez après vérification de la connexion.', response.status === 200 ? 401 : response.status);
  }
  let data;
  try{data=await response.json();}catch{
    init.signal?.throwIfAborted();
    throw new ApiError('Réponse incomplète : action non confirmée. Conservez vos saisies et vérifiez la version partagée avant de réessayer.',502);
  }
  if (!response.ok) throw new ApiError(data.error || 'Action non confirmée. Réessayez.', response.status,retryAfter(response));
  if(!sessionState.current(epoch))throw new ApiError('La session a été fermée. Reconnectez-vous.',401);
  if(!context&&path!=='/me'&&activeChannelId()!==channel)throw new ApiError('La chaîne a changé. Cette réponse n’a pas été appliquée.',409);
  const lifetime=response.headers.get('X-SRTB-Session-Remaining-Ms');
  if(path==='/me'&&lifetime!==null)sessionState.lifetime(Math.max(0,Number(lifetime)-(performance.now()-started)),epoch);
  if(!sessionState.permitted(epoch))throw new ApiError('La durée restante de la session n’a pas pu être confirmée. Votre brouillon reste en mémoire ; réessayez le contrôle de connexion.',503);
  return data;
}
const post = <T>(path: string, data: unknown) => request<T>(path, {method:'POST',body:JSON.stringify(data)});
// A lost reply must not trap account administration in an endless spinner.
// Never retry a write automatically: the server may already have saved/sent it.
async function memberWrite<T>(path:string,data:unknown):Promise<T>{
  try{return await request<T>(path,{method:'POST',body:JSON.stringify(data),signal:AbortSignal.timeout(45000)});}
  catch(error){if(error instanceof DOMException&&error.name==='TimeoutError')throw new ApiError('Réponse non reçue. L’accès ou l’envoi a peut-être déjà été enregistré. Actualisez la liste des membres avant de réessayer.',0);throw error;}
}
// Destructive work is durable on the server. A lost connection must release the
// dialog so the administrator can inspect/retry, never leave an endless spinner.
async function deletionRequest<T>(path:string,data?:unknown):Promise<T>{
  try{return await request<T>(path,{signal:AbortSignal.timeout(90000),...(data===undefined?{}:{method:'POST',body:JSON.stringify(data)})});}
  catch(error){if(error instanceof DOMException&&error.name==='TimeoutError')throw new ApiError('Le serveur n’a pas répondu à temps. La suppression n’est pas confirmée. Fermez ce bilan puis reprenez la suppression pour vérifier son état.',0);throw error;}
}
export interface ProjectPage { projects: Project[]; next: { before: string; afterId: string } | null }
export interface ProgrammePage { programmes: Programme[]; next: string|null }
export interface Comment { id: string; revision: number; author: string; body: string; created_at: string }
export const api = {
  channels:()=>request<Channel[]>('/channels'),
  createChannel:(data:{name:string;accent:string;timezone:string;logo?:string})=>post<Channel>('/channels',data),
  updateChannel:(id:string,revision:number,data:{name:string;logo:string;accent:string;timezone:string})=>request<Channel>(`/channels/${id}`,{method:'PUT',body:JSON.stringify({revision,data})}),
  channelMembers:(id:string)=>request<Member[]>(`/channels/${id}/members`),
  setChannelMember:(id:string,email:string,allowed:boolean)=>post(`/channels/${id}/members`,{email,allowed}),
  catalogue:()=>request<import('./domain').BroadcastTemplate[]>('/templates'),
  programmes:()=>request<Programme[]>('/programmes'),
  programmePage:(next:string|null=null,signal?:AbortSignal)=>request<ProgrammePage>(`/programmes?page=1${next?`&after=${encodeURIComponent(next)}`:''}`,{signal}),
  programme:(id:string,signal?:AbortSignal)=>request<Programme>(`/programmes/${encodeURIComponent(id)}`,{signal}),
  saveProgramme:(id:string|null,revision:number,data:ProgrammeData)=>request<Programme>(id?`/programmes/${id}`:'/programmes',{method:id?'PUT':'POST',body:JSON.stringify({revision,data})}),
  search:(q:string,signal?:AbortSignal)=>request<SearchResults>(`/search?q=${encodeURIComponent(q)}`,{signal}),
  me: (signal?:AbortSignal) => request<Member>('/me',{signal}),
  projects: (archived = false, next: ProjectPage['next'] = null,scope:'mine'|'team'|'accessible'='accessible',status?:Project['status']) => request<ProjectPage>(`/projects?archived=${archived ? 1 : 0}&scope=${scope}${status?`&status=${status}`:''}${next ? `&${new URLSearchParams(next)}` : ''}`),
  project: (id: string, signal?:AbortSignal) => request<Project>(`/projects/${id}`,{signal}),
  create: (templateId: string, title: string, data?: ProjectData) => post<Project>('/projects',{templateId,title,data}),
  save: (project: Project, title: string, data: ProjectData) => request<Project>(`/projects/${project.id}`,{method:'PUT',body:JSON.stringify({revision:project.revision,title,data})}),
  status: (project: Project, status: ProjectStatus) => post<Project>(`/projects/${project.id}/status`,{revision:project.revision,status}),
  archive: (project: Project, archived: boolean) => post<Project>(`/projects/${project.id}/archive`,{revision:project.revision,archived}),
  sharing: (project:Project,visibility:'private'|'team')=>post<Project>(`/projects/${project.id}/sharing`,{revision:project.revision,visibility}),
  revisions: (id: string) => request<Revision[]>(`/projects/${id}/revisions`),
  comments: (id: string) => request<Comment[]>(`/projects/${id}/comments`),
  comment: (project: Project, body: string) => post(`/projects/${project.id}/comments`,{revision:project.revision,body}),
  media: (signal?:AbortSignal) => request<MediaAsset[]>('/media',{signal}),
  mediaAsset:(id:string,signal?:AbortSignal)=>request<MediaAsset>(`/media/${encodeURIComponent(id)}`,{signal}),
  transfers: () => request<PendingTransfer[]>('/media/transfers'),
  finishTransfer: (id: string) => post(`/media/${id}/complete`, {}),
  cancelTransfer: (id: string) => post(`/media/${id}/cancel`, {}),
  members: (includeRemoved=false) => request<Member[]>('/members'+(includeRemoved?'?includeRemoved=1':'')),
  member: (member: Member) => memberWrite<{ok:boolean;notice:string;invitation?:MemberInvitation}>('/members',{email:member.email,name:member.name,role:member.role,active:!!member.active}),
  inviteMember: (email:string) => memberWrite<{ok:boolean;notice:string;invitation:MemberInvitation}>('/members/invitation',{email}),
  deleteMember: (email: string) => request<{ok:boolean;notice:string}>('/members',{method:'DELETE',body:JSON.stringify({email})}),
  deletionStatus:()=>deletionRequest<{job:import('./member-deletion').MemberDeletionJob|null;configured:boolean}>('/members/deletion'),
  deletionPreview:(email:string)=>deletionRequest<import('./member-deletion').MemberDeletionPreview>('/members/deletion/preview',{email}),
  deletionConfirm:(token:string,email:string)=>deletionRequest<{job:import('./member-deletion').MemberDeletionJob}>('/members/deletion/confirm',{token,email,acknowledge:true}),
  deletionContinue:(id:string)=>deletionRequest<{job:import('./member-deletion').MemberDeletionJob|null;notice?:string}>('/members/deletion/continue',{id}),
  activity: () => request<{id:number;actor:string;action:string;target:string;detail:string;created_at:string}[]>('/activity'),
};
function waitForRetry(milliseconds:number,signal:AbortSignal) {
  return new Promise<void>((resolve,reject)=>{
    signal.throwIfAborted();
    const timer=setTimeout(done,milliseconds);
    function done(){signal.removeEventListener('abort',abort);resolve();}
    function abort(){clearTimeout(timer);signal.removeEventListener('abort',abort);reject(signal.reason??new DOMException('Transfert annulé.','AbortError'));}
    signal.addEventListener('abort',abort,{once:true});
  });
}
async function uploadPart(path:string,body:Blob,signal:AbortSignal,status:(message:string)=>void) {
  const started=Date.now();let attempt=0;
  while(true){
    try{return await request(path,{method:'PUT',body,signal});}
    catch(error){
      if(!(error instanceof ApiError)||error.status!==503||error.retryAfterMs===null||Date.now()-started>=120_000)throw error;
      const delay=Math.min(10_000,error.retryAfterMs*Math.min(4,2**attempt))+Math.floor(Math.random()*500);attempt++;
      status('Forte activité : votre transfert est conservé et reprendra automatiquement…');
      await waitForRetry(delay,signal);
    }
  }
}
export async function shareFile(file: File, signal: AbortSignal, progress: (value:number)=>void, status:(message:string)=>void=()=>undefined): Promise<void> {
  const channel=activeChannelId();
  const sameChannel=()=>{if(activeChannelId()!==channel)throw new ApiError('La chaîne a changé. Retrouvez ce transfert dans sa chaîne d’origine avant de le reprendre.',409);};
  const mimeType = file.type === 'audio/wave' ? 'audio/wav' : file.type;
  status('Préparation du transfert privé…');
  const transfer = await post<{id:string;partSize:number}>('/media',{name:file.name,mimeType,bytes:file.size,consent:true});
  try {
    for (let offset=0,part=1;offset<file.size;offset+=transfer.partSize,part++) {
      signal.throwIfAborted();
      sameChannel();
      status(`Envoi sécurisé · fragment ${part} sur ${Math.ceil(file.size/transfer.partSize)}`);
      await uploadPart(`/media/${transfer.id}/part/${part}`,file.slice(offset,offset+transfer.partSize),signal,status);
      progress(Math.min(99, Math.floor(Math.min(file.size,offset+transfer.partSize)/file.size*100)));
    }
    signal.throwIfAborted();
    sameChannel();
    status('Contrôle et finalisation du média…');
    await post(`/media/${transfer.id}/complete`,{});
    progress(100);
  } catch (error) {
    // Keep finalisation recoverable; do not delete a file whose final response was lost.
    if (signal.aborted&&activeChannelId()===channel) await post(`/media/${transfer.id}/cancel`,{}).catch(()=>undefined);
    throw error;
  }
}
export function downloadJson(name: string, data: unknown) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
