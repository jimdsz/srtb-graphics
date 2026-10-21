import {z} from 'zod';
import type {ProjectData} from './domain';
import {ANNOUNCEMENTS} from './presentation';
import {localReference,mediaExtensions} from './local-reference';

export const preparationKinds=['programme','preset','voice'] as const;
export const charterColours=['#ffffff','#000000','#f0b900','#007300','#eb1905'] as const;
export const voiceVariants=['rediffusion','en-direct','inedit','exceptionnel'] as const;
export const preparationAnnouncements=ANNOUNCEMENTS;
export const MAX_PROFILE_DATA_BYTES=64*1024;
export const MAX_PREPARATION_PROFILES=2000;
export const MAX_PROFILE_ASSETS=64;
export const profileIdSchema=z.uuid();
const nameSchema=z.string().trim().min(1).max(120).regex(/^[^\x00-\x1f]+$/);
const timeSchema=z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const announcementKey=(value:string)=>value.normalize('NFC').trim().replace(/[’‘ʼ]/g,"'").replace(/\s+/g,' ').toLocaleLowerCase('fr-FR');
const announcementSchema=z.preprocess(value=>typeof value==='string'?(ANNOUNCEMENTS.find(item=>announcementKey(item)===announcementKey(value))??value):value,z.enum(ANNOUNCEMENTS));
export const sharedProfileAsset=/^\/api\/graphics\/media\/([a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12})\/content$/;
export const profileAssetSchema=z.object({
  url:z.string().max(200).refine(value=>!!localReference(value)||sharedProfileAsset.test(value),'Sélectionnez une référence locale vérifiée ou un média privé partagé.'),
  name:z.string().trim().min(1).max(200).regex(/^[^\x00-\x1f/\\]+$/),
  mimeType:z.string().refine(value=>Object.hasOwn(mediaExtensions,value),'Format média non pris en charge.'),
}).strict();
export const voiceCueSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('announcement'),value:announcementSchema}).strict(),
  z.object({kind:z.literal('time'),value:timeSchema}).strict(),
  z.object({kind:z.literal('variant'),value:z.enum(voiceVariants)}).strict(),
]);
export const voiceDataSchema=z.object({
  source:profileAssetSchema.refine(value=>value.mimeType.startsWith('audio/'),'Sélectionnez un fichier audio.'),
  start:z.number().finite().min(0).max(86400),end:z.number().finite().min(0).max(86400),
  label:nameSchema,cue:voiceCueSchema,humanValidated:z.literal(true),
}).strict().refine(value=>value.end-value.start>=.04-1e-9&&value.end-value.start<=600+1e-9,'Le passage doit durer entre 0,04 et 600 secondes.');
export const programmeDataSchema=z.object({
  title:nameSchema,
  logo:profileAssetSchema.refine(value=>value.mimeType.startsWith('image/'),'Sélectionnez une image.').nullable().default(null),
  palette:z.array(z.enum(charterColours)).min(1).max(5).refine(value=>new Set(value).size===value.length,'Une couleur ne doit apparaître qu’une fois.').default(['#f0b900','#000000','#ffffff']),
  appointments:z.array(z.object({announcement:announcementSchema,time:timeSchema}).strict()).max(3).default([]),
  voice:z.object({profileId:profileIdSchema,revision:z.number().int().positive()}).strict().nullable().default(null),
}).strict();
const common={name:nameSchema,favorite:z.boolean().default(false)};
export const createPreparationSchema=z.discriminatedUnion('kind',[
  z.object({...common,kind:z.literal('programme'),data:programmeDataSchema}).strict(),
  z.object({...common,kind:z.literal('voice'),data:voiceDataSchema}).strict(),
  z.object({...common,kind:z.literal('preset'),templateId:z.string().min(1).max(100),templateVersion:z.string().min(1).max(30),libraryVersion:z.string().min(1).max(30),data:z.record(z.string(),z.unknown())}).strict(),
]);
export const updatePreparationSchema=z.object({revision:z.number().int().positive(),name:nameSchema,data:z.unknown()}).strict();
export type PreparationKind=typeof preparationKinds[number];
export type ProfileAsset=z.infer<typeof profileAssetSchema>;
export type ProgrammeData=z.infer<typeof programmeDataSchema>;
export type VoiceData=z.infer<typeof voiceDataSchema>;
export type PreparationData=ProgrammeData|VoiceData|ProjectData;
export type CreatePreparationProfile=z.input<typeof createPreparationSchema>;
export interface PreparationProfileSummary {
  id:string;kind:PreparationKind;name:string;favorite:boolean;archived:boolean;revision:number;
  template_id:string|null;template_version:string|null;library_version:string|null;
  created_by:string;updated_by:string;created_at:string;updated_at:string;
  validated_by:string|null;validated_at:string|null;
}
export type PreparationProfile=PreparationProfileSummary&(
  {kind:'programme';data:ProgrammeData}|{kind:'voice';data:VoiceData}|{kind:'preset';data:ProjectData}
);
export interface PreparationProfileRevision {
  revision:number;name:string;data:PreparationData;favorite:boolean;archived:boolean;
  actor:string;created_at:string;validated_by:string|null;validated_at:string|null;
}
export interface PreparationProfileCursor {before:string;afterId:string}
export interface PreparationProfilePage {profiles:PreparationProfileSummary[];next:PreparationProfileCursor|null}
export interface PreparationRevisionPage {revisions:PreparationProfileRevision[];next:number|null}
