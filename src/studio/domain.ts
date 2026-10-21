import catalogueData from './catalogue.generated.json';
import catalogueExtensions from './catalogue.extensions.json';
import { z } from 'zod';
import {localReference,mediaExtensions} from './local-reference';
import {sequenceLimit} from './media-selection';
import {presentationFields} from './presentation';
import {TYPOGRAPHY_KEY,DEFAULT_TEXT_CASE,defaultTextCaseData,parseStyles,textFields} from './typography-model';
import {parseCropMotion} from './crop-motion';
import {parseSequenceCrops} from './sequence-crop';
import {IMAGE_SIZES,parseImageSizes} from './image-sizing-model';
import {relayNewDefaults} from './relay-placement';
import {PORTRAIT_LAYOUT,portraitPanelTemplate} from './social-portrait-layout';
import {RENVOI_RATING,RENVOI_AD,renvoiSignageTemplate} from './renvoi-signage';
import {baSocialDirect} from './ba-social-direct';

export type Role = 'admin' | 'designer' | 'broadcaster' | 'commercial';
export type ProjectStatus = 'draft' | 'submitted' | 'approved' | 'rejected';
export type FieldValue = string | number | boolean | { url: string; name: string; mimeType: string };
export type ProjectData = Record<string, FieldValue>;
export interface BroadcastField {
  type?: string; title?: string; default?: FieldValue; description?: string;
  enum?: string[]; minimum?: number; maximum?: number; maxLength?: number;
  multipleOf?: number; 'x-section'?: string; 'x-control'?: string;
  'x-enumLabels'?: Record<string, string>; anyOf?: unknown[];
}
export interface BroadcastTemplate {
  id: string; name: string; description: string; version: string;
  libraryVersion: string; category: string; module: string; preview: string;
  fields: Record<string, BroadcastField>; width: number; height: number; fps: number;
  legacyOfflineDeclared: boolean; exportQualification: string; siteQualification: string;
}
const fieldValueSchema = z.union([z.string(), z.number(), z.boolean(), z.object({ url: z.string(), name: z.string(), mimeType: z.string() })]);
const fieldSchema = z.object({
  type: z.string().optional(), title: z.string().optional(), default: fieldValueSchema.optional(), description: z.string().optional(),
  enum: z.array(z.string()).optional(), minimum: z.number().optional(), maximum: z.number().optional(), maxLength: z.number().optional(),
  multipleOf: z.number().optional(), 'x-section': z.string().optional(), 'x-control': z.string().optional(),
  'x-enumLabels': z.record(z.string(), z.string()).optional(), anyOf: z.array(z.unknown()).optional(),
});
export const broadcastTemplates: BroadcastTemplate[] = z.array(z.object({
  id: z.string(), name: z.string(), description: z.string(), version: z.string(), libraryVersion: z.string(),
  category: z.string(), module: z.string(), preview: z.string(), fields: z.record(z.string(), fieldSchema),
  width: z.number(), height: z.number(), fps: z.number(), legacyOfflineDeclared: z.boolean(),
  exportQualification: z.string(), siteQualification: z.string(),
})).parse([...catalogueData,...catalogueExtensions]).map(template=>({...template,fields:presentationFields(template.fields,template.id)}));
export class ParameterError extends Error {}
export const roleLabels: Record<Role, string> = {
  admin: 'Administrateur', designer: 'Infographiste', broadcaster: 'Diffuseur', commercial: 'Service commercial',
};
export const statusLabels: Record<ProjectStatus, string> = {
  draft: 'Brouillon', submitted: 'À valider', approved: 'Validé', rejected: 'À corriger',
};
export interface MemberInvitation { status: 'requested'|'failed'|'pending'; at: string; message?: string }
export interface Member { email: string; name: string; role: Role; active: number; invitation?: MemberInvitation; has_connected?: boolean }
export interface Project {
  channel_id?:string;
  visibility?: 'private' | 'team';
  id: string; title: string; template_id: string; template_version: string;
  library_version: string; status: ProjectStatus; revision: number; data: ProjectData;
  created_by: string; updated_by: string; created_at: string; updated_at: string; archived: number;
}
export interface Revision {
  revision: number; title: string; status: ProjectStatus; data: ProjectData;
  actor: string; created_at: string;
}
export interface MediaAsset {
  id: string; name: string; mime_type: string; bytes: number;
  created_by: string; created_at: string; status: 'uploading' | 'ready' | 'failed';
}
export interface PendingTransfer {
  id: string; name: string; mime_type: string; bytes: number; created_at: string;
  received_bytes: number; received_parts: number; expected_parts: number; busy: boolean;
}
export function getTemplate(id: string) {
  const template = broadcastTemplates.find(t => t.id === id);
  if (!template) throw new ParameterError('Modèle absent de la bibliothèque active.');
  return template;
}
function compatibleDefaults(template: BroadcastTemplate): ProjectData {
  return Object.fromEntries(Object.entries(template.fields).map(([key, field]) => [key, field.default ?? '']));
}
/** New projects/catalogue only. Validation of existing projects deliberately
 * keeps the frozen schema defaults and the original case mode. */
