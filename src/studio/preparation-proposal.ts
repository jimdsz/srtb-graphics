import {validateProjectData} from './domain';
import type {BroadcastTemplate,FieldValue,ProjectData} from './domain';
import {programmeDataSchema,voiceDataSchema} from './preparation-profile-model';
import type {PreparationProfile,ProgrammeData,VoiceData} from './preparation-profile-model';

export interface ProgrammeTarget {id:string;label:string;title:string[];day?:string;time?:string}
export interface PreparationProposal {name:string;baseline:ProjectData;patch:ProjectData;warnings:string[]}
export interface AppliedPreparation {before:ProjectData;patch:ProjectData}
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const announcementText=(value:unknown)=>String(value??'').trim().replace(/\s+/g,' ').toLocaleLowerCase('fr-FR');
function appointmentTime(value:unknown){
  const compact=String(value??'').replace(/\s+/g,'').toLowerCase(),match=/^(\d{1,2})[:h](\d{2})$/.exec(compact);
  return match?`${match[1].padStart(2,'0')}:${match[2]}`:compact;
}
/** Explicit semantic mappings, not guesses from the names of arbitrary fields. */
export function programmeTargets(template:BroadcastTemplate):ProgrammeTarget[]{
  const targets:Record<string,ProgrammeTarget[]>={
    BTV_BA_1P:[{id:'main',label:'Programme annoncé',title:['_titre_ligne_1','_titre_ligne_2','_titre_ligne_3']}],
    BTV_BA_TDS:[{id:'main',label:'Programme annoncé',title:['_titre_ligne_1','_titre_ligne_2','_titre_ligne_3']}],
    BTV_BA_TDS_SUIVI_DE:[1,2].map(n=>({id:String(n),label:`Programme ${n}`,title:[1,2,3].map(line=>`_p${n}_titre_ligne_${line}`)})),
    BTV_PopUp:[{id:'main',label:'Titre du pop-up',title:['_title']}],
    BTV_Ce_Soir:[1,2,3].map(n=>({id:String(n),label:`Programme ${n}`,title:[`_title_${n}`],time:`_time_${n}`})),
    BTV_Relais_Antenne:[{id:'current',label:'Programme en cours',title:['_current_title']},{id:'next',label:'Programme suivant',title:['_next_title'],time:'_next_time'}],
    BTV_Passerelle_Replay:[{id:'main',label:'Programme du replay',title:['_title']}],
    BTV_Renvoi:[{id:'main',label:'Programme rappelé',title:['title','title2']}],
    BTV_Evenement:[{id:'main',label:'Événement annoncé',title:['title_1','title_2'],day:'day',time:'time'}],
    BTV_Semainier:[1,2,3,4,5,6,7].map(n=>({id:String(n),label:`Programme ${n}`,title:[`programme_${n}_title`]})),
  };
  return (targets[template.id]||[]).filter(target=>target.title.every(key=>key in template.fields));
}
export function voicePatch(template:BroadcastTemplate,voice:VoiceData):ProjectData{
  const checked=voiceDataSchema.parse(voice);
  const bounds=template.id==='BTV_BA_1P'?['_audio_voice_in_seconds','_audio_voice_out_seconds']:['_audio_voice_start_seconds','_audio_voice_end_seconds'];
  const keys=['_audio_voice_url','_audio_voice_enabled',...bounds];
  if(!keys.every(key=>key in template.fields))throw Error('Ce modèle ne possède pas de piste de voix annonce compatible. Aucun accompagnement audio ne sera remplacé.');
  return {_audio_voice_url:checked.source,_audio_voice_enabled:true,[bounds[0]]:checked.start,[bounds[1]]:checked.end};
}
function finish(template:BroadcastTemplate,current:ProjectData,patch:ProjectData,name:string,warnings:string[]):PreparationProposal{
  const validated=validateProjectData(template,{...current,...patch},true);
  return {name,baseline:{...current},patch:Object.fromEntries(Object.keys(patch).filter(key=>!same(current[key],validated[key])).map(key=>[key,validated[key]])),warnings};
}
export function proposeProgramme(template:BroadcastTemplate,current:ProjectData,name:string,input:ProgrammeData,targetId:string,voice?:VoiceData):PreparationProposal{
  const programme=programmeDataSchema.parse(input),target=programmeTargets(template).find(value=>value.id===targetId);
  if(!target)throw Error('Choisissez explicitement le programme à remplacer dans ce modèle.');
  const patch:ProjectData={},warnings:string[]=[];
  target.title.forEach((key,index)=>{patch[key]=index===0?programme.title:'';});
  if(target.title.length>1)warnings.push('Le titre complet est placé sur la première ligne ; les lignes suivantes sont vidées. Ajustez les retours à la ligne après application.');
  const first=programme.appointments[0];
  if(template.id==='BTV_BA_1P'){
    const capacity=current._studio_ba_mode==='simple'?1:3;
    programme.appointments.slice(0,capacity).forEach((appointment,index)=>{const n=index+1;patch[`_jour_${n}`]=appointment.announcement;patch[`_heure_${n}`]=appointment.time.replace(':','h');});
    if(programme.appointments.length>capacity)warnings.push('Les rendez-vous supplémentaires ne sont pas repris en mode bande-annonce simple.');
    if(programme.appointments.length<capacity)warnings.push('Les autres rendez-vous du brouillon sont conservés : contrôlez-les avant export.');
    if(first&&(announcementText(first.announcement)!==announcementText(current._jour_1)||appointmentTime(first.time)!==appointmentTime(current._heure_1)))patch._audio_voice_enabled=false;
  }else if(first&&target.time){patch[target.time]=first.time.replace(':','h');if(target.day)patch[target.day]=first.announcement;else warnings.push('Seul le premier horaire est repris. Le modèle ne possède pas de champ d’annonce de jour pour ce programme.');}
  else if(programme.appointments.length)warnings.push('Ce modèle n’a pas de champ de rendez-vous compatible : les annonces et horaires ne sont pas repris.');
  const colourNames:Record<string,string>={'#f0b900':'or','#007300':'vert','#eb1905':'rouge'};
  const colour=colourNames[programme.palette[0]],colourKey:Record<string,string>={BTV_BA_1P:'_couleur_thematique',BTV_PopUp:'_color_panel',BTV_Ce_Soir:'_color',BTV_Relais_Antenne:'_color',BTV_Passerelle_Replay:'_color'};
  const field=colourKey[template.id];
  if(colour&&field&&template.fields[field]?.enum?.includes(colour))patch[field]=colour;
  else warnings.push('La première couleur de la fiche n’est pas proposée par ce modèle ; sa couleur actuelle est conservée.');
  if(programme.palette.length>1)warnings.push('Les autres couleurs restent dans la fiche ; elles ne remplacent pas automatiquement les volets ou textes de la charte.');
  if(programme.logo)warnings.push('Le logo reste dans la fiche : aucun champ « logo programme » compatible. Les sponsors ne sont pas modifiés.');
  if(voice){
    if(template.id==='BTV_BA_1P'&&voice.cue.kind==='announcement'&&announcementText(voice.cue.value)!==announcementText(first?.announcement||current._jour_1))throw Error('La voix épinglée annonce un autre jour. Corrigez la fiche avant de la proposer.');
    if(template.id==='BTV_BA_1P'&&voice.cue.kind==='time'&&appointmentTime(voice.cue.value)!==appointmentTime(first?.time||current._heure_1))throw Error('La voix épinglée annonce un autre horaire. Corrigez la fiche avant de la proposer.');
    try{Object.assign(patch,voicePatch(template,voice));}catch(error){warnings.push(error instanceof Error?error.message:String(error));}
  }
  return finish(template,current,patch,name,warnings);
}
export function proposePreset(template:BroadcastTemplate,current:ProjectData,profile:PreparationProfile):PreparationProposal{
  if(profile.kind!=='preset'||profile.archived)throw Error('Sélectionnez un réglage favori actif.');
  if(profile.template_id!==template.id||profile.template_version!==template.version||profile.library_version!==template.libraryVersion)throw Error('Ce réglage favori appartient à un autre modèle ou à une autre version. Aucune conversion automatique n’est effectuée.');
  return finish(template,current,validateProjectData(template,profile.data),profile.name,['Tous les réglages différents du modèle sont proposés, y compris les sources média. Les fichiers locaux devront être reconnectés sur ce poste.']);
}
export function proposeVoice(template:BroadcastTemplate,current:ProjectData,name:string,voice:VoiceData):PreparationProposal{
  if(template.id==='BTV_BA_1P'&&voice.cue.kind==='announcement'&&announcementText(voice.cue.value)!==announcementText(current._jour_1))throw Error('Cette voix annonce un autre jour que le brouillon. Modifiez d’abord le rendez-vous.');
  if(template.id==='BTV_BA_1P'&&voice.cue.kind==='time'&&appointmentTime(voice.cue.value)!==appointmentTime(current._heure_1))throw Error('Cette voix annonce un autre horaire que le brouillon. Modifiez d’abord le rendez-vous.');
  return finish(template,current,voicePatch(template,voice),name,['La source et les points d’entrée/sortie sont repris. Les niveaux et décalages de la piste restent ceux du brouillon. Contrôlez leur synchronisation dans l’aperçu.']);
}
export function applyPreparation(current:ProjectData,proposal:PreparationProposal,status:string,archived:boolean){
  if(status!=='draft'||archived)throw Error('L’application est réservée à un brouillon actif. Dupliquez ce projet pour préparer une nouvelle version.');
  if(!same(current,proposal.baseline))throw Error('Les réglages ont changé depuis la comparaison. Préparez une nouvelle proposition.');
  return {...current,...proposal.patch};
}
export function undoPreparation(current:ProjectData,applied:AppliedPreparation,status:string,archived:boolean){
  if(status!=='draft'||archived)throw Error('L’annulation est réservée à un brouillon actif.');
  if(Object.keys(applied.patch).some(key=>!same(current[key],applied.patch[key])))throw Error('Un champ appliqué a été retouché depuis. Annulation refusée pour préserver vos modifications.');
  const restored={...current};
  for(const key of Object.keys(applied.patch)){
    if(Object.hasOwn(applied.before,key))restored[key]=applied.before[key];else delete restored[key];
  }
  return restored;
}
export function preparationValue(value:FieldValue|undefined):string{return value===undefined?'Non renseigné':typeof value==='object'?value.name:typeof value==='boolean'?value?'Activé':'Désactivé':String(value)||'Vide';}
