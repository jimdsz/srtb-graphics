import {request} from './api';
import type {ProductionOverviewPage,ProductionOverviewView} from './production-overview-model';
import type {PlannerDocument,PlannerRecord,PlannerSummary,PlannerTask,PlannerTaskChoice,ProgrammeRule} from './day-planner-model';
export const plannerAPI={
 overview:(view:ProductionOverviewView,date:string,cursor?:string,signal?:AbortSignal)=>request<ProductionOverviewPage>(`/planner/overview?${new URLSearchParams({view,date,...(cursor?{cursor}:{})})}`,{signal}),
 rules:(programmes:string[],signal?:AbortSignal,families?:string[])=>request<{rules:PlannerRecord<ProgrammeRule>[]}>(`/planner/rules`,{method:'POST',signal,body:JSON.stringify({programmes:[...new Set(programmes)],...(families?{families:[...new Set(families)]}:{})})}),
 list:(kind:PlannerDocument['kind'],offset=0,programme?:string,signal?:AbortSignal)=>request<{documents:PlannerSummary[];next:number|null}>(`/planner?${new URLSearchParams({kind,offset:String(offset),...(programme?{programme}:{})})}`,{signal}),
 get:<T extends PlannerDocument>(id:string,signal?:AbortSignal)=>request<PlannerRecord<T>>(`/planner/${id}`,{signal}),
 save:<T extends PlannerDocument>(id:string,revision:number,data:T,signal?:AbortSignal)=>request<PlannerRecord<T>>(`/planner/${id}`,{method:'PUT',signal,body:JSON.stringify({revision,data})}),
 tasks:(id:string,signal?:AbortSignal)=>request<{tasks:PlannerTask[]}>(`/planner/${id}/tasks`,{signal}),
 create:(id:string,revision:number,tasks:PlannerTaskChoice[],options?:{response?:'requested';signal?:AbortSignal})=>request<{tasks:PlannerTask[]}>(`/planner/${id}/tasks`,{method:'POST',signal:options?.signal,body:JSON.stringify({revision,tasks,...(options?.response?{response:options.response}:{})})}),
 archive:(id:string,revision:number)=>request(`/planner/${id}/archive`,{method:'POST',body:JSON.stringify({revision,archived:true})}),
};
