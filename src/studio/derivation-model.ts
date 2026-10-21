import {z} from 'zod';
import {getTemplate,templateDefaults,validateProjectData,ParameterError} from './domain';
import type {BroadcastTemplate,FieldValue,ProjectData} from './domain';
import {textStyles} from './typography-model';
import {derivedSignature} from './signature-sound';
import {announcementProjects,derivationAnnouncementSchema} from './derivation-announcements';
import type {DerivationAnnouncement,DerivationAnnouncementMetadata,DerivationAnnouncementTargetKey} from './derivation-announcements';
export {derivationAnnouncementSchema,derivationAnnouncementKeys,derivationAnnouncementDays,derivationAnnouncementFormats,normalizeAnnouncement} from './derivation-announcements';
export type {DerivationAnnouncement,DerivationAnnouncementKey,DerivationAnnouncementTargetKey,DerivationAnnouncementMetadata} from './derivation-announcements';

export const DERIVATION_MAPPING_VERSION='campaign-6';
export const recipeSourceIds=['BTV_BA_1P','BTV_Renvoi','BTV_Evenement','BTV_Semainier'] as const;
export const canDerive=(id:string)=>recipeSourceIds.some(value=>value===id);
export const MAX_DERIVATION_CHILDREN=8;
export const derivationTargets=['ba-vertical','ba-portrait','popup-1','popup-2','popup-3','popup-follow','tds','replay'] as const;
export type DerivationTarget=typeof derivationTargets[number];
export const derivationRequestSchema=z.object({
  requestId:z.uuid(),name:z.string().trim().min(1).max(120),sourceRevision:z.number().int().positive(),
  sourceTitle:z.string().trim().min(1).max(120),sourceData:z.record(z.string(),z.unknown()),
  targets:z.array(z.enum(derivationTargets)).max(MAX_DERIVATION_CHILDREN).refine(values=>new Set(values).size===values.length,'Chaque déclinaison doit être choisie une seule fois.'),
  replayUrl:z.string().max(200).optional(),
  announcements:z.array(derivationAnnouncementSchema).min(1).max(5).refine(values=>new Set(values.map(value=>value.key)).size===values.length,'Chaque annonce doit être choisie une seule fois.').optional(),
}).strict().refine(value=>{const count=value.targets.length+(value.announcements??[]).reduce((sum,item)=>sum+item.formats.length,0);return count>=1&&count<=MAX_DERIVATION_CHILDREN;},'Choisissez de une à huit déclinaisons au total.');
export type DerivationRequest=z.infer<typeof derivationRequestSchema>;
export interface DerivationSource {templateId:string;templateVersion:string;libraryVersion:string;title:string;data:ProjectData}
export interface DerivedProject {targetKey:DerivationTarget|DerivationAnnouncementTargetKey;label:string;title:string;templateId:string;templateVersion:string;libraryVersion:string;data:ProjectData;warnings:string[];announcement?:DerivationAnnouncementMetadata}
export interface DerivationChoice {key:DerivationTarget;label:string;selected:boolean;description:string}

