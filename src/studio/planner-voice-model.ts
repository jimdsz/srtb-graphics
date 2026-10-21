import {z} from 'zod';
import {profileAssetSchema} from './preparation-profile-model';

export const plannerVoiceKinds=['ba','popup','tds','renvoi','event','weekly'] as const;
export type PlannerVoiceKind=typeof plannerVoiceKinds[number];
export const plannerVoiceLabels:Record<PlannerVoiceKind,string>={ba:'Bande-annonce',popup:'Pop-up',tds:'Tout de suite',renvoi:'Renvoi',event:'Événement',weekly:'Semainier'};
const seconds=z.number().finite().min(0).max(600);
/** The confirmation belongs to this exact source, passage and spoken cue.
 * Store it in the reviewed plan revision, never infer it from a file name. */
export const plannerVoiceSchema=z.object({
  source:profileAssetSchema.refine(source=>source.mimeType.startsWith('audio/'),'Choisissez un fichier audio.'),
  sourceDuration:z.number().finite().min(.04).max(600),start:seconds,end:seconds,
  cue:z.string().trim().min(1).max(80),confirmed:z.literal(true),
  placement:z.discriminatedUnion('mode',[
    z.object({mode:z.literal('ba-auto')}).strict(),
    z.object({mode:z.literal('ba-manual'),intro:seconds,carton:seconds}).strict(),
    z.object({mode:z.literal('single'),delay:seconds}).strict(),
  ]),
}).strict().refine(v=>v.end-v.start>=.04-1e-7&&v.end<=v.sourceDuration+1e-7,'Le passage vocal doit tenir dans le fichier et durer au moins 0,04 s.');
export type PlannerVoice=z.infer<typeof plannerVoiceSchema>;
export const plannerVoicesSchema=z.object({ba:plannerVoiceSchema.optional(),popup:plannerVoiceSchema.optional(),tds:plannerVoiceSchema.optional(),renvoi:plannerVoiceSchema.optional(),event:plannerVoiceSchema.optional()}).strict();
export type PlannerVoices=z.infer<typeof plannerVoicesSchema>;
export type PlannerVoiceChoices=Partial<Record<PlannerVoiceKind,PlannerVoice>>;
