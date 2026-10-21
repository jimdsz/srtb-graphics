import { useEffect,useId, useRef, useState } from 'react';
import type { BroadcastField, BroadcastTemplate, FieldValue, MediaAsset, ProjectData } from './domain';
import { isMediaField,isSequenceField } from './domain';
import MediaSelect from './MediaSelect';
import {mediaFieldInactive,sequenceLimit} from './media-selection';
import MediaTrim from './MediaTrim';
import MontageEditor from './MontageEditor';
import {parseMontage} from './montage-model';
import MediaCrop from './MediaCrop';
import ImageSize from './ImageSize';
import {currentCropMotion,cropMotionMatches} from './crop-motion';
import {activateMedia,replaceMedia} from './media-trim';
import PresentationSettings from './PresentationSettings';
import SoundSettings from './SoundSettings';
import VoiceTimingSettings from './VoiceTimingSettings';
import {voiceSourcePatch,voiceTimingFieldNames} from './voice-timing-model';
import {soundFieldNames} from './sound-level-model';
import type {overlayLogoGeometry} from './logo-model';
import PlacementSettings from './PlacementSettings';
import ReplaySettings from './ReplaySettings';
import {presentation} from './presentation';
import {preparationAdvice} from './preparation-advice';
import TextSettings from './TextSettings';
import TypographySettings from './TypographySettings';
import LogoSettings from './LogoSettings';
import AppointmentSettings from './AppointmentSettings';
import {hasOverlayLogo,nativeLogoFieldNames,nativeLogoSlots} from './native-logo-settings';
import {selectionCategory,revealInspector} from './element-selection';
import {textFields} from './typography-model';
import {inspectorQuery,inspectorSearchPanels,matchesInspectorField} from './inspector-search';
import {preservePortraitLayout} from './social-portrait-layout';
import {renvoiSignageAvailable,renvoiSignageKey} from './renvoi-signage';
import {baSocialDirect,baSocialUnusedField} from './ba-social-direct';
import CeSoirBackgroundSettings from './CeSoirBackgroundSettings';
import {CE_SOIR_BACKGROUND,ceSoirBackground} from './ce-soir-background';
import {ChevronDown,Clock3,Image,Palette,Search,Shapes,SlidersHorizontal,Type,Volume2,X} from 'lucide-react';
import './production-controls.css';
import {HelpBubble} from './GraphicsHelp';

