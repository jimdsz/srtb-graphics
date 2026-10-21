import {z} from 'zod';
import {indexedMediaSchema} from './day-planner-model';
import {profileAssetSchema} from './preparation-profile-model';
import connectorRelease from '../../connector/windows/release.json';
export const CONNECTOR_CONSOLE_URL='http://127.0.0.1:43871/';
// Windows is explicitly an unsigned internal pilot, not a universally qualified
// release. The build verifies its exact digest; downloads require a SRTB session.
export const connectorDownloads:{windows:{url:string|null;label:string;sha256?:string};mac:{url:string|null;label:string;sha256?:string}}={windows:{url:'/downloads/'+connectorRelease.file,label:'Télécharger pour Windows · version interne',sha256:connectorRelease.sha256},mac:{url:null,label:'Mac'}};
export const connectorReadyForUsers=()=>Object.values(connectorDownloads).some(item=>!!item.url);
const rootSchema=z.object({id:z.uuid(),name:z.string().max(120),state:z.enum(['idle','scanning','ready','error','cancelled']),files:z.number().int().nonnegative(),found:z.number().int().nonnegative().optional(),visited:z.number().int().nonnegative().optional(),resumeAvailable:z.boolean().optional(),partial:z.boolean(),updatedAt:z.string().nullable(),message:z.string().optional()});
export type ConnectorRoot=z.infer<typeof rootSchema>;
const resultSchema=z.object({results:z.array(z.object({id:z.string(),matches:z.array(z.object({rootId:z.uuid(),rootName:z.string(),file:indexedMediaSchema,score:z.number()})).max(20)})).max(600),roots:z.array(rootSchema).max(32)});
let access:{token:string;expires:number}|undefined;
export const hasConnectorSession=()=>!!access&&access.expires>Date.now();
async function call(route:string,signal?:AbortSignal,data?:unknown,timeout=15000){
 const c=new AbortController(),abort=()=>c.abort(signal?.reason);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();const timer=setTimeout(()=>c.abort(new Error('Le connecteur ne répond pas. Ouvrez-le sur ce poste ou continuez sans connecteur.')),timeout);
 try{
  const response=await fetch(CONNECTOR_CONSOLE_URL+'v1/'+route,{method:data===undefined?'GET':'POST',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:c.signal,headers:{...(hasConnectorSession()?{Authorization:`Bearer ${access!.token}`}:{ }),...(data===undefined?{}:{'Content-Type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})});
  const result=await response.json();if(!response.ok)throw Error(typeof result.error==='string'?result.error:'Connexion au connecteur refusée.');return result;
 }catch(e){signal?.throwIfAborted();if(c.signal.aborted)throw c.signal.reason;if(e instanceof TypeError)throw Error('Connexion locale indisponible dans ce navigateur. Vérifiez que le connecteur est ouvert et autorisez la connexion locale si le navigateur le demande. Le choix manuel reste disponible.');throw e;
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
export const connectorCall=call;
export async function connectorHealth(signal?:AbortSignal){return z.object({protocol:z.literal(1),version:z.string(),capabilities:z.array(z.string()).optional()}).parse(await call('health',signal));}
export async function connectorRoots(signal?:AbortSignal):Promise<ConnectorRoot[]>{return z.object({roots:z.array(rootSchema).max(32)}).parse(await call('roots',signal)).roots;}
export async function pairConnector(code:string,signal?:AbortSignal){const result=z.object({token:z.string().regex(/^[a-f\d]{64}$/),expires:z.number()}).parse(await call('pair',signal,{code}));signal?.throwIfAborted();access=result;}
export function disconnectConnector(){const previous=access;void (previous?call('disconnect',undefined,{}).catch(()=>{}):Promise.resolve());access=undefined;window.dispatchEvent(new Event('srtb-connector-disconnect'));}
export async function searchConnector(queries:{id:string;title:string;subtitle?:string;airDate?:string}[],signal?:AbortSignal){
 const health=await connectorHealth(signal);if(!health.capabilities?.includes('episode-date-ranking'))throw Error('Mettez à jour le connecteur Windows pour rechercher les épisodes et dates dans tous vos dossiers. Vos emplacements autorisés seront conservés.');
 // Keep each JSON body below the local service's 256 KiB limit, even for 600
 // long programme labels. Do not drop any programmes from a day/week silently.
 const results:z.infer<typeof resultSchema>['results']=[];let roots:ConnectorRoot[]=[];
 for(let offset=0;offset<queries.length;offset+=150){signal?.throwIfAborted();const batch=resultSchema.parse(await call('search',signal,{queries:queries.slice(offset,offset+150)},120000));results.push(...batch.results);roots=batch.roots;}
 return {results,roots};
}
export async function scanConnector(id:string,stop=false,signal?:AbortSignal){z.uuid().parse(id);await call(`roots/${id}/${stop?'stop':'scan'}`,signal,{});}
export async function leaseConnector(rootId:string,file:z.infer<typeof indexedMediaSchema>,signal?:AbortSignal){
 const result=z.object({descriptor:profileAssetSchema,mediaPath:z.string().regex(/^\/v1\/media\/[a-f\d]{64}$/),expires:z.number()}).parse(await call('lease',signal,{rootId:z.uuid().parse(rootId),file:indexedMediaSchema.parse(file)},30*60000));
 return {...result,url:new URL(result.mediaPath,CONNECTOR_CONSOLE_URL).href};
}
if(typeof window!=='undefined')window.addEventListener('srtb-local-media-clear',disconnectConnector);
