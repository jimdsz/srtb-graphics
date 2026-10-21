import {z} from 'zod';
import {connectorCall,connectorHealth,CONNECTOR_CONSOLE_URL,hasConnectorSession} from './connector-client';
import {bindConnectorMedia} from './local-media';
import type {LocalDescriptor} from './local-media';
import {assertBrowserMedia} from './media-import';
export type PreparationProgress={stage:string;progress?:number};
const statusSchema=z.object({id:z.uuid(),status:z.enum(['running','ready','error','cancelled']),stage:z.string().max(300),progress:z.number().min(0).max(100).optional(),error:z.string().max(2000).optional()});
function delay(signal:AbortSignal){return new Promise<void>((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(signal.reason);};const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},1000);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});}
export async function prepareConnectorFile(file:File|undefined,signal:AbortSignal,progress:(status:PreparationProgress)=>void):Promise<LocalDescriptor>{
  if(!hasConnectorSession())throw Error('Connectez ce poste à Graphics ci-dessous, puis relancez la préparation.');
  const health=await connectorHealth(signal);
  if(!health.capabilities?.includes('media-preparation-v1'))throw Error('La préparation demande le connecteur Windows 0.3 ou supérieur. Téléchargez sa mise à jour ci-dessous, puis reconnectez ce poste.');
  progress({stage:'Confirmez le fichier source dans la fenêtre du connecteur'});let id:string|undefined;
  try{
    const response=await connectorCall('preparation/pick',signal,{allowEngineDownload:true,...(file?{expected:{name:file.name,size:file.size,modified:file.lastModified}}:{})},125000);
    if(response.cancelled===true)throw new DOMException('Choix annulé.','AbortError');
    const selected=z.object({id:z.uuid()}).parse(response);id=selected.id;
    for(;;){
      signal.throwIfAborted();const status=statusSchema.parse(await connectorCall('preparation/'+id,signal));progress(status);
      if(status.status==='error')throw Error(status.error||'Préparation impossible. Le média actuel est conservé.');
      if(status.status==='cancelled')throw new DOMException('Préparation annulée.','AbortError');
      if(status.status==='ready')break;await delay(signal);
    }
    const lease=z.object({descriptor:z.object({url:z.string().regex(/^local-media:[a-f\d]{64}:\d+$/),name:z.string().max(200),mimeType:z.literal('video/mp4')}),mediaPath:z.string().regex(/^\/v1\/media\/[a-f\d]{64}$/)}).parse(await connectorCall('preparation/'+id+'/lease',signal,{}));
    const url=new URL(lease.mediaPath,CONNECTOR_CONSOLE_URL).href;progress({stage:'Vérification de la lecture sur ce navigateur'});
    await assertBrowserMedia({url,mimeType:'video/mp4'},signal);signal.throwIfAborted();return bindConnectorMedia(lease.descriptor,url);
  }catch(error){if(id)void connectorCall('preparation/'+id+'/cancel',undefined,{}).catch(()=>{});throw error;}
}
export async function restorePreparedMedia(reference:string,signal?:AbortSignal){
  if(!hasConnectorSession())return false;
  const health=await connectorHealth(signal);if(!health.capabilities?.includes('media-preparation-v1'))return false;
  const result=await connectorCall('preparation/restore',signal,{reference},10*60000);if(!result.lease)return false;
  const lease=z.object({descriptor:z.object({url:z.literal(reference),name:z.string().max(200),mimeType:z.literal('video/mp4')}),mediaPath:z.string().regex(/^\/v1\/media\/[a-f\d]{64}$/)}).parse(result.lease);
  const url=new URL(lease.mediaPath,CONNECTOR_CONSOLE_URL).href;await assertBrowserMedia({url,mimeType:'video/mp4'},signal);signal?.throwIfAborted();bindConnectorMedia(lease.descriptor,url);return true;
}
