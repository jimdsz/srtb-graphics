import {request} from './api';
import type {ProductionLinksPage,ProductionLinksSection} from './production-links-model';
import {validateProductionLinksPage} from './production-links-validation';

export const productionLinksAPI={
  read:(planId:string,rowId:string,revision:number,section:ProductionLinksSection,cursor:string|null=null,signal?:AbortSignal):Promise<ProductionLinksPage>=>request<unknown>(
    `/planner/${encodeURIComponent(planId)}/production-links?${new URLSearchParams({rowId,revision:String(revision),section,...(cursor?{cursor}:{})})}`,{signal}).then(validateProductionLinksPage),
};