const categories=['Textes et dates','Médias','Son','Logos','Graphisme','Durée'] as const;
const categoryIcons={'Textes et dates':Type,'Médias':Image,'Son':Volume2,'Logos':Shapes,'Graphisme':Palette,'Durée':Clock3};
const plain=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('fr');
function category(section:string){const value=plain(section);return /audio|son /.test(value)?'Son':/media/.test(value)?'Médias':/charte|couleur|fond|option|transition|signaletique/.test(value)?'Graphisme':/sortie|synchronisation|^diffusion$/.test(value)?'Durée':'Textes et dates';}
// Some original models predate x-section metadata. Give those controls a real
// home in the inspector without changing their keys, defaults or save format.
function sectionOf(name:string,field:BroadcastField){
  if(field['x-section'])return field['x-section'];
  if(name.startsWith('_audio_voice'))return 'Son · voix off';
  if(name.startsWith('_audio'))return 'Son · habillage';
  if(name.startsWith('_color')||name.startsWith('_couleur'))return 'Couleurs de la charte';
  if(name.includes('sponsor'))return 'Options du sponsor';
  if(name.startsWith('_media'))return 'Médias';
  if(name.startsWith('_out'))return 'Sortie automatique';
  return 'Textes du modèle';
}
function source(value:FieldValue|undefined){return typeof value==='object'?value.url:typeof value==='string'?value:'';}
function Field({name,field,value,media,onChange,onPatch,template,data}: {name:string;field:BroadcastField;value:FieldValue;media:MediaAsset[];onChange:(v:FieldValue)=>void;onPatch:(patch:ProjectData)=>void;template:BroadcastTemplate;data:ProjectData}) {
  const id=useId(),label=field.title||name;
  const prefix=name.replace(/_url$/,''),voice=template.id==='BTV_BA_1P'&&name==='_audio_voice_url',startKey=`${prefix}_${voice?'in':'start'}_seconds`,endKey=`${prefix}_${voice?'out':'end'}_seconds`,sequenceKey=`${prefix}_sequence`;
  const trim=isMediaField(name,field)&&startKey in template.fields&&endKey in template.fields;
  const sequenceActive=!!String(data[sequenceKey]||'').trim()&&(parseMontage(data[sequenceKey])?.length!==0);
  const cropKind=name.slice(7,-4),cropMotion=currentCropMotion(data,cropKind),animatedCrop=!!cropMotion&&cropMotionMatches(data,cropKind,cropMotion);
  if(field.type==='boolean')return <label className="field toggle"><span>{label}</span><input type="checkbox" checked={value===true} onChange={e=>onChange(e.target.checked)}/>{field.description?<small>{field.description}</small>:null}</label>;
  return <div className="field" data-inspector-field={name}>{isSequenceField(name,field)?(field.title?.includes('—')?<strong>{field.title.split('—')[0].trim()}</strong>:null):<label htmlFor={id}>{label}</label>}
    {isSequenceField(name,field)?<MontageEditor id={id} name={name} value={String(value)} media={media} onPatch={onPatch} primary={data[name.replace(/_sequence$/,'_url')]||''} start={Number(data[name.replace(/_sequence$/,'_start_seconds')]||0)} end={Number(data[name.replace(/_sequence$/,'_end_seconds')]||0)} limit={sequenceLimit(template)} template={template} data={data}/>:
    isMediaField(name,field)?<MediaSelect id={id} value={value} field={field} media={media} onChange={onChange} onRange={trim?range=>onPatch({[startKey]:range.start,[endKey]:range.end}):undefined} emptyLabel={template.id==='BTV_PopUp'&&name==='_media_background_url'?'Aucun média — fond transparent':undefined}/>:
    field.enum?<select id={id} value={String(value)} onChange={e=>onChange(e.target.value)}>{field.enum.map(v=><option key={v} value={v}>{field['x-enumLabels']?.[v]||v}</option>)}</select>:
    ['number','integer'].includes(field.type||'')?<input id={id} type="number" value={typeof value==='number'?value:0} min={field.minimum} max={field.maximum} step={field.multipleOf||(field.type==='integer'?1:'any')} onChange={e=>onChange(Number(e.target.value))}/>:
    /title|titre|programme|program/.test(name)||typeof field.default==='string'&&field.default.includes('\n')?<textarea id={id} rows={3} value={typeof value==='string'?value:''} maxLength={field.maxLength??2048} onChange={e=>onChange(e.target.value)}/>:
    <input id={id} type={name==='_replay_url'?'url':'text'} value={typeof value==='string'?value:''} maxLength={field.maxLength??2048} onChange={e=>onChange(e.target.value)}/>}
    {isMediaField(name,field)&&mediaFieldInactive(data,name)?<div className="inactive-media"><strong>{name==='_media_background_url'?(ceSoirBackground(data)?'Média masqué — fond uni':'Fond masqué — mode transparent'):'Piste désactivée'}</strong><small>Le fichier est conservé, mais ne s’affiche pas dans l’habillage.</small><button type="button" onClick={()=>onPatch(template.id==='BTV_Ce_Soir'&&name==='_media_background_url'?{[CE_SOIR_BACKGROUND]:'original'}:activateMedia(name))}>{name==='_media_background_url'?'Afficher ce média en fond':'Activer cette piste'}</button></div>:null}
    {isMediaField(name,field)&&name==='_media_background_url'&&template.id==='BTV_PopUp'&&!mediaFieldInactive(data,name)?<button type="button" onClick={()=>onPatch({_background_visible:false})}>Retirer le fond — garder la transparence</button>:null}
    {trim&&!sequenceActive?<MediaTrim value={value} module={template.module} start={Number(data[startKey]||0)} end={Number(data[endKey]||0)} onChange={range=>onPatch({[startKey]:range.start,[endKey]:range.end})}/>:null}
    {name.startsWith('_media_')&&name.endsWith('_url')&&!sequenceActive?<ImageSize value={value} field={name} data={data} onPatch={onPatch}/>:null}
    {voice?<small>Écoutez la voix avant de l’activer : le jour annoncé doit correspondre au texte. Le même extrait est joué à l’entrée et au carton final.</small>:null}
    {trim&&sequenceActive?<small>Cette piste utilise son montage. Choisissez les extraits dans le montage ci-dessous.</small>:null}
    {name.startsWith('_media_')&&name.endsWith('_url')&&presentation(data)!=='tv'&&!sequenceActive?<MediaCrop value={value} template={template} kind={name.slice(7,-4)} data={data} start={Number(data[startKey]||0)} onPatch={onPatch}/>:null}
    {name.startsWith('_media_')&&name.endsWith('_url')&&presentation(data)!=='tv'&&!sequenceActive?<div className="social-crop"><label>Cadrage dans le format social<select value={String(data[`_studio_${cropKind}_fit`]||'cover')} onChange={e=>onPatch({[`_studio_${cropKind}_fit`]:e.target.value})}><option value="cover">Remplir le cadre · recadrer</option><option value="contain">Image entière · sans coupe</option></select></label>{animatedCrop?<small>Ce cadrage utilise des repères. Ouvrez « Cadrer pour les réseaux » pour les déplacer ou revenir à un cadrage fixe.</small>:(['x','y'] as const).map(axis=><label key={axis}>{axis==='x'?'Position horizontale':'Position verticale'}<input type="range" min="0" max="100" step="1" value={Number(data[`_studio_${cropKind}_${axis}`]??50)} onChange={e=>onPatch({[`_studio_${cropKind}_${axis}`]:Number(e.target.value)})}/></label>)}</div>:null}
    {field.description&&!isSequenceField(name,field)?<small>{field.description}</small>:null}
  </div>;
}
export default function Fields({template,data,media,onChange,disabled=false,onChooseTeamVoice,teamVoiceDisabled=false,logoLayout,selectedElement}:{template:BroadcastTemplate;data:ProjectData;media:MediaAsset[];onChange:(v:ProjectData)=>void;disabled?:boolean;onChooseTeamVoice?:()=>void;teamVoiceDisabled?:boolean;logoLayout?:ReturnType<typeof overlayLogoGeometry>;selectedElement?:{field:string;serial:number}}) {
  const [query,setQuery]=useState(''),[selectedCategory,setSelectedCategory]=useState<(typeof categories)[number]>('Textes et dates'),[typographyOpen,setTypographyOpen]=useState(false);
  const searchInput=useRef<HTMLInputElement>(null);
  const panel=useRef<HTMLDivElement>(null),revealed=useRef<typeof selectedElement>(undefined);
  useEffect(()=>{if(selectedElement){setQuery('');setSelectedCategory(selectionCategory(template,selectedElement.field));if(textFields(template).some(([field])=>field===selectedElement.field))setTypographyOpen(true);}},[selectedElement,template]);
  useEffect(()=>{
    if(!selectedElement||revealed.current===selectedElement||selectedCategory!==selectionCategory(template,selectedElement.field)||query)return;
    const text=textFields(template).some(([field])=>field===selectedElement.field);
    const target=panel.current?.querySelector<HTMLElement>(text?'.typography-editor':`[data-inspector-field="${CSS.escape(selectedElement.field)}"]`);
    if(target){revealed.current=selectedElement;return revealInspector(target);}
  },[selectedElement,selectedCategory,query,template]);
  const latest=useRef(data);latest.current=data;
  const backgroundId=useId(),popup=template.id==='BTV_PopUp';
  const logoFields=new Set([...nativeLogoFieldNames(template),...Object.keys(template.fields).filter(key=>key.startsWith('_studio_overlay_logo_'))]),hasLogos=hasOverlayLogo(template)||nativeLogoSlots(template).length>0;
  const soundFields=new Set([...voiceTimingFieldNames(template),...soundFieldNames(template)]);
  const searching=!!inspectorQuery(query),searchPanels=inspectorSearchPanels(template,data,query);
  const showPanel=(name:keyof typeof searchPanels,home:(typeof categories)[number])=>searchPanels[name]&&(searching||selectedCategory===home);
  const advice=preparationAdvice(template,data);
  function change(patch:ProjectData){const next=preservePortraitLayout(template.id,latest.current,{...latest.current,...patch});latest.current=next;onChange(next);}
  const groups=new Map<string,[string,BroadcastField][]>();
  for(const [name,field]of Object.entries(template.fields)){
    if(baSocialDirect(template.id,data)&&baSocialUnusedField(name))continue;
    if(renvoiSignageKey(name)&&!renvoiSignageAvailable(template,data))continue;
    if(logoFields.has(name)||soundFields.has(name))continue;
    if(template.id==='BTV_Passerelle_Replay'&&name==='_replay_url')continue;
    if(presentation(data)!=='tv'&&(/^_media_.*_(fit|color_space)$/.test(name)||['_color_shutter_1','_color_shutter_2','_intro_reveal','_followup_reveal'].includes(name)))continue;
    if(name.startsWith('_studio_')||template.id==='BTV_BA_1P'&&data._studio_ba_mode==='simple'&&/^_(jour|heure)_[123]$/.test(name))continue;
    if(popup&&name==='_background_visible')continue;
    // A montage owns its sources and marks. Keep the saved primary untouched
    // and avoid offering a selector that silently clears the assembled clips.
    const sequenceKey=name.replace(/_(url|start_seconds|end_seconds)$/,'_sequence');
    if(sequenceKey!==name&&sequenceKey in template.fields&&parseMontage(data[sequenceKey])?.length)continue;
    if(searching&&!matchesInspectorField(query,name,field,sectionOf(name,field),renvoiSignageKey(name)?'masquer retirer pictogrammes icônes':''))continue;
    const section=sectionOf(name,field);
    // Weekly programmes mix editorial and media controls in one source section.
    // Keep their titles together, but make every media available under Médias.
    if(!searching&&(name.startsWith('_media_')?'Médias':category(section))!==selectedCategory)continue;
    const displayedField=baSocialDirect(template.id,data)&&name==='_out_duration_seconds'?{...field,minimum:.04,title:'Durée des extraits (s)',description:'Fin directe, sans animation ajoutée.'}:field;
    groups.set(section,[...(groups.get(section)||[]),[name,displayedField]]);
  }
  const visibleGroups=[...groups].sort(([a],[b])=>Number(b==='Signalétique')-Number(a==='Signalétique'));
  const resultCount=visibleGroups.reduce((count,[,entries])=>count+entries.length,0)+Object.values(searchPanels).filter(Boolean).length;
  return <div className="fields-panel" ref={panel}>
    {advice.length?<details className="field-section preparation-advice"><summary>À vérifier <span>{advice.length}</span></summary><p className="small muted">Contrôles des réglages, sans analyse ni envoi de vos médias. Aucune correction n’est appliquée sans votre choix.</p>{advice.map(item=><div key={item.id} className="field"><p>{item.message}</p><button disabled={disabled} onClick={()=>item.patch?change(item.patch):setQuery(item.query)}>{item.action||'Voir les réglages'}</button></div>)}</details>:null}
    <PresentationSettings template={template} data={data} onChange={change} disabled={disabled}/>
    {baSocialDirect(template.id,data)?<p className="small muted">Début et fin directs sur les extraits. Sans animation ni signature sonore ; les réglages TV sont conservés.</p>:null}
    <div className="inspector-toolbox"><label className="search inspector-search"><span className="visually-hidden">Rechercher un réglage</span><Search size={15} aria-hidden="true"/><input ref={searchInput} type="search" placeholder="Rechercher un réglage…" value={query} onChange={e=>setQuery(e.target.value)}/></label>
    {!searching?<nav className="settings-categories" aria-label="Familles de réglages">{categories.filter(value=>value!=='Logos'||hasLogos).map(value=>{const Icon=categoryIcons[value];return <button type="button" key={value} aria-label={value} aria-pressed={selectedCategory===value} onClick={()=>setSelectedCategory(value)}><Icon size={17} aria-hidden="true"/><span>{value==='Textes et dates'?'Textes':value}</span></button>;})}</nav>:<p className="small search-results" role="status">{resultCount} résultat{resultCount>1?'s':''}<button type="button" onClick={()=>{setQuery('');searchInput.current?.focus();}}><X size={14} aria-hidden="true"/>Effacer la recherche</button></p>}</div>
    {!searching?<div className="inspector-help-row"><span>{selectedCategory}</span><HelpBubble section={selectedCategory==='Son'?'audio':selectedCategory==='Médias'?'crop':selectedCategory==='Logos'?'logos':selectedCategory==='Graphisme'?'graphics':selectedCategory==='Durée'?'timing':'text'}/></div>:null}
    {showPanel('appointment','Textes et dates')?<AppointmentSettings template={template} data={data} media={media} onChange={change} disabled={disabled} onLogoSettings={()=>{setQuery('');setSelectedCategory('Logos');}}/>:null}
    {showPanel('replay','Textes et dates')?<ReplaySettings data={data} onChange={change} disabled={disabled}/>:null}
    {showPanel('voice','Son')&&onChooseTeamVoice?<section className="team-voice-entry"><strong>Voix classées pour les déclinaisons</strong><button type="button" disabled={disabled||teamVoiceDisabled} onClick={onChooseTeamVoice}><Volume2 size={16} aria-hidden="true"/>Ouvrir les voix validées</button>{teamVoiceDisabled?<small>Disponible à la fin de l’export en cours.</small>:<small>Pour choisir directement un fichier partagé, utilisez « Les voix de l’équipe » ci-dessous.</small>}</section>:null}
    {showPanel('sound','Son')?<SoundSettings template={template} data={data} onChange={change} disabled={disabled}/>:null}
    {showPanel('voice','Son')?<VoiceTimingSettings template={template} data={data} media={media} onChange={change} disabled={disabled}/>:null}
    {showPanel('logos','Logos')?<LogoSettings template={template} data={data} media={media} onChange={change} disabled={disabled} layout={logoLayout}/>:null}
    {showPanel('placement','Graphisme')?<PlacementSettings template={template} data={data} onChange={change} disabled={disabled}/>:null}
    {showPanel('ceSoirBackground','Graphisme')?<CeSoirBackgroundSettings data={data} onChange={change} disabled={disabled}/>:null}
    {showPanel('popupBackground','Médias')?<fieldset disabled={disabled}><div className="field popup-background-setting"><label htmlFor={backgroundId}>Fond du pop-up</label><select id={backgroundId} value={data._background_visible===true?'media':'transparent'} onChange={event=>{
      if(event.target.value==='transparent')change({_background_visible:false});
      else change({_background_visible:true});
    }}><option value="transparent">Transparent — sans fond</option><option value="media">Image ou vidéo en fond</option></select><small>La vignette et les textes sont conservés. L’aperçu s’actualise automatiquement. Le damier indique les zones transparentes ; il ne sera pas exporté.</small></div></fieldset>:null}
    <fieldset disabled={disabled}>{visibleGroups.map(([section,entries],index)=><details className="field-section" key={section} open={searching?true:index===0}><summary>{section}<span>{entries.length}</span></summary>{entries.map(([name,field])=><Field key={name} name={name} field={field} value={data[name]??field.default??''} media={media} template={template} data={data} onPatch={change} onChange={v=>{
      const patch=name==='_audio_voice_url'?voiceSourcePatch(template,latest.current,v):isMediaField(name,field)&&source(v)!==source(latest.current[name])?replaceMedia(name,v,template.fields):{[name]:v};
      if(popup&&name==='_media_background_url'&&!source(v))Object.assign(patch,{_background_visible:false,_media_background_sequence:'[]'});
      change(patch);
    }}/>)}</details>)}</fieldset>
    {showPanel('typography','Textes et dates')?<details className="typography-disclosure" open={searching||typographyOpen}>
      <summary onClick={event=>{event.preventDefault();setTypographyOpen(value=>!value);}}><SlidersHorizontal size={17} aria-hidden="true"/><span>Mise en forme du texte<small>Police, couleur et position</small></span><ChevronDown size={16} aria-hidden="true"/></summary>
      <TypographySettings key={template.id} template={template} data={data} onChange={change} disabled={disabled} selectedElement={selectedElement}/>
    </details>:null}
    {showPanel('textLayout','Textes et dates')?<TextSettings template={template} data={data} onChange={change} disabled={disabled}/>:null}
    {searching&&!resultCount?<p className="empty">Aucun réglage correspondant.</p>:null}
  </div>;
}
