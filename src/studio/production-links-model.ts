import type {PlannerTaskChoice} from './day-planner-model';
import type {ProjectStatus} from './domain';

export const productionLinksSections=['occurrences','deliverables','weekly','derivations'] as const;
export type ProductionLinksSection=typeof productionLinksSections[number];
export type ProductionLinkage='same-programme'|'line-only'|'different-programme'|'undocumented'|'missing-history';
export interface ProductionOccurrence {
  rowId:string;title:string;subtitle:string;airDate:string;broadcastDate:string;time:string;
  included:boolean;sourceRemoved:boolean;programmeRevision:number|null;
}
export interface ProductionCoordination {
  key:string;kind:PlannerTaskChoice['kind'];format:PlannerTaskChoice['format'];ownerName:string;
  /** Coordination state only. It grants no access to a private project. */
  state:ProjectStatus|'archived'|'assigned'|'unknown';
}
export interface ProductionOccurrenceItem {
  type:'occurrence';id:string;occurrence:ProductionOccurrence;coordination:ProductionCoordination[];
}
export interface ProductionHistoricalOccurrence {
  rowId:string;linkage:ProductionLinkage;
  /** Missing history never borrows the current row's identity or description. */
  occurrence:ProductionOccurrence|null;
}
export interface ProductionVisibleProject {
  id:string;title:string;templateId:string;templateVersion:string;libraryVersion:string;
  revision:number;status:ProjectStatus;archived:boolean;format:PlannerTaskChoice['format']|null;
}
export interface ProductionProjectItem {
  type:'project';id:string;relation:'direct'|'weekly'|'derived';taskKey:string;
  kind:PlannerTaskChoice['kind'];format:PlannerTaskChoice['format'];sourceRevision:number;edition:number|null;
  origins:ProductionHistoricalOccurrence[];
  /** Historical attachment, not whether the current project is up to date. */
  linkage:ProductionLinkage;
  project:ProductionVisibleProject;
  derivation?:{
    batchId:string;batchName:string;sourceProject:ProductionVisibleProject;sourceRevision:number;
    targetKey:string;label:string;
    /** Creation metadata, never a calculated calendar date or current text. */
    announcement:{key:string;day:string;time:string;format:PlannerTaskChoice['format']}|null;
  };
}
export type ProductionLinksItem=ProductionOccurrenceItem|ProductionProjectItem;
export interface ProductionLinksContext {
  channelId:string;planId:string;planRevision:number;planName:string;rowId:string;
  scope:'programme'|'line';programmeId:string|null;title:string;
  /** Changes only with the authorized projection. No private-project counter. */
  snapshot:string;
}
export interface ProductionLinksPage {
  context:ProductionLinksContext;section:ProductionLinksSection;items:ProductionLinksItem[];next:string|null;
}
