import {request} from './api';
import type {CreatePreparationProfile,PreparationKind,PreparationProfile,PreparationProfileCursor,PreparationProfilePage,PreparationProfileRevision,PreparationRevisionPage,PreparationData} from './preparation-profile-model';
export type * from './preparation-profile-model';

const base='/preparation-profiles';
export const preparationProfiles={
  list(options:{kind?:PreparationKind;archived?:boolean;favorite?:boolean;limit?:number;next?:PreparationProfileCursor|null}={},signal?:AbortSignal){
    const query=new URLSearchParams();
    if(options.kind)query.set('kind',options.kind);
    if(options.archived)query.set('archived','1');
    if(options.favorite)query.set('favorite','1');
    if(options.limit!==undefined)query.set('limit',String(options.limit));
    if(options.next){query.set('before',options.next.before);query.set('afterId',options.next.afterId);}
    return request<PreparationProfilePage>(base+(query.size?'?'+query:''),{signal});
  },
  get:(id:string,signal?:AbortSignal)=>request<PreparationProfile>(`${base}/${encodeURIComponent(id)}`,{signal}),
  create:(input:CreatePreparationProfile,signal?:AbortSignal)=>request<PreparationProfile>(base,{method:'POST',body:JSON.stringify(input),signal}),
  save:(profile:Pick<PreparationProfile,'id'|'revision'>,name:string,data:PreparationData,signal?:AbortSignal)=>request<PreparationProfile>(`${base}/${encodeURIComponent(profile.id)}`,{method:'PUT',body:JSON.stringify({revision:profile.revision,name,data}),signal}),
  archive:(profile:Pick<PreparationProfile,'id'|'revision'>,archived:boolean,signal?:AbortSignal)=>request<PreparationProfile>(`${base}/${encodeURIComponent(profile.id)}/archive`,{method:'POST',body:JSON.stringify({revision:profile.revision,archived}),signal}),
  favorite:(profile:Pick<PreparationProfile,'id'|'revision'>,favorite:boolean,signal?:AbortSignal)=>request<PreparationProfile>(`${base}/${encodeURIComponent(profile.id)}/favorite`,{method:'POST',body:JSON.stringify({revision:profile.revision,favorite}),signal}),
  revisions(id:string,before?:number,signal?:AbortSignal){return request<PreparationRevisionPage>(`${base}/${encodeURIComponent(id)}/revisions${before===undefined?'':`?before=${before}`}`,{signal});},
  revision:(id:string,revision:number,signal?:AbortSignal)=>request<PreparationProfileRevision>(`${base}/${encodeURIComponent(id)}/revisions/${revision}`,{signal}),
};
