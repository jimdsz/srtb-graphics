import {request} from './api';
import type {DerivationRequest} from './derivation-model';
import type {DerivationBatch,DerivationPage,DerivationOrigin} from './derivation-types';
import type {PreparationProfile,PreparationProfileCursor} from './preparation-profile-model';
export interface DerivationVoicePage {profiles:(PreparationProfile&{kind:'voice'})[];next:PreparationProfileCursor|null}

export const derivations={
  list:(projectId:string,next:DerivationPage['next']=null,signal?:AbortSignal)=>request<DerivationPage>(`/projects/${encodeURIComponent(projectId)}/derivations${next?'?'+new URLSearchParams(next):''}`,{signal}),
  get:(batchId:string,signal?:AbortSignal)=>request<DerivationBatch>(`/derivations/${encodeURIComponent(batchId)}`,{signal}),
  origin:(projectId:string,signal?:AbortSignal)=>request<DerivationOrigin>(`/projects/${encodeURIComponent(projectId)}/derivation-origin`,{signal}),
  create:(projectId:string,intent:DerivationRequest)=>request<DerivationBatch>(`/projects/${encodeURIComponent(projectId)}/derivations`,{method:'POST',body:JSON.stringify(intent)}),
  voices:(next:PreparationProfileCursor|null=null,signal?:AbortSignal)=>request<DerivationVoicePage>(`/preparation-profiles/voice-catalogue?${new URLSearchParams({limit:'100',...(next??{})})}`,{signal}),
};
