import type {PlannerTaskChoice} from './day-planner-model';

export type ProductionOverviewView='mine'|'missing-media'|'review';
export type ProductionOverviewState='assigned'|'draft'|'submitted'|'approved'|'rejected'|'archived'|'missing-media';
export interface ProductionOverviewItem {
  id:string;planId:string;planName:string;planRevision:number;rowId:string;
  title:string;date:string;broadcastDate:string;time:string;
  kind:PlannerTaskChoice['kind']|null;format:PlannerTaskChoice['format']|null;
  ownerName:string|null;state:ProductionOverviewState;projectId?:string;
}
export interface ProductionOverviewPage {
  items:ProductionOverviewItem[];next:string|null;view:ProductionOverviewView;date:string;
}
