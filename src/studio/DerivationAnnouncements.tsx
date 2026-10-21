import {useEffect,useMemo,useState} from 'react';
import type {ProjectData} from './domain';
import {derivations} from './derivation-api';
import type {DerivationVoicePage} from './derivation-api';
import {derivationAnnouncementDays,derivationAnnouncementKeys,normalizeAnnouncement} from './derivation-announcements';
import type {DerivationAnnouncement,DerivationAnnouncementKey} from './derivation-announcements';
import {VoiceAudition} from './PreparationProfileEditor';
import type {VideoFormat} from './video/export';
import {baVoicePlacement} from './ba-voice-placement';
import type {BAVoicePlacement} from './ba-voice-placement';
import {BA_CARTON_START} from './voice-timing-model';
import {announcementLabels as labels,announcementFormats as formats,initialAnnouncementFields,announcementCue,withAnnouncementFormat,announcementFromClassifiedVoice,announcementVoiceLabel} from './derivation-announcement-ui';
import {announcementVoiceSources} from './announcement-local-voices';
import type {AnnouncementVoiceSources} from './announcement-local-voices';
import {preparationProfiles} from './preparation-profile-api';
import {announcementVoicePinsKey,loadAnnouncementVoicePins} from './announcement-voice-pins';
import type {AnnouncementVoicePin,AnnouncementVoicePinResult,AnnouncementVoiceProfile} from './announcement-voice-pins';
type PlacementRow={key:DerivationAnnouncementKey;name:string;placement:BAVoicePlacement|null;error:string;proposal:BAVoicePlacement|null};

export function PinnedAnnouncementVoiceOption({voice,profile,choices}:{voice:DerivationAnnouncement['voice'];profile?:AnnouncementVoiceProfile;choices:readonly AnnouncementVoiceProfile[]}){
  if(voice.mode!=='profile'||choices.some(choice=>choice.id===voice.profileId&&choice.revision===voice.revision))return null;
  return <option disabled={!profile} value={`${voice.profileId}:${voice.revision}`}>{profile?`${profile.name} · r${voice.revision} · révision épinglée`:`Voix épinglée · r${voice.revision} · révision non chargée`}</option>;
}

export function AnnouncementVoicePlacementText({placement}:{placement:BAVoicePlacement}){
  const seconds=(value:number)=>value.toFixed(3).replace('.',',');
  // Placement is stored in AE source time. Only this label is relative to the
  // user's IN/OUT marks, as in ManualVoicePlacement; never rewrite the offsets.
  return <>{seconds(placement.duration)} s : intro +{seconds(placement.intro)} → +{seconds(placement.introEnd)} s après IN ; carton +{seconds(placement.outro-BA_CARTON_START)} → +{seconds(placement.outroEnd-BA_CARTON_START)} s après OUT.</>;
}

export function manualAnnouncementVoice(data:ProjectData,voice:DerivationAnnouncement['voice'],checked:boolean):DerivationAnnouncement['voice']{
  if(data._studio_ba_voice_fit!=='manual'||voice.mode!=='profile')throw Error('Un calage personnalisé et une fiche voix sont nécessaires.');
  return {...voice,placement:checked?'manual':'source'};
}
export function ManualVoicePlacement({data,voice,onChange,disabled}:{data:ProjectData;voice:DerivationAnnouncement['voice'];onChange:(voice:DerivationAnnouncement['voice'])=>void;disabled:boolean}){
  if(data._studio_ba_voice_fit!=='manual'||voice.mode!=='profile')return null;
  return <div className="announcement-manual-placement"><label><input type="checkbox" disabled={disabled} checked={voice.placement==='manual'} onChange={event=>onChange(manualAnnouncementVoice(data,voice,event.target.checked))}/>Reprendre mon calage personnalisé</label><p className="small">Introduction : {Number(data._audio_voice_intro_offset_seconds).toFixed(3)} s après IN ; carton : {(Number(data._audio_voice_outro_offset_seconds)-BA_CARTON_START).toFixed(3)} s après OUT. La durée entière de cette fiche doit tenir dans les deux créneaux. Aucun calage n’est repris sans cette sélection.</p></div>;
}

