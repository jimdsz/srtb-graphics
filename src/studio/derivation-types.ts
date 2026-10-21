import type {Project,ProjectData} from './domain';
import type {DerivationAnnouncementMetadata} from './derivation-announcements';

export interface DerivationOrigin {
  batchId:string;
  sourceProjectId:string;
  sourceRevision:number;
  sourceTemplateId:string;
  sourceTemplateVersion:string;
  sourceLibraryVersion:string;
  sourceSnapshotSha256:string;
  allowedLibraryUrls:string[];
  announcement?:DerivationAnnouncementMetadata;
}
export interface DerivationBatchSummary {
  id:string;
  name:string;
  sourceProjectId:string;
  sourceRevision:number;
  sourceTemplateId:string;
  sourceTemplateVersion:string;
  sourceLibraryVersion:string;
  mappingVersion:string;
  sourceSnapshotSha256:string;
  createdBy:string;
  createdAt:string;
  childCount:number;
}
export interface DerivationBatch extends DerivationBatchSummary {
  sourceSnapshot:{title:string;data:ProjectData;sha256:string};
  children:{targetKey:string;label:string;initialRevision:1;warnings:string[];project:Project;announcement?:DerivationAnnouncementMetadata}[];
}
export interface DerivationPage {
  batches:DerivationBatchSummary[];
  next:{before:string;id:string}|null;
}
