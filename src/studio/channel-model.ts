import {z} from 'zod';
import {normalized,plannerKinds} from './day-planner-model';
export interface Channel {id:string;name:string;logo:string;accent:string;timezone:string;revision:number;archived:number;canManage?:boolean}
export const programmeSchema=z.object({
  name:z.string().trim().min(1).max(200),aliases:z.array(z.string().trim().min(1).max(200)).max(30),
  category:z.string().max(80),replayUrl:z.union([z.literal(''),z.url().refine(value=>new URL(value).protocol==='https:')]),
  recurring:z.boolean(),recipe:z.array(z.enum(plannerKinds)).max(5),notes:z.string().max(2000),
  directoryIds:z.array(z.uuid()).max(32),voiceProfileId:z.uuid().nullable(),
  logo:z.union([z.literal(''),z.string().regex(/^\/api\/graphics\/media\/[a-f0-9-]{36}\/content$/)]).optional(),
}).strict();
export type ProgrammeData=z.infer<typeof programmeSchema>;
export interface Programme {id:string;channel_id:string;name:string;revision:number;archived:number;data:ProgrammeData;updated_at:string}
export const programmeKey=(data:ProgrammeData)=>normalized(data.name);
export interface SearchResults {projects:import('./domain').Project[];programmes:Programme[];media:import('./domain').MediaAsset[]}