export default function DerivationAnnouncements({data,value,onChange,onFive,disabled,fileFormat,onFileFormat,onPlacementValidity,onVoiceSources,voiceRetry=0}:{data:ProjectData;value:DerivationAnnouncement[];onChange:(value:DerivationAnnouncement[])=>void;onFive:()=>void;disabled:boolean;fileFormat:VideoFormat;onFileFormat:(format:VideoFormat)=>void;onPlacementValidity:(valid:boolean)=>void;onVoiceSources?:(sources:AnnouncementVoiceSources)=>void;voiceRetry?:number}){
  const [day,setDay]=useState(()=>initialAnnouncementFields(data,value).day),[time,setTime]=useState(()=>initialAnnouncementFields(data,value).time);
  const [catalogue,setCatalogue]=useState<DerivationVoicePage>({profiles:[],next:null}),[loaded,setLoaded]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const [fromVoice,setFromVoice]=useState(false);
  const pinKey=announcementVoicePinsKey(value);
  const [pinResolution,setPinResolution]=useState<{key:string;loading:boolean;results:AnnouncementVoicePinResult[]}>({key:'[]',loading:false,results:[]});
  // Only pin identity/cue, catalogue changes or an explicit retry trigger reads;
  // editing an hour, format or placement does not restart metadata requests.
  useEffect(()=>{
    const task=new AbortController(),pins:AnnouncementVoicePin[]=JSON.parse(pinKey);
    setPinResolution({key:pinKey,loading:!!pins.length,results:[]});
    void loadAnnouncementVoicePins(pins,catalogue.profiles,preparationProfiles,task.signal).then(results=>{
      if(!task.signal.aborted)setPinResolution({key:pinKey,loading:false,results});
    }).catch(cause=>{if(!task.signal.aborted)setPinResolution({key:pinKey,loading:false,results:pins.map(pin=>({id:pin.id,revision:pin.revision,profile:null,error:cause instanceof Error?cause.message:'Révision de voix inaccessible.'}))});});
    return()=>task.abort();
  },[pinKey,catalogue.profiles,voiceRetry]);
  const pinnedProfiles=useMemo(()=>pinResolution.key===pinKey?pinResolution.results.flatMap(result=>result.profile?[result.profile]:[]):[],[pinKey,pinResolution]);
  const pinsLoading=pinKey!=='[]'&&(pinResolution.key!==pinKey||pinResolution.loading);
  const pinErrors=pinResolution.key===pinKey?pinResolution.results.filter(result=>result.error):[];
  const selectedSources=useMemo(()=>announcementVoiceSources(value,pinnedProfiles),[value,pinnedProfiles]);
  useEffect(()=>{onVoiceSources?.(selectedSources);},[selectedSources,onVoiceSources]);
  const selectedTimes=value.filter(item=>item.key!=='now').map(item=>item.time??time),mixedTimes=new Set(selectedTimes).size>1;
  const commonTime=mixedTimes?'':selectedTimes[0]??time;
  useEffect(()=>{const task=new AbortController();setLoading(true);void derivations.voices(null,task.signal).then(result=>{setCatalogue(result);setLoaded(true);}).catch(cause=>{if(!task.signal.aborted)setError(cause instanceof Error?cause.message:String(cause));}).finally(()=>{if(!task.signal.aborted)setLoading(false);});return()=>task.abort();},[]);
  const matches=(key:DerivationAnnouncementKey,selectedDay=day)=>catalogue.profiles.filter(profile=>profile.data.cue.kind==='announcement'&&normalizeAnnouncement(profile.data.cue.value)===normalizeAnnouncement(announcementCue(key,selectedDay)||''));
  const placements=value.flatMap<PlacementRow>(item=>{const voice=item.voice;if(voice.mode!=='profile')return [];const profile=pinnedProfiles.find(profile=>profile.id===voice.profileId&&profile.revision===voice.revision);if(!profile)return [];const duration=profile.data.end-profile.data.start;try{return [{key:item.key,name:profile.name,placement:baVoicePlacement(duration,voice.placement??'source',{intro:Number(data._audio_voice_intro_offset_seconds),outro:Number(data._audio_voice_outro_offset_seconds)}),error:'',proposal:null}];}catch(cause){let proposal=null;try{proposal=baVoicePlacement(duration,'fit-complete');}catch{/* The complete passage cannot fit safely. */}return [{key:item.key,name:profile.name,placement:null,error:cause instanceof Error?cause.message:String(cause),proposal}];}});
  const needsFit=placements.filter(item=>!!item.proposal);
  const validPlacement=!placements.some(item=>!!item.error);
  useEffect(()=>{onPlacementValidity(validPlacement);},[validPlacement,onPlacementValidity]);
  function suggestedVoice(key:DerivationAnnouncementKey):DerivationAnnouncement['voice']{const choices=matches(key);return loaded&&!catalogue.next&&choices.length===1?{mode:'profile',profileId:choices[0].id,revision:choices[0].revision}:{mode:'pending'};}
  function initial(key:DerivationAnnouncementKey):DerivationAnnouncement{return {key,...(key==='day-time'&&day?{day}:{}),time:key==='now'?'':time,formats:['tv'],voice:suggestedVoice(key)};}
  function patch(key:DerivationAnnouncementKey,change:Partial<DerivationAnnouncement>){onChange(value.map(item=>item.key===key?{...item,...change}:item));}
  async function more(){setLoading(true);setError('');try{const next=await derivations.voices(catalogue.next);setCatalogue(current=>({profiles:[...current.profiles,...next.profiles.filter(profile=>!current.profiles.some(old=>old.id===profile.id))],next:next.next}));}catch(cause){setError(cause instanceof Error?cause.message:String(cause));}finally{setLoading(false);}}
  function chooseVoice(id:string){
    const profile=catalogue.profiles.find(profile=>profile.id===id);if(!profile)return;
    const proposed=announcementFromClassifiedVoice(profile,value,time);if(!proposed)return;
    if(proposed.day)setDay(proposed.day);
    if(!value.length)onFive();onChange([...value.filter(item=>item.key!==proposed.key),proposed]);
  }
  const visibleLabel=(key:DerivationAnnouncementKey)=>key==='now'?'Tout de suite · moteur dédié':labels[key];
  return <section className="derivation-announcements" aria-label="Annonces du même programme"><div className="row wrap"><div className="grow"><h3>Les annonces de votre BA</h3><p className="small muted">Même programme, extraits et musique. Seuls l’annonce, l’horaire et la voix choisie changent.</p><p className="small">8 sorties maximum par ensemble, annonces, formats sociaux et pop-ups compris. Les 5 annonces TV laissent 3 sorties supplémentaires au choix.</p></div><button type="button" disabled={disabled} onClick={()=>{onFive();onChange(derivationAnnouncementKeys.map(initial));}}>5 annonces TV · moteur adapté</button></div>
    <div className="announcement-picks">{derivationAnnouncementKeys.map(key=><label key={key}><input type="checkbox" disabled={disabled} checked={value.some(item=>item.key===key)} onChange={event=>onChange(event.target.checked?[...value,initial(key)]:value.filter(item=>item.key!==key))}/>{visibleLabel(key)}</label>)}</div>
    {value.some(item=>item.key==='now')?<p className="notice announcement-immediate-note"><strong>Tout de suite utilise son propre modèle.</strong> Le titre entre en grand sur une ligne, puis devient la signature sur deux lignes. Aucun jour ni horaire n’est envoyé au moteur.</p>:null}
    <button type="button" disabled={disabled} aria-expanded={fromVoice} onClick={()=>setFromVoice(value=>!value)}>Partir d’une voix</button>
    {fromVoice?<div className="announcement-from-voice"><label>Voix classée et attestée<select disabled={disabled||loading} value="" onChange={event=>chooseVoice(event.target.value)}><option value="">Choisir une voix pour proposer son annonce</option>{catalogue.profiles.filter(profile=>profile.data.cue.kind==='announcement').map(profile=><option key={profile.id} value={profile.id}>{profile.name} · {profile.data.cue.value} · r{profile.revision}</option>)}</select></label><p className="small">Le texte est proposé à partir du libellé attesté de la fiche, pas du nom du fichier. L’heure reste à choisir puis à confirmer ci-dessous. Pour un nouveau fichier, classez et écoutez d’abord sa fiche dans Préparation & favoris → Voix ; aucun partage automatique.</p>{!catalogue.profiles.length?<p className="small" role="status">{loading?'Chargement des voix…':'Aucune voix attestée chargée pour le moment.'}</p>:null}{catalogue.next?<button disabled={loading||disabled} onClick={()=>void more()}>Charger d’autres voix attestées</button>:null}</div>:null}
    {value.length?<><div className="announcement-common">{value.some(item=>item.key==='day-time')?<label>Jour explicite<select disabled={disabled} value={day||''} onChange={event=>{const selected=event.target.value as typeof derivationAnnouncementDays[number];setDay(selected);onChange(value.map(item=>item.key==='day-time'?{...item,day:selected,voice:{mode:'pending'}}:item));}}><option value="" disabled>Choisir le jour</option>{derivationAnnouncementDays.map(label=><option key={label}>{label}</option>)}</select></label>:null}{value.some(item=>item.key!=='now')?<label>Heure commune · hors Tout de suite (facultative)<input disabled={disabled} type="time" value={commonTime} onChange={event=>{setTime(event.target.value);onChange(value.map(item=>item.key==='now'?item:{...item,time:event.target.value}));}}/>{mixedTimes?<small>Heures différentes conservées par annonce. Renseigner ce champ les remplace toutes.</small>:null}</label>:null}<label>Fichiers des BA<select disabled={disabled} value={fileFormat} onChange={event=>onFileFormat(event.target.value as VideoFormat)}><option value="mp4">MP4 · opaque</option><option value="mov">MOV · ProRes + alpha</option><option value="png">PNG · séquence alpha</option><option value="alpha">WebM · VP9 + alpha</option></select></label></div>
      <fieldset className="announcement-formats"><legend>Formats communs à toutes les annonces choisies</legend>{formats.map(([format,label])=><label key={format}><input type="checkbox" disabled={disabled} checked={value.every(item=>item.formats.includes(format))} onChange={event=>onChange(value.map(item=>withAnnouncementFormat(item,format,event.target.checked)))}/>{label}</label>)}</fieldset>
      <p className="small">Pour ajouter un format à une seule annonce, ouvrez sa ligne ci-dessous. Cinq annonces × deux formats font dix sorties : répartissez-les en ensembles de huit maximum.</p>
      <p className="small muted">Une heure vide reste masquée, aucun horaire n’est inventé. Tout de suite n’a jamais d’heure. Les libellés Aujourd’hui, Demain et Ce soir sont des choix éditoriaux, pas une programmation automatique.</p>
      {needsFit.length?<div className="notice warning"><strong>Lire les {needsFit.length} voix entières demande un placement adapté.</strong><ul>{needsFit.map(item=><li key={item.key}>{item.name} · <AnnouncementVoicePlacementText placement={item.proposal!}/></li>)}</ul><label className="announcement-no-voice"><input disabled={disabled} type="checkbox" checked={false} onChange={()=>onChange(value.map(item=>needsFit.some(proposal=>proposal.key===item.key)&&item.voice.mode==='profile'?{...item,voice:{...item.voice,placement:'fit-complete'}}:item))}/>J’accepte ce placement complet et la baisse du jingle autour de chaque voix, sans couper ni accélérer les fichiers.</label><p className="small">Ces repères suivent IN et OUT de votre montage. La voix d’introduction termine avant le corps du programme. Le son des médias d’introduction et de carton est conservé : contrôlez les éventuels chevauchements à l’écoute.</p></div>:null}
      {placements.filter(item=>item.error&&!item.proposal).map(item=><p className="notice warning" key={item.key}>{item.name} : {item.error}</p>)}
      {placements.some(item=>item.placement?.adapted)?<p className="notice">Placement adapté explicitement choisi pour {placements.filter(item=>item.placement?.adapted).length} voix. Le passage et la vitesse restent inchangés ; le jingle s’atténue sur toute sa durée.</p>:null}
      {loading?<p className="small" role="status">Lecture du catalogue de voix attestées…</p>:null}{error?<p className="notice warning">Catalogue indisponible : {error} Vous pouvez préparer les brouillons avec « Voix à associer ».</p>:null}
      {pinsLoading?<p className="small" role="status">Chargement des révisions exactes des voix épinglées… L’export attend leur vérification ; vos choix restent conservés.</p>:null}
      {pinErrors.length?<div className="notice warning" role="alert"><strong>Des voix épinglées restent indisponibles.</strong><ul>{pinErrors.map(result=><li key={`${result.id}:${result.revision}`}>r{result.revision} : {result.error}</li>)}</ul><p>Utilisez « Réessayer les révisions de voix épinglées » ci-dessous. Aucune voix plus récente ne remplace votre choix.</p></div>:null}
      <div className="announcement-rows">{value.map(item=>{
        const choices=matches(item.key,item.day??day),voice=item.voice,profile=voice.mode==='profile'?pinnedProfiles.find(profile=>profile.id===voice.profileId&&profile.revision===voice.revision):undefined;
        return <details key={item.key}>
          <summary><strong>{item.key==='day-time'?item.day||'Jour à choisir':visibleLabel(item.key)}{item.time?' · '+item.time:''}{item.key==='now'?' · sans horaire':''}</strong><span>{item.formats.map(format=>format==='tv'?'TV':format==='portrait'?'4:5':'9:16').join(' + ')||'Format à choisir'} · {announcementVoiceLabel(voice,profile?.name)}</span></summary>
          <fieldset className="announcement-formats"><legend>Formats de cette annonce</legend>{formats.map(([format,label])=><label key={format}><input type="checkbox" disabled={disabled} aria-label={`${label} pour ${item.key==='day-time'?item.day||'le jour choisi':labels[item.key]}`} checked={item.formats.includes(format)} onChange={event=>patch(item.key,{formats:withAnnouncementFormat(item,format,event.target.checked).formats})}/>{label}</label>)}</fieldset>
          <label>Voix de cette annonce<select disabled={disabled} value={item.voice.mode==='profile'?`${item.voice.profileId}:${item.voice.revision}`:item.voice.mode} onChange={event=>{const selected=choices.find(profile=>`${profile.id}:${profile.revision}`===event.target.value)||(profile&&`${profile.id}:${profile.revision}`===event.target.value?profile:undefined);patch(item.key,{voice:selected?{mode:'profile',profileId:selected.id,revision:selected.revision}:{mode:event.target.value==='none'?'none':'pending'}});}}><option value="pending">Voix à associer — préparer le brouillon</option><option value="none">Sans voix off — choix explicite</option><PinnedAnnouncementVoiceOption voice={voice} profile={profile} choices={choices}/>{choices.map(profile=><option key={`${profile.id}:${profile.revision}`} value={`${profile.id}:${profile.revision}`}>{profile.name} · r{profile.revision}{profile.favorite?' · favori équipe':''}</option>)}</select></label>
          {voice.mode==='profile'&&!profile?<p className="notice warning">La révision épinglée r{voice.revision} reste sélectionnée ; aucune voix plus récente ne la remplace. Son chargement exact et sa vérification sont nécessaires avant écoute, reconnexion et export. Le serveur revérifie sa disponibilité et son placement avant création.</p>:null}
          {choices.length>1?<p className="small">Plusieurs voix attestées correspondent. Choisissez le passage ; aucun favori n’est choisi arbitrairement.</p>:null}
          <ManualVoicePlacement data={data} voice={voice} disabled={disabled} onChange={voice=>patch(item.key,{voice})}/>
          {profile?<VoiceAudition key={`${profile.id}:${profile.revision}`} source={profile.data.source} start={profile.data.start} end={profile.data.end}/>:voice.mode!=='profile'?<p className="small">Aucune ancienne annonce n’est recopiée. La musique et le son des médias restent présents selon vos réglages.</p>:null}
          {item.key!=='now'?<label>Heure de cette variante (facultative)<input disabled={disabled} type="time" value={item.time||''} onChange={event=>patch(item.key,{time:event.target.value})}/></label>:null}
        </details>;
      })}</div>
      {catalogue.next?<button type="button" disabled={loading||disabled} onClick={()=>void more()}>Charger d’autres voix attestées</button>:null}
      {value.some(item=>item.voice.mode==='pending')?<label className="announcement-no-voice"><input type="checkbox" disabled={disabled} checked={false} onChange={()=>onChange(value.map(item=>item.voice.mode==='pending'?{...item,voice:{mode:'none'}}:item))}/>Exporter les annonces non associées sans voix off (choix explicite)</label>:null}
      <p className="small">{value.reduce((total,item)=>total+item.formats.length,0)} BA prévues. Les correspondances reposent sur le libellé et la révision attestés, jamais sur le nom du fichier. Une proposition unique reste visible ci-dessus et est confirmée par votre action de création.</p>
    </>:null}
  </section>;
}
