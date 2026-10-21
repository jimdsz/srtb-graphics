import type {ProjectData} from './domain';
import {derivationAnnouncementDays,derivationAnnouncementKeys,normalizeAnnouncement} from './derivation-announcements';
import type {DerivationAnnouncement,DerivationAnnouncementKey} from './derivation-announcements';
import type {VoiceData} from './preparation-profile-model';

export const announcementLabels:Record<DerivationAnnouncementKey,string>={'day-time':'Jour + heure',tomorrow:'Demain',today:'Aujourd’hui',tonight:'Ce soir',now:'Tout de suite'};
export const announcementFormats=[['tv','TV · 16:9'],['portrait','4:5'],['vertical','9:16']] as const;
type Format=DerivationAnnouncement['formats'][number];

/** Initial display is restored from retained choices, not from the source BA. */
export function initialAnnouncementFields(data:ProjectData,value:DerivationAnnouncement[]){
  const retainedDay=value.find(item=>item.key==='day-time')?.day;
  const day=retainedDay??derivationAnnouncementDays.find(day=>normalizeAnnouncement(day)===normalizeAnnouncement(String(data._jour_1||'')));
  const normalized=String(data._heure_1??'').trim().replace(/[hH]/,':').replace(/^(\d):/,'0$1:');
  const sourceTime=/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(normalized)?normalized:'';
  const times=value.filter(item=>item.key!=='now').map(item=>item.time??sourceTime);
  return {day,time:times.length?times.every(time=>time===times[0])?times[0]:'':sourceTime,mixedTimes:new Set(times).size>1};
}

export function announcementCue(key:DerivationAnnouncementKey,day?:DerivationAnnouncement['day']){
  return key==='day-time'?day:announcementLabels[key];
}

/** Independent format choices never change another announcement, text or voice pin. */
export function withAnnouncementFormat(item:DerivationAnnouncement,format:Format,checked:boolean):DerivationAnnouncement{
  return {...item,formats:checked?[...new Set([...item.formats,format])]:item.formats.filter(old=>old!==format)};
}

export function announcementFromClassifiedVoice(profile:{id:string;revision:number;data:{cue:VoiceData['cue']}},value:DerivationAnnouncement[],defaultTime:string):DerivationAnnouncement|null{
  if(profile.data.cue.kind!=='announcement')return null;
  const cue=normalizeAnnouncement(profile.data.cue.value);
  const day=derivationAnnouncementDays.find(day=>normalizeAnnouncement(day)===cue);
  const key=day?'day-time':derivationAnnouncementKeys.find(key=>key!=='day-time'&&normalizeAnnouncement(announcementLabels[key])===cue);
  if(!key)return null;
  const existing=value.find(item=>item.key===key);
  return {key,...(day?{day}:{}),time:key==='now'?'':existing?.time??defaultTime,formats:existing?.formats??['tv'],voice:{mode:'profile',profileId:profile.id,revision:profile.revision}};
}

export function announcementVoiceLabel(voice:DerivationAnnouncement['voice'],profileName?:string){
  if(voice.mode==='profile')return profileName?`${profileName} · r${voice.revision}`:`Voix épinglée · r${voice.revision} · révision non chargée`;
  return voice.mode==='none'?'Sans voix off':'Voix à associer';
}
