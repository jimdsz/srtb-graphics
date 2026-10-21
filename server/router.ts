import { ZodError } from 'zod';
import type { Member } from '../src/studio/domain';
import { ParameterError } from '../src/studio/domain';
import { authenticate } from './auth';
import { checkOrigin,HttpError,json,secureHeaders } from './http';
import { projectRoutes } from './projects';
import { memberRoutes } from './members';
import { mediaRoutes,objectResponse } from './media';
import {firebaseRoutes,isPublicAppPath} from './firebase-auth';
import {mediaStore} from './storage';
import {preparationProfileRoutes} from './preparation-profiles';
import {dayPlannerRoutes} from './day-planner';
import {previewAssetResponse} from './preview-assets';
import {channelRoutes} from './channels';
import {authorizeChannel,guardChannelRequest} from './channel-access';
import {plannerTeamRoutes} from './planner-team';
import {habitRoutes} from './habits';
import {productionOverviewRoutes} from './production-overview';
import {memberDeletionRoutes,purgeBusy} from './member-deletion';
import {commercialRoutes} from './commercial';
import {assertCommercialAccess,assertGraphicsAccess} from './tool-access';

const largeAssets=new Map([
  ['/library/v1.7.0/BTV_BA_1P/lib/media/programme.mp4','video/mp4'],
  ['/library/v1.7.0/BTV_BA_1P/sourceassets/VOIX OFF BA.wav','audio/wav'],
  ['/library/v1.7.0/BTV_BA_TDS/lib/audio/VOIX OFF BA.wav','audio/wav'],
]);
export async function api(request:Request,env:Env,member:Member):Promise<Response|null>{
  checkOrigin(request);
  const url=new URL(request.url);
  if(url.pathname.startsWith('/api/commercial/')){
    assertCommercialAccess(member);
    url.pathname=url.pathname.replace('/api/commercial/','/api/');
    return commercialRoutes(new Request(url,request),env,member);
  }
  if(url.pathname!=='/api/me'){
    if(!url.pathname.startsWith('/api/graphics/'))return null;
    assertGraphicsAccess(member);
    url.pathname=url.pathname.replace('/api/graphics/','/api/');
    request=new Request(url,request);
  }
  const path=new URL(request.url).pathname;
  const deletion=await memberDeletionRoutes(request,env,member);if(deletion)return deletion;
  // Account administration and channel discovery are independent of the active workspace.
  if(path!=='/api/me'&&!['/api/members','/api/members/invitation','/api/activity','/api/channels'].includes(path)&&!path.startsWith('/api/channels/'))await guardChannelRequest(request,env,member);
  const channels=await channelRoutes(request,env,member);if(channels)return channels;
  if(typeof __SRTB_DERIVATIONS__!=='undefined'&&__SRTB_DERIVATIONS__){
    if(/^\/api\/planner\/[a-f0-9-]{36}\/production-links$/.test(path)){
      const {productionLinksRoutes}=await import('./production-links');
      const dossier=await productionLinksRoutes(request,env,member);if(dossier)return dossier;
    }
    const {projectDerivationRoutes}=await import('./project-derivations');
    const result=await projectDerivationRoutes(request,env,member);if(result)return result;
  }
  return (await memberRoutes(request,env,member)) ??
    (await productionOverviewRoutes(request,env,member)) ??
    (await habitRoutes(request,env,member)) ??
    (await plannerTeamRoutes(request,env,member)) ??
    (await dayPlannerRoutes(request,env,member)) ??
    (await preparationProfileRoutes(request,env,member)) ??
    (await projectRoutes(request,env,member)) ??
    (await mediaRoutes(request,env,member));
}
export const onRequest:PagesFunction<Env>=async context=>{
  const request=context.request,url=new URL(request.url),requestId=crypto.randomUUID();
  try{
    const authResponse=await firebaseRoutes(request,context.env);if(authResponse)return secureHeaders(authResponse);
    if(context.env.AUTH_MODE==='firebase'&&['GET','HEAD'].includes(request.method)&&isPublicAppPath(url.pathname))return secureHeaders(await context.next());
    const member=await authenticate(request,context.env);
    if(url.pathname.startsWith('/commercial-assets/'))assertCommercialAccess(member);
    else if(member.role==='commercial'&&!url.pathname.startsWith('/api/')&&!isPublicAppPath(url.pathname))assertGraphicsAccess(member);
    if(url.pathname.startsWith('/library/')||url.pathname.startsWith('/preview-media/'))await authorizeChannel(context.env.DB,member,'benin-tv');
    const apiResponse=await api(request,context.env,member);
    if(apiResponse)return secureHeaders(apiResponse);
    if(url.pathname.startsWith('/api/'))throw new HttpError(404,'Cette fonction n’existe pas.');
    if(!['GET','HEAD'].includes(request.method))throw new HttpError(405,'Action non disponible.');
    const previewAsset=await previewAssetResponse(request,assetRequest=>context.next(assetRequest),promise=>context.waitUntil(promise));
    if(previewAsset)return secureHeaders(previewAsset);
    const decoded=decodeURIComponent(url.pathname),mime=largeAssets.get(decoded);
    if(mime)return secureHeaders(await objectResponse(request,mediaStore(context.env),decoded.slice(1),mime));
    return secureHeaders(await context.next(),url.pathname.startsWith('/library/'));
  }catch(error){
    if(String(error).includes('member_purge_busy')){const busy=purgeBusy();return secureHeaders(json({error:busy.message,requestId},busy.status));}
    if(error instanceof ParameterError)return secureHeaders(json({error:error.message,requestId},422));
    if(error instanceof HttpError){
      const response=json({error:error.message,requestId},error.status);
      error.headers.forEach((value,key)=>response.headers.set(key,value));
      return secureHeaders(response);
    }
    if(error instanceof ZodError)return secureHeaders(json({error:'Champs invalides. Vérifiez les valeurs saisies.',details:error.issues.map(i=>({field:i.path.join('.'),message:i.message})),requestId},400));
    console.error(JSON.stringify({event:'request.failed',requestId,method:request.method,path:url.pathname,error:error instanceof Error?error.name:'unknown'}));
    return secureHeaders(json({error:'Opération non terminée. Vos changements ne sont pas confirmés. Réessayez ou contactez l’administrateur.',requestId},500));
  }
};