export function templateDefaults(template: BroadcastTemplate): ProjectData {
  const data={...compatibleDefaults(template),[DEFAULT_TEXT_CASE]:'upper'};
  // New social compositions use the official horizontal logo at the right.
  // Keep schema defaults frozen so reloading a saved project retains its anchor.
  if(template.id.startsWith('BTV_'))Object.assign(data,{_studio_logo_anchor:'top-right'});
  if(portraitPanelTemplate(template.id))Object.assign(data,{[PORTRAIT_LAYOUT]:'compact'});
  // Both Tout de suite engines ship their own original accompaniment. Enable
  // it for new projects and catalogue previews, as for the BA. Saved silence
  // remains explicit: validateProjectData keeps the historical schema defaults.
  if(template.libraryVersion==='1.7.0'&&['BTV_BA_TDS','BTV_BA_TDS_SUIVI_DE'].includes(template.id))Object.assign(data,{_audio_bed_enabled:true});
  if(template.id==='BTV_PopUp')Object.assign(data,{_background_visible:false,_media_background_url:'',_media_background_sequence:'[]'});
  if(template.id==='BTV_Relais_Antenne')Object.assign(data,relayNewDefaults);
  if(template.id==='BTV_Ce_Soir')Object.assign(data,{_studio_ce_soir_background:'vert',_audio_signature_enabled:true,_audio_voice_delay_seconds:1.92,_audio_loop:true,_audio_volume:.22});
  // Do not imply an age classification or AD availability on a new programme.
  // Older projects without these fields retain their native signalétique.
  if(renvoiSignageTemplate(template))Object.assign(data,{[RENVOI_RATING]:false,[RENVOI_AD]:false});
  return defaultTextCaseData(template,data);
}
export function canApprove(role: Role) { return role === 'admin' || role === 'broadcaster'; }
export function isMediaField(key: string, field: BroadcastField) {
  return ['media', 'image', 'audio'].includes(field['x-control'] ?? '') ||
    /(?:_media|_audio|_sponsor).*_url$/.test(key);
}
export function isSequenceField(key: string, field: BroadcastField) {
  return field['x-control'] === 'sequence' || key.endsWith('_sequence');
}
export function safeMediaUrl(value: string, local = false) {
  if (!value) return true;
  if(localReference(value))return true;
  if (local && value.startsWith('blob:')) return true;
  // Ephemeral preview-only ticket. It must never pass project persistence.
  if (local && /^http:\/\/127\.0\.0\.1:43871\/v1\/media\/[a-f\d]{64}$/.test(value)) return true;
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { return false; }
  if (decoded.includes('\\') || decoded.split('/').some(p => p === '..' || p === '.') || /[\x00-\x1f%]/.test(decoded)) return false;
  return /^\/api\/graphics\/media\/[a-f\d-]+\/content$/.test(value) ||
    /^img_\d+\.(?:png|jpe?g|webp)$/.test(value) ||
    /^(?:lib|sourceassets)\/[\w\s/().%+@éèàç_-]+$/iu.test(value) ||
    /^\/library\/v[\d.]+\/BTV_[\w]+\/[\w\s/().%+@éèàç_-]+$/iu.test(value);
}
export function validateProjectData(template: BroadcastTemplate, input: unknown, local = false): ProjectData {
  // Validate raw own keys before Zod normalizes records (notably __proto__).
  if(input&&typeof input==='object'&&!Array.isArray(input))for(const key of Object.keys(input))if(!Object.hasOwn(template.fields,key))throw new ParameterError(`Champ inconnu : ${key}`);
  const parsed = z.record(z.string(), z.unknown()).safeParse(input);
  if (!parsed.success) throw new ParameterError('Paramètres invalides.');
  const result = compatibleDefaults(template);
  for (const [key, value] of Object.entries(parsed.data)) {
    const field = Object.hasOwn(template.fields,key) ? template.fields[key] : undefined;
    if (!field) throw new ParameterError(`Champ inconnu : ${key}`);
    const label = field.title || key;
    if(key===TYPOGRAPHY_KEY){result[key]=JSON.stringify(parseStyles(value,new Set(textFields(template).map(([name])=>name))));}
    else if(key===IMAGE_SIZES){try{result[key]=JSON.stringify(parseImageSizes(value));}catch(error){throw new ParameterError(error instanceof Error?error.message:'Tailles des images invalides.');}}
    else if(key.startsWith('_studio_')&&key.endsWith('_crop_motion')){try{result[key]=JSON.stringify(parseCropMotion(value));}catch(error){throw new ParameterError(error instanceof Error?error.message:'Repères de cadrage invalides.');}}
    else if(key.startsWith('_studio_')&&key.endsWith('_sequence_crops')){try{const crops=parseSequenceCrops(value);if(crops.length>sequenceLimit(template))throw Error('Trop de cadrages pour ce modèle.');result[key]=JSON.stringify(crops);}catch(error){throw new ParameterError(error instanceof Error?error.message:'Cadrages des passages invalides.');}}
    else if (isMediaField(key, field)) {
      const descriptor = z.object({ url: z.string(), name: z.string().max(200), mimeType: z.string().max(100) }).strict().safeParse(value);
      const url = typeof value === 'string' ? value : descriptor.success ? descriptor.data.url : undefined;
      if (typeof url !== 'string' || !safeMediaUrl(url, local)) throw new ParameterError(`${label} : sélectionner un média partagé ou une ressource du modèle.`);
      if(localReference(url)&&(!descriptor.success||!mediaExtensions[descriptor.data.mimeType]))throw new ParameterError(`${label} : référence locale incomplète.`);
      if (typeof value === 'object' && value !== null) {
        if (!descriptor.success) throw new ParameterError(`${label} : média invalide.`);
        result[key] = descriptor.data;
      } else result[key] = url;
    } else if (isSequenceField(key, field)) {
      if (typeof value !== 'string' || value.length > 20000) throw new ParameterError(`${label} : séquence invalide.`);
      let sequence: unknown;
      try { sequence = JSON.parse(value); } catch { throw new ParameterError(`${label} : liste de passages invalide.`); }
      const limit=sequenceLimit(template);
      if (!Array.isArray(sequence) || sequence.length > limit) throw new ParameterError(`${label} : ${limit} passages maximum.`);
      for (const [index,clip] of sequence.entries()) {
        if(clip&&typeof clip==='object'&&'url'in clip&&(!clip.url||typeof clip.url==='object'&&!clip.url.url))throw new ParameterError(`${label} : choisissez le média du passage ${index+1}, ou retirez ce passage.`);
        const entry = z.object({ url: z.union([z.string().min(1), z.object({url:z.string().min(1),name:z.string().max(200),mimeType:z.string().max(100)}).strict()]), start: z.number().min(0).max(86400), end: z.number().min(0).max(86400) }).strict().safeParse(clip);
        if (!entry.success || !safeMediaUrl(typeof entry.data.url==='string'?entry.data.url:entry.data.url.url, local) ||
          (entry.data.end !== 0 && Math.round(entry.data.end*25) <= Math.round(entry.data.start*25))) throw new ParameterError(`${label} : passage ${index+1} invalide (média, point IN ou OUT ; au moins 0,04 s).`);
        if(localReference(typeof entry.data.url==='string'?entry.data.url:entry.data.url.url)&&(typeof entry.data.url==='string'||!mediaExtensions[entry.data.url.mimeType]))throw new ParameterError(`${label} : référence locale incomplète.`);
      }
      result[key] = JSON.stringify(sequence);
    } else if (field.type === 'boolean') {
      if (typeof value !== 'boolean') throw new ParameterError(`${label} : oui/non attendu.`);
      result[key] = value;
    } else if (field.type === 'number' || field.type === 'integer') {
      if (typeof value !== 'number' || !Number.isFinite(value) ||
        (field.minimum !== undefined && value < (key==='_out_duration_seconds'&&baSocialDirect(template.id,parsed.data as ProjectData)?0.04:field.minimum)) ||
        (field.maximum !== undefined && value > field.maximum) ||
        (field.type === 'integer' && !Number.isInteger(value)) ||
        (field.multipleOf !== undefined && Math.abs(value / field.multipleOf - Math.round(value / field.multipleOf)) > 1e-7)) throw new ParameterError(`${label} : nombre hors limites.`);
      result[key] = value;
    } else {
      if (typeof value !== 'string' || value.length > (field.maxLength ?? 2048) || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) throw new ParameterError(`${label} : texte invalide ou trop long.`);
      if (field.enum && !field.enum.includes(value)) throw new ParameterError(`${label} : valeur hors charte.`);
      if (key === '_replay_url' && value) {
        let url: URL;
        try { url = new URL(value); } catch { throw new ParameterError('Adresse du replay invalide.'); }
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new ParameterError('Utiliser une adresse HTTP(S) de replay sans identifiants.');
      }
      result[key] = value;
    }
  }
  return result;
}