const text=(value:FieldValue|undefined)=>typeof value==='string'?value.trim():'';
function sourceTemplate(source:DerivationSource){
  const template=getTemplate(source.templateId);
  if(!canDerive(template.id)||source.templateVersion!==template.version||source.libraryVersion!==template.libraryVersion)throw new ParameterError('Ce modèle ou cette version ne possède pas de recette de déclinaison active.');
  return template;
}
export function derivationAppointments(data:ProjectData){
  return [1,2,3].filter(n=>n===1||data._studio_ba_mode!=='simple').map(index=>({index,announcement:text(data[`_jour_${index}`]),time:text(data[`_heure_${index}`])})).filter(item=>item.announcement||item.time);
}
export function derivationChoices(data:ProjectData,templateId='BTV_BA_1P'):DerivationChoice[]{
  if(templateId!=='BTV_BA_1P')return canDerive(templateId)?[
    {key:'ba-vertical',label:'Version verticale · 9:16',selected:true,description:'Mêmes textes, médias et son ; composition adaptée aux réseaux.'},
    {key:'ba-portrait',label:'Version portrait · 4:5',selected:true,description:'Mêmes textes, médias et son ; cadrage à vérifier.'},
    ...(['BTV_Renvoi','BTV_Evenement'].includes(templateId)?[{key:'popup-follow' as const,label:'Pop-up lié · TV',selected:false,description:'Titre, média et passage choisis repris, sans fond ni son. Vérifiez le rendez-vous.'}]:[]),
  ]:[];
  const appointments=derivationAppointments(data);
  return [
    {key:'ba-vertical',label:'Bande-annonce · 9:16',selected:true,description:'Composition verticale, mêmes extraits et rendez-vous.'},
    {key:'ba-portrait',label:'Bande-annonce · 4:5',selected:true,description:'Composition portrait, mêmes extraits et rendez-vous.'},
    ...appointments.map(item=>({key:`popup-${item.index}` as DerivationTarget,label:`Pop-up · ${[item.announcement,item.time].filter(Boolean).join(' · ')}`,selected:true,description:'Vignette du programme, fond transparent et son désactivé.'})),
    ...(!appointments.length?[{key:'popup-follow' as const,label:'Pop-up · À SUIVRE',selected:false,description:'Aucun rendez-vous renseigné : libellé sans jour ni heure.'}]:[]),
    {key:'tds',label:'Tout de suite · TV',selected:false,description:'Annonce immédiate ; aucune voix annonçant un autre jour.'},
    {key:'replay',label:'Replay · TV',selected:false,description:'Une adresse HTTPS explicite est nécessaire pour le QR code.'},
  ];
}
function sourceAsset(template:BroadcastTemplate,value:FieldValue):FieldValue{
  const raw=typeof value==='string'?value:typeof value==='object'?value.url:'';
  if(!raw||raw.startsWith('/')||raw.startsWith('local-media:'))return value;
  if(raw.startsWith('blob:'))throw new ParameterError('Attendez la vérification du fichier local avant de préparer les déclinaisons.');
  const url=`/library/v${template.libraryVersion}/${template.id}/${/^img_\d+\.(?:png|jpe?g|webp)$/.test(raw)?'lib/images/':''}${raw}`;
  return typeof value==='object'?{...value,url}:url;
}
function silence(data:ProjectData){
  for(const key of Object.keys(data)){
    if(/^(?:_audio.*_enabled|_media_.*_audio_enabled)$/.test(key))data[key]=false;
    if(key.startsWith('_audio')&&key.endsWith('_url'))data[key]='';
  }
}
function body(template:BroadcastTemplate,source:ProjectData,target:ProjectData,track:'popup'|'background',warnings:string[]){
  if(Number(source._media_body_rate)!==1)throw new ParameterError('La vitesse du corps de la BA n’est pas représentable dans ce modèle. Préparez un extrait à vitesse 1×, ou choisissez seulement les versions sociales.');
  const clips=JSON.parse(String(source._media_body_sequence||'[]')) as {url:FieldValue;start:number;end:number}[];
  const selected=clips.length?'':source._media_body_url;
  if(!clips.length&&!text(typeof selected==='object'?selected.url:selected))throw new ParameterError('Choisissez un média ou un extrait pour le corps de la BA avant de créer cette déclinaison.');
  target[`_media_${track}_url`]=sourceAsset(template,selected);
  target[`_media_${track}_sequence`]=JSON.stringify(clips.map(clip=>({...clip,url:sourceAsset(template,clip.url)})));
  for(const suffix of ['start_seconds','end_seconds','loop'])target[`_media_${track}_${suffix}`]=source[`_media_body_${suffix}`];
  target[`_media_${track}_audio_enabled`]=false;
  // These engines crop natively in TV. Their social-fit fields do not change
  // that TV geometry, so copying them would falsely promise matching framing.
  if(source._media_body_fit!=='cover')warnings.push('Le cadrage « contenir » de la BA n’est pas repris par ce gabarit TV. Contrôlez le recadrage de la vignette.');
  if(source._media_body_color_space!=='auto')warnings.push('La correction colorimétrique propre à la BA n’existe pas dans ce moteur. Contrôlez le rendu de la source.');
}
function colour(source:ProjectData,target:ProjectData,template:BroadcastTemplate,key:string,warnings:string[]){
  const value=String(source._couleur_thematique);
  if(template.fields[key]?.enum?.includes(value))target[key]=value;
  else warnings.push('La palette de ce moteur est fixe : la couleur de thématique de la BA ne la remplace pas.');
}
function inheritTextIdentity(source:ProjectData,target:ProjectData,format:string){
  const styles=textStyles(source),sourceFormat=String(source._studio_format||'tv');let inherited=false;
  for(const [key,style]of Object.entries(styles)){
    if(!key.startsWith(sourceFormat+':'))continue;
    const destination=format+key.slice(sourceFormat.length);if(Object.hasOwn(styles,destination))continue;
    const identity=Object.fromEntries(Object.entries(style).filter(([property])=>['font','fontName','bold','italic','case','colour'].includes(property)));
    if(Object.keys(identity).length){styles[destination]=identity;inherited=true;}
  }
  if(inherited)target._studio_typography=JSON.stringify(styles);
  return inherited;
}
function immediateAnnouncementProjects(original:BroadcastTemplate,title:string,source:ProjectData,announcements:DerivationAnnouncement[]):DerivedProject[]{
  return announcements.flatMap(announcement=>announcement.formats.map(format=>{
    const template=getTemplate('BTV_BA_TDS'),result=templateDefaults(template),warnings:string[]=[];
    const signature=derivedSignature(source,template);Object.assign(result,signature.patch);warnings.push(signature.warning);
    result._audio_voice_enabled=false;result._audio_voice_url='';result._studio_format=format;
    for(const n of [1,2,3])result[`_titre_ligne_${n}`]=source[`_titre_ligne_${n}`];
    result._theme=source._thematique;result._sous_titre=source._sous_titre_visible?source._sous_titre_pack:'';
    result._background_visible=true;body(original,source,result,'background',warnings);
    result._sponsor_visible=false;result._sponsor_logo='';
    if(source._sponsor_visible&&!source._sponsor_original&&source._sponsor_url){result._sponsor_visible=true;result._sponsor_logo=sourceAsset(original,source._sponsor_url);}
    else if(source._sponsor_visible)warnings.push('Les sponsors graphiques d’origine de la BA ne sont pas transférés. Aucun logo d’exemple n’est ajouté.');
    colour(source,result,template,'_color_artwork',warnings);
    if(inheritTextIdentity(source,result,format))warnings.push('Police, graisse, italique, casse et couleur reprises. Les tailles et positions restent celles du modèle Tout de suite.');
    const voice:DerivationAnnouncementMetadata['voice']=announcement.voice.mode==='profile'?{...announcement.voice,status:'pending'}:{mode:announcement.voice.mode,status:announcement.voice.mode};
    if(voice.status==='pending')warnings.push('Voix « Tout de suite » à préparer : seule la piste voix reste coupée tant que le passage attesté n’est pas associé.');
    else warnings.push('Sans voix, choix explicite : la signature sonore reste indépendante.');
    warnings.push('Moteur Tout de suite dédié : plein cadre initial puis cartouche programme, sans jour ni horaire.');
    warnings.push('Contrôlez le titre, le cadrage et l’écoute avant utilisation.');
    const label=`Tout de suite · ${format==='tv'?'TV':format==='portrait'?'4:5':'9:16'}`;
    return {targetKey:`ba-now-${format}` as DerivationAnnouncementTargetKey,label,title:`${title.slice(0,Math.max(1,117-label.length))} — ${label}`.slice(0,120),
      templateId:template.id,templateVersion:template.version,libraryVersion:template.libraryVersion,data:validateProjectData(template,result),warnings,
      announcement:{key:'now',day:'Tout de suite',time:'',format,voice} satisfies DerivationAnnouncementMetadata};
  }));
}

