import {z} from 'zod';
import {ParameterError,validateProjectData} from './domain';
import type {BroadcastTemplate,ProjectData} from './domain';
import {textStyles} from './typography-model';

export const derivationAnnouncementKeys=['day-time','tomorrow','today','tonight','now'] as const;
export const derivationAnnouncementDays=['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'] as const;
export const derivationAnnouncementFormats=['tv','portrait','vertical'] as const;
export type DerivationAnnouncementKey=typeof derivationAnnouncementKeys[number];
export type DerivationAnnouncementTargetKey=`ba-${DerivationAnnouncementKey}-${typeof derivationAnnouncementFormats[number]}`;
export const derivationAnnouncementSchema=z.object({
  key:z.enum(derivationAnnouncementKeys),day:z.enum(derivationAnnouncementDays).optional(),
  time:z.union([z.literal(''),z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)]).optional(),
  formats:z.array(z.enum(derivationAnnouncementFormats)).min(1).max(3).refine(values=>new Set(values).size===values.length,'Chaque format doit être choisi une seule fois.'),
  voice:z.discriminatedUnion('mode',[
    z.object({mode:z.literal('pending')}).strict(),z.object({mode:z.literal('none')}).strict(),
    z.object({mode:z.literal('profile'),profileId:z.uuid(),revision:z.number().int().positive(),placement:z.enum(['source','fit-complete','manual']).optional()}).strict(),
  ]),
}).strict().superRefine((value,ctx)=>{
  if(value.key!=='day-time'&&value.day!==undefined)ctx.addIssue({code:'custom',path:['day'],message:'Un jour précis ne s’applique qu’à la variante jour et heure.'});
  if(value.key==='now'&&value.time)ctx.addIssue({code:'custom',path:['time'],message:'Tout de suite ne comporte pas d’heure.'});
});
export type DerivationAnnouncement=z.infer<typeof derivationAnnouncementSchema>;
export interface DerivationAnnouncementMetadata {
  key:DerivationAnnouncementKey;day:string;time:string;format:typeof derivationAnnouncementFormats[number];
  voice:{mode:'pending'|'none'|'profile';status:'pending'|'none'|'resolved';profileId?:string;revision?:number;label?:string;
    validatedBy?:string;validatedAt?:string;source?:{url:string;name:string;mimeType:string};start?:number;end?:number;
    placement?:'source'|'fit-complete'|'manual';introOffset?:number;outroOffset?:number};
}
/** Semantic comparison only: never choose another cue, date or profile revision. */
export const normalizeAnnouncement=(value:string)=>value.normalize('NFC').trim().replace(/[’‘ʼ]/g,"'").replace(/\s+/g,' ').toLocaleLowerCase('fr-FR');
const labels={tomorrow:'Demain',today:'Aujourd’hui',tonight:'Ce soir',now:'Tout de suite'} as const;
function sourceTime(data:ProjectData){
  const value=String(data._heure_1??'').trim().replace(/[hH]/,':').replace(/^(\d):/,'0$1:');
  if(!value)return '';
  if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))throw new ParameterError('Choisissez explicitement une heure au format HH:mm pour cette annonce.');
  return value;
}
export function announcementProjects(template:BroadcastTemplate,title:string,source:ProjectData,announcements:DerivationAnnouncement[]){
  return announcements.flatMap(announcement=>{
    const day=announcement.key==='day-time'?(announcement.day??derivationAnnouncementDays.find(day=>normalizeAnnouncement(day)===normalizeAnnouncement(String(source._jour_1??'')))):labels[announcement.key];
    if(!day)throw new ParameterError('Choisissez explicitement le jour de la variante jour et heure. Aucun jour n’est déduit du calendrier.');
    const time=announcement.key==='now'?'':announcement.time??sourceTime(source);
    return announcement.formats.map(format=>{
      const data:ProjectData=structuredClone(source),warnings:string[]=[];
      data._studio_format=format;data._studio_ba_mode='simple';data._jour_1=day;data._heure_1=time.replace(':','h');
      for(const n of [2,3]){data[`_jour_${n}`]='';data[`_heure_${n}`]='';}
      // A new announcement must never inherit a voice announcing another day.
      // The frozen engine validates even disabled insertion bounds. One silent
      // frame is a neutral valid range, not a copied excerpt or a voice asset.
      data._audio_voice_enabled=false;data._audio_voice_url='';data._audio_voice_in_seconds=0;data._audio_voice_out_seconds=.04;
      data._studio_ba_voice_fit='source';
      const styles=textStyles(source),sourceFormat=String(source._studio_format||'tv');let inherited=false;
      for(const [key,style]of Object.entries(styles)){
        if(!key.startsWith(sourceFormat+':'))continue;
        const target=format+key.slice(sourceFormat.length);if(Object.hasOwn(styles,target))continue;
        const identity=Object.fromEntries(Object.entries(style).filter(([property])=>['font','fontName','bold','italic','case','colour'].includes(property)));
        if(Object.keys(identity).length){styles[target]=identity;inherited=true;}
      }
      if(inherited)data._studio_typography=JSON.stringify(styles);
      const voice:DerivationAnnouncementMetadata['voice']=announcement.voice.mode==='profile'?{...announcement.voice,status:'pending'}:{mode:announcement.voice.mode,status:announcement.voice.mode};
      if(voice.status==='pending')warnings.push('Voix à préparer : ce brouillon reste sans annonce vocale tant qu’un passage compatible n’est pas validé.');
      else warnings.push('Sans voix, choix explicite : la musique et le son des médias restent inchangés.');
      warnings.push('BA complète en mode simple. Contrôlez le cadrage, les textes et l’écoute avant utilisation.');
      const label=`Bande-annonce · ${day}${time?' · '+time:''} · ${format==='tv'?'TV':format==='portrait'?'4:5':'9:16'}`;
      return {targetKey:`ba-${announcement.key}-${format}` as DerivationAnnouncementTargetKey,label,title:`${title.slice(0,Math.max(1,117-label.length))} — ${label}`.slice(0,120),
        templateId:template.id,templateVersion:template.version,libraryVersion:template.libraryVersion,data:validateProjectData(template,data),warnings,
        announcement:{key:announcement.key,day,time,format,voice} satisfies DerivationAnnouncementMetadata};
    });
  });
}
