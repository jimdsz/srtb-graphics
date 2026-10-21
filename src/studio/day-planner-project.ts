import {getTemplate,templateDefaults,isMediaField,isSequenceField,validateProjectData,ParameterError} from './domain';
import type {FieldValue} from './domain';
import {dateSchema,frenchDay,plannerLabels,timeSchema,plannerRowSchema} from './day-planner-model';
import type {Plan,PlannerTaskChoice,PlannerRow} from './day-planner-model';
import {modelSignature} from './signature-sound';
import {plannerTemplates,plannerVoicePatch,selectedPlannerVoice} from './planner-voice';

export function plannerSignature(kind:PlannerTaskChoice['kind']){
  return modelSignature(getTemplate(plannerTemplates[kind]));
}

export function titleLines(title:string,maxLines=3){
  const words=title.trim().split(/\s+/),lines=[''];
  for(const word of words){const i=lines.length-1;if(lines[i]&&lines[i].length+word.length+1>24&&lines.length<maxLines)lines.push(word);else lines[i]+=(lines[i]?' ':'')+word;}
  return lines;
}
/** Deterministic proposal from the reviewed rundown, never a command to playout. */
export function plannerProject(plan:Plan,choice:PlannerTaskChoice){
  const rows=choice.rowIds.map(id=>plan.rows.find(row=>row.id===id));
  if(rows.some(row=>!row?.included)||new Set(choice.rowIds).size!==rows.length)throw new ParameterError('Sélection de programmes invalide.');
  const selected=rows.filter(row=>!!row);
  if(choice.kind==='weekly'?selected.length!==7:selected.length!==1)throw new ParameterError('Choisissez sept programmes pour le semainier, un programme pour les autres habillages.');
  if(selected.some(row=>!timeSchema.safeParse(row.time).success))throw new ParameterError('Confirmez les horaires avant de créer les habillages.');
  if(selected.some(row=>!dateSchema.safeParse(row.airDate).success))throw new ParameterError('Confirmez les dates de diffusion avant de créer les habillages.');
  const row=selected[0];
  if(selected.some(item=>!plannerRowSchema.safeParse(item).success))throw new ParameterError('Vérifiez les médias et les passages choisis avant de créer les habillages.');
  const template=getTemplate(plannerTemplates[choice.kind]),data=templateDefaults(template);
  const set=(key:string,value:FieldValue)=>{if(Object.hasOwn(template.fields,key))data[key]=value;};
  const cut=(part:string,item:PlannerRow)=>{
    if(!item.excerpt)return;
    set(`_media_${part}_start_seconds`,item.excerpt.start);set(`_media_${part}_end_seconds`,item.excerpt.end);
    set(`_media_${part}_loop`,false);
  };
  // No sample footage, test signal, sponsor or unrelated voice may cross this boundary.
  for(const [key,field]of Object.entries(template.fields)){
    if(isMediaField(key,field))data[key]='';
    if(isSequenceField(key,field))data[key]='[]';
    if(/_audio.*_enabled$/.test(key)||/_sponsor.*(?:visible|enabled)$/.test(key))set(key,false);
  }
  set('_studio_format',choice.format);
  const time=row.time.slice(0,5).replace(':','h'),day=frenchDay(row.airDate),appointment=`${day} ${time}`;
  const lines=titleLines(row.title),media=row.media||'';
  if(choice.kind==='ba'){
    set('_studio_ba_mode','simple');set('_thematique',row.category);
    for(let i=1;i<=3;i++){set(`_titre_ligne_${i}`,lines[i-1]||'');set(`_jour_${i}`,i===1?day:'');set(`_heure_${i}`,i===1?time:'');}
    set('_sous_titre_pack',row.subtitle);set('_sous_titre_visible',!!row.subtitle);set('_credit_pack','');set('_credit_visible',false);set('_inedit_visible',false);set('_mentions_visible',false);
    for(const part of ['intro','body','pack']){set(`_media_${part}_url`,media);set(`_media_${part}_start_seconds`,0);set(`_media_${part}_end_seconds`,0);set(`_media_${part}_rate`,1);cut(part,row);}
    set('_out_duration_seconds',20);
  }else if(choice.kind==='popup'){
    set('_label',appointment.toLocaleUpperCase('fr'));set('_title',titleLines(row.title,2).join('\n'));set('_subtitle',row.subtitle);
    set('_background_visible',false);set('_media_popup_url',media);cut('popup',row);
  }else if(choice.kind==='tds'){
    set('_theme',row.category);for(let i=1;i<=3;i++)set(`_titre_ligne_${i}`,lines[i-1]||'');set('_sous_titre',row.subtitle);
    set('_background_visible',!!media);set('_media_background_url',media);cut('background',row);
  }else if(choice.kind==='renvoi'){
    const two=titleLines(row.title,2);set('variant',two.length>1?'2L':'1L');set('title',two[0]);set('title2',two[1]||'');set('subtitle',row.subtitle);set('announcement',appointment.toLocaleUpperCase('fr'));set('_media_renvoi_url',media);cut('renvoi',row);
  }else if(choice.kind==='event'){
    const two=titleLines(row.title,2);set('theme',row.category);set('title_1',two[0]);set('title_2',two[1]||'');set('day',day.toLocaleUpperCase('fr'));set('time',time);set('_media_intro_url',media);set('_media_event_url',media);cut('intro',row);cut('event',row);
  }else{
    set('intro_top','CETTE');set('intro_bottom','SEMAINE');set('final_top','CETTE');set('final_bottom','SEMAINE');
    selected.forEach((item,i)=>{set(`programme_${i+1}_category`,`${frenchDay(item.airDate)} ${item.time.slice(0,5).replace(':','h')}`.toLocaleUpperCase('fr'));set(`programme_${i+1}_title`,item.title);set(`_media_programme_${i+1}_url`,item.media||'');cut(`programme_${i+1}`,item);});
    set('_media_intro_url',selected[0].media||'');set('_media_final_url',selected[6].media||'');cut('intro',selected[0]);cut('final',selected[6]);
  }
  // Explicit confirmation only. Never copy a sample voice, invent a signature,
  // or change the identity of an existing task when this preference changes.
  if(choice.signature){
    const signature=plannerSignature(choice.kind);
    if(!signature)throw new ParameterError('Ce modèle ne possède pas de signature sonore native.');
    Object.assign(data,signature);
  }
  const voice=selectedPlannerVoice(plan,choice);
  if(voice)Object.assign(data,plannerVoicePatch(choice.kind,voice,row.airDate,data));
  // A confirmed programme logo belongs to this entry, not to the whole week.
  // New drafts only: the task ledger never updates an already created project.
  if(choice.kind!=='weekly'&&row.logo){
    set('_studio_overlay_logo_url',row.logo);
    set('_studio_overlay_logo_enabled',true);
  }
  // Reordering the editorial slots must not change the week named by the project.
  const dates=selected.map(item=>item.airDate).sort(),period=dates[0]===dates.at(-1)?dates[0]:`${dates[0]} au ${dates.at(-1)}`;
  const title=(choice.kind==='weekly'?`Semainier · ${period}`:`${row.title} · ${row.airDate} ${row.time.slice(0,5)} · ${plannerLabels[choice.kind]}`)+` · ${choice.format==='tv'?'TV':choice.format==='portrait'?'4:5':'9:16'}`;
  return {template,title:title.slice(0,120),data:validateProjectData(template,data)};
}