/** The server and the confirmation UI use this same explicit, versioned map.
 * It accepts only the source snapshot: arbitrary child payloads are never trusted. */
export function deriveProjects(source:DerivationSource,targets:DerivationTarget[],replayUrl='',announcements:DerivationAnnouncement[]=[]):DerivedProject[]{
  const original=sourceTemplate(source),data=validateProjectData(original,source.data);
  const parsed=z.array(derivationAnnouncementSchema).max(5).safeParse(announcements);
  if(!parsed.success)throw new ParameterError(parsed.error.issues[0]?.message??'Les annonces ou leurs formats sont invalides.');
  const count=targets.length+parsed.data.reduce((sum,item)=>sum+item.formats.length,0);
  if(count<1||count>MAX_DERIVATION_CHILDREN||new Set(parsed.data.map(item=>item.key)).size!==parsed.data.length||new Set(targets).size!==targets.length||targets.some(key=>!derivationTargets.includes(key)))throw new ParameterError('Choisissez de une à huit déclinaisons distinctes.');
  if(original.id!=='BTV_BA_1P'){
    if(announcements.length)throw new ParameterError('Les cinq annonces vocales nécessitent le modèle BA ; aucun horaire ne sera inventé pour cet élément.');
    const choices=derivationChoices(data,original.id);
    return targets.map(targetKey=>{
      const choice=choices.find(item=>item.key===targetKey);if(!choice)throw new ParameterError('Cette recette ne convient pas au modèle source.');
      const warnings=['Brouillon indépendant : les changements ultérieurs de la source ne sont pas propagés.','Vérifiez les textes, le cadrage et le son avant utilisation.'];
      let template=original,result:ProjectData={...data};
      if(targetKey==='popup-follow'){
        template=getTemplate('BTV_PopUp');result=templateDefaults(template);silence(result);result._background_visible=false;result._media_background_url='';result._media_background_sequence='[]';
        const event=original.id==='BTV_Evenement';
        result._title=[data[event?'title_1':'title'],data[event?'title_2':'title2']].filter(Boolean).join('\n');
        result._label=event?[data.day,data.time].filter(Boolean).join(' · '):String(data.announcement||'À SUIVRE');
        result._subtitle=String(data[event?'theme':'subtitle']||'');
        const track=event?'event':'renvoi',media=data[`_media_${track}_url`];if(!media)throw new ParameterError('Choisissez le média principal avant de préparer le pop-up lié.');
        result._media_popup_url=sourceAsset(original,media);result._media_popup_sequence='[]';
        const start=Number(data[`_media_${track}_start_seconds`]??0),end=Number(data[`_media_${track}_end_seconds`]??0);
        result._media_popup_start_seconds=start;result._media_popup_end_seconds=end;
        // The AE adapter holds the last selected image after an explicit cut.
        // Carry that behavior too; looping would silently repeat a short passage.
        const trimmed=start!==0||end!==0;
        if(trimmed)result._media_popup_loop=false;
        warnings.push(trimmed?'Pop-up transparent et silencieux ; passage choisi conservé, sans boucle. À sa fin, la dernière image reste affichée.':'Pop-up transparent et silencieux ; aucun passage défini, le média commence au début du fichier. Ajustez-le si nécessaire.');
      }else{
        result._studio_format=targetKey==='ba-vertical'?'vertical':'portrait';inheritTextIdentity(data,result,String(result._studio_format));
        // Resolve source-relative assets before recording a portable child.
        for(const [key,value]of Object.entries(result))if(key.endsWith('_url'))result[key]=sourceAsset(original,value);
      }
      return {targetKey,label:choice.label,title:`${source.title.slice(0,85)} — ${choice.label}`.slice(0,120),templateId:template.id,templateVersion:template.version,libraryVersion:template.libraryVersion,data:validateProjectData(template,result),warnings};
    });
  }
  const choices=derivationChoices(data),appointments=derivationAppointments(data),joined=[1,2,3].map(n=>text(data[`_titre_ligne_${n}`])).filter(Boolean).join('\n');
  const existing=targets.map(targetKey=>{
    const choice=choices.find(item=>item.key===targetKey);if(!choice)throw new ParameterError('Ce rendez-vous ne fait pas partie des annonces visibles de la BA.');
    const warnings:string[]=[];
    let template=original,result:ProjectData;
    if(targetKey==='ba-vertical'||targetKey==='ba-portrait'){
      result={...data,_studio_format:targetKey==='ba-vertical'?'vertical':'portrait'};
      const inherited=inheritTextIdentity(data,result,String(result._studio_format));
      warnings.push('Textes, extraits et son conservés. Contrôlez le cadrage et la lisibilité dans ce format.');
      if(inherited)warnings.push('Police, graisse, italique, casse et couleur repris sans écraser vos styles sociaux existants. Tailles et positions gardent leur réglage propre au format.');
    }else{
      template=getTemplate(targetKey.startsWith('popup-')?'BTV_PopUp':targetKey==='tds'?'BTV_BA_TDS':'BTV_Passerelle_Replay');
      result=templateDefaults(template);silence(result);
      if(!joined)throw new ParameterError('Renseignez le titre de la BA avant de créer un élément lié.');
      if(targetKey.startsWith('popup-')){
        const appointment=appointments.find(item=>`popup-${item.index}`===targetKey);
        result._title=joined;result._label=appointment?[appointment.announcement,appointment.time].filter(Boolean).join(' · '):'À SUIVRE';
        result._subtitle=data._sous_titre_visible?data._sous_titre_pack:'';
        result._background_visible=false;result._media_background_url='';result._media_background_sequence='[]';
        result._out_mode='duration';result._out_duration_seconds=12;
        colour(data,result,template,'_color_panel',warnings);body(original,data,result,'popup',warnings);
        if(appointment&&(!appointment.announcement||!appointment.time))warnings.push('Ce rendez-vous est incomplet ; seuls les éléments renseignés sont repris dans le libellé.');
      }else if(targetKey==='tds'){
        const signature=derivedSignature(data,template);Object.assign(result,signature.patch);warnings.push(signature.warning);
        for(const n of [1,2,3])result[`_titre_ligne_${n}`]=data[`_titre_ligne_${n}`];
        result._theme=data._thematique;result._sous_titre=data._sous_titre_visible?data._sous_titre_pack:'';
        result._background_visible=true;body(original,data,result,'background',warnings);
        result._sponsor_visible=false;result._sponsor_logo='';
        if(data._sponsor_visible&&!data._sponsor_original&&data._sponsor_url){result._sponsor_visible=true;result._sponsor_logo=sourceAsset(original,data._sponsor_url);}
        else if(data._sponsor_visible)warnings.push('Les sponsors graphiques d’origine de la BA ne sont pas transférés. Aucun logo d’exemple n’est ajouté.');
        colour(data,result,template,'_color_artwork',warnings);
      }else{
        let url:URL;try{url=new URL(replayUrl);}catch{throw new ParameterError('Renseignez l’adresse HTTPS du replay avant de choisir cette sortie.');}
        if(url.protocol!=='https:'||url.username||url.password)throw new ParameterError('Le replay nécessite une adresse HTTPS sans identifiants.');
        result._title=joined;result._replay_url=replayUrl;
        colour(data,result,template,'_color',warnings);
      }
      if(targetKey!=='tds')warnings.push('Son désactivé : la voix, le jingle et les timings audio de la BA ne sont pas transférés.');
      warnings.push('Le gabarit et la mise en forme du modèle cible sont conservés ; ses textes restent modifiables.');
      if(data._credit_visible)warnings.push('Le crédit de la BA n’a pas de champ équivalent et n’est pas repris.');
    }
    return {targetKey,label:choice.label,title:`${source.title.slice(0,Math.max(1,117-choice.label.length))} — ${choice.label}`.slice(0,120),templateId:template.id,templateVersion:template.version,libraryVersion:template.libraryVersion,data:validateProjectData(template,result),warnings};
  });
  const immediate=parsed.data.filter(item=>item.key==='now'),scheduled=parsed.data.filter(item=>item.key!=='now');
  return [...existing,...announcementProjects(original,source.title,data,scheduled),...immediateAnnouncementProjects(original,source.title,data,immediate)];
}
