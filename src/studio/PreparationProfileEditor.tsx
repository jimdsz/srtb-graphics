import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import type {ReactNode} from 'react';
import type {BroadcastTemplate,FieldValue,MediaAsset,ProjectData} from './domain';
import {validateProjectData} from './domain';
import {preparationProfiles} from './preparation-profile-api';
import {charterColours,preparationAnnouncements,programmeDataSchema,voiceDataSchema,voiceVariants} from './preparation-profile-model';
import type {PreparationKind,PreparationProfile,PreparationProfileCursor,PreparationProfileSummary,ProfileAsset,ProgrammeData,VoiceData} from './preparation-profile-model';
import {localMediaSnapshot,localURL,stableLocalData,subscribeLocalMedia} from './local-media';
import {LocalFileButton} from './LocalMedia';
import {ApiError} from './api';
import {sessionState} from './session-state';
import {measureVoiceDuration} from './voice-duration';
import {createVoiceRangeDraft,voiceRangeReady} from './voice-range-draft';
import type {VoiceRangeState} from './voice-range-draft';

const emptyProgramme:ProgrammeData={title:'',logo:null,palette:['#f0b900','#000000','#ffffff'],appointments:[],voice:null};
const colourLabels:Record<string,string>={'#ffffff':'Blanc','#000000':'Noir','#f0b900':'Or','#007300':'Vert','#eb1905':'Rouge'};
type CharterColour=ProgrammeData['palette'][number];
export const setProgrammePrimary=(palette:ProgrammeData['palette'],colour:CharterColour):ProgrammeData['palette']=>[colour,...palette.filter(item=>item!==colour)];
export const toggleProgrammeColour=(palette:ProgrammeData['palette'],colour:CharterColour):ProgrammeData['palette']=>palette.includes(colour)?palette.length>1?palette.filter(item=>item!==colour):palette:[...palette,colour];

export function ProgrammePalette({palette,onChange}:{palette:ProgrammeData['palette'];onChange:(palette:ProgrammeData['palette'])=>void}){
  return <div className="programme-palette"><label>Couleur principale<select value={palette[0]} onChange={event=>onChange(setProgrammePrimary(palette,event.target.value as CharterColour))}>{charterColours.map(colour=><option key={colour} value={colour}>{colourLabels[colour]}</option>)}</select></label><fieldset className="profile-palette"><legend>Palette du programme</legend>{charterColours.map(colour=><label key={colour}><input type="checkbox" checked={palette.includes(colour)} disabled={palette.length===1&&palette[0]===colour} onChange={()=>onChange(toggleProgrammeColour(palette,colour))}/><span style={{backgroundColor:colour}} aria-hidden="true"/>{colourLabels[colour]}{palette[0]===colour?' · principale':''}</label>)}</fieldset><small>La couleur principale est proposée aux modèles compatibles. Les autres couleurs restent dans la fiche.</small></div>;
}
const stableAsset=(template:BroadcastTemplate,asset:ProfileAsset)=>stableLocalData({...template,fields:{_media_profile_url:{'x-control':'media'}}},{_media_profile_url:asset})._media_profile_url as ProfileAsset;

export function ProfileAssetPicker({label,value,kind,media,onChange,selectionAction}:{label:string;value:ProfileAsset|null;kind:'image'|'audio';media:MediaAsset[];onChange:(value:ProfileAsset|null)=>void;selectionAction?:ReactNode}){
  const assets=media.filter(item=>item.status==='ready'&&item.mime_type.startsWith(`${kind}/`));
  const options=new Set(assets.map(item=>`/api/graphics/media/${item.id}/content`));
  return <div className="profile-asset"><label>{label}<select value={value?.url||''} onChange={event=>{const item=assets.find(asset=>`/api/graphics/media/${asset.id}/content`===event.target.value);onChange(item?{url:event.target.value,name:item.name,mimeType:item.mime_type}:null);}}><option value="">Aucun fichier</option>{value&&!options.has(value.url)?<option value={value.url}>Sur ce poste · {value.name}</option>:null}{assets.map(asset=><option key={asset.id} value={`/api/graphics/media/${asset.id}/content`}>{asset.name}</option>)}</select></label><LocalFileButton kind={kind} selectionAction={selectionAction} onChoose={(asset:FieldValue)=>{if(typeof asset==='object')onChange(asset);}}/><small>Aucun téléversement automatique. Les fichiers locaux restent sur leur disque et devront être reconnectés sur un autre poste.</small></div>;
}

/** A real bounded audition precedes the explicit human attestation. No transcription. */
export function VoiceAudition({source,start,end,onListened,blocked=false}:{source:ProfileAsset;start:number;end:number;onListened?:()=>void;blocked?:boolean}){
  useSyncExternalStore(subscribeLocalMedia,localMediaSnapshot);
  const session=useSyncExternalStore(sessionState.subscribe,sessionState.snapshot),suspended=session.suspended||session.ended;
  const audio=useRef<HTMLAudioElement>(null),playing=useRef(false),complete=useRef(false);
  const [running,setRunning]=useState(false),[error,setError]=useState(''),[position,setPosition]=useState(0);
  let url='',missing='';try{url=localURL(source.url);}catch(cause){missing=cause instanceof Error?cause.message:String(cause);}
  useEffect(()=>{const node=audio.current;playing.current=false;complete.current=false;setRunning(false);setError('');setPosition(start);return()=>{node?.pause();};},[url,start,end]);
  useEffect(()=>{if(suspended||blocked){audio.current?.pause();playing.current=false;setRunning(false);}},[suspended,blocked]);
  async function play(){const node=audio.current,allowed=sessionState.permission();if(!node||blocked||!allowed())return;setError('');try{if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)throw Error('Vérifiez les points de début et de fin.');if(Number.isFinite(node.duration)&&end>node.duration+.02)throw Error('La fin dépasse la durée réelle du fichier.');node.pause();node.currentTime=start;playing.current=true;complete.current=false;await node.play();if(!allowed()){node.pause();playing.current=false;setRunning(false);return;}setRunning(true);}catch(cause){playing.current=false;setRunning(false);setError(cause instanceof Error?cause.message:String(cause));}}
  function progress(){const node=audio.current;if(!node||suspended||blocked)return;setPosition(node.currentTime);if(playing.current&&node.currentTime>=end-.015){node.pause();playing.current=false;complete.current=true;setRunning(false);onListened?.();}}
  return <div className="voice-audition"><p><strong>{source.name}</strong><small>{start.toFixed(2)} → {end.toFixed(2)} s · {(end-start).toFixed(2)} s</small></p>{missing?<p className="notice warning" role="alert">{missing}</p>:<><audio ref={audio} src={url} preload="metadata" onTimeUpdate={progress} onEnded={()=>{progress();if(!blocked&&!complete.current){setRunning(false);setError('Le fichier se termine avant la fin du passage. Vérifiez les repères.');}}} onError={()=>{setRunning(false);setError('Ce fichier est indisponible ou illisible. Reconnectez la source ou choisissez un média audio compatible.');}}/><div className="row wrap"><button type="button" disabled={blocked||suspended||running||!url||end<=start} onClick={()=>void play()}>Écouter le passage</button><button type="button" disabled={!running} onClick={()=>{audio.current?.pause();playing.current=false;setRunning(false);}}>Arrêter</button><span className="small" role="status">{blocked?'Définissez le passage avant l’écoute':running?`Écoute · ${position.toFixed(1)} s`:'Lecture à la demande'}</span></div></>}{error?<p className="notice error" role="alert">{error}</p>:null}</div>;
}

export function WholeVoiceRange({state,onMeasure,onCancel}:{state:VoiceRangeState;onMeasure:()=>void;onCancel:()=>void}){
  const busy=state.status==='measuring';
  return <div aria-busy={busy}><button type="button" data-voice-action="measure" disabled={busy} onClick={onMeasure}>{busy?'Mesure de la durée décodée…':'Utiliser le fichier entier (durée décodée)'}</button>{busy?<button type="button" onClick={onCancel}>Interrompre la mesure</button>:null}{state.message?<p className={state.status==='error'?'notice error':'small'} role={state.status==='error'?'alert':'status'}>{state.message}</p>:null}<small>La durée est mesurée sur le son décodé, sans retirer de silence ni couper la voix. Aucun fichier n’est envoyé. La confirmation reste manuelle après une écoute complète.</small></div>;
}

function PinnedVoiceChoice({value,onChange}:{value:ProgrammeData['voice'];onChange:(voice:ProgrammeData['voice'])=>void}){
  const [voices,setVoices]=useState<PreparationProfileSummary[]>([]),[next,setNext]=useState<PreparationProfileCursor|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{const controller=new AbortController();void preparationProfiles.list({kind:'voice',limit:50},controller.signal).then(page=>{setVoices(page.profiles);setNext(page.next);}).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:String(cause));});return()=>controller.abort();},[]);
  async function select(id:string){if(!id){onChange(null);return;}setBusy(true);setError('');try{const profile=await preparationProfiles.get(id);if(profile.kind!=='voice'||profile.archived||!profile.validated_by||!profile.validated_at)throw Error('Cette voix ne dispose plus d’une révision active validée.');voiceDataSchema.parse(profile.data);onChange({profileId:profile.id,revision:profile.revision});}catch(cause){setError(cause instanceof Error?cause.message:String(cause));}finally{setBusy(false);}}
  return <div><label>Voix validée associée<select disabled={busy} value={value?.profileId||''} onChange={event=>void select(event.target.value)}><option value="">Aucune voix associée</option>{value&&!voices.some(item=>item.id===value.profileId)?<option value={value.profileId}>Voix épinglée · révision {value.revision}</option>:null}{voices.map(voice=><option key={voice.id} value={voice.id}>{voice.name}{voice.id===value?.profileId?` · révision épinglée ${value.revision}`:` · r${voice.revision}`}</option>)}</select></label>{value?<small>Révision {value.revision} conservée, même si la fiche voix évolue. Pour l’actualiser, choisissez « Aucune », puis la voix voulue.</small>:null}{next?<button type="button" disabled={busy} onClick={()=>{setBusy(true);void preparationProfiles.list({kind:'voice',limit:50,next}).then(page=>{setVoices(current=>[...current,...page.profiles.filter(item=>!current.some(old=>old.id===item.id))]);setNext(page.next);}).catch(cause=>setError(cause instanceof Error?cause.message:String(cause))).finally(()=>setBusy(false));}}>Charger d’autres voix</button>:null}{error?<p role="alert">{error}</p>:null}</div>;
}

export default function PreparationProfileEditor({kind,existing,template,data,media,onSaved,onCancel,onBusyChange}:{kind:PreparationKind;existing?:PreparationProfile;template:BroadcastTemplate;data:ProjectData;media:MediaAsset[];onSaved:(profile:PreparationProfile)=>void;onCancel:()=>void;onBusyChange:(busy:boolean)=>void}){
  const [name,setName]=useState(existing?.name||''),[favorite,setFavorite]=useState(false);
  const [programme,setProgramme]=useState<ProgrammeData>(existing?.kind==='programme'?existing.data:emptyProgramme);
  const [rangeDraft]=useState(()=>createVoiceRangeDraft(existing?.kind==='voice'?existing.data:undefined));
  const range=useSyncExternalStore(rangeDraft.subscribe,rangeDraft.snapshot,rangeDraft.snapshot),{source,start,end}=range;
  const rangeReady=voiceRangeReady(range),measuring=range.status==='measuring';
  const [label,setLabel]=useState(existing?.kind==='voice'?existing.data.label:''),[cue,setCue]=useState<VoiceData['cue']>(existing?.kind==='voice'?existing.data.cue:{kind:'announcement',value:'Ce soir'});
  const [heard,setHeard]=useState(false),[attested,setAttested]=useState(false),[preset,setPreset]=useState<ProjectData>(existing?.kind==='preset'?existing.data:data);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[conflict,setConflict]=useState(false);
  useEffect(()=>{setHeard(false);setAttested(false);},[range.revision,label,cue,name]);
  useEffect(()=>()=>rangeDraft.cancel(),[rangeDraft]);
  async function save(){if(busy)return;setBusy(true);onBusyChange(true);setError('');setConflict(false);try{
    let profile:PreparationProfile;
    if(kind==='programme'){
      const checked=programmeDataSchema.parse({...programme,logo:programme.logo?stableAsset(template,programme.logo):null});
      profile=existing?await preparationProfiles.save(existing,name,checked):await preparationProfiles.create({kind,name,favorite,data:checked});
    }else if(kind==='voice'){
      if(!voiceRangeReady(rangeDraft.snapshot())||rangeDraft.snapshot().revision!==range.revision)throw Error('Attendez le résultat de la mesure ou définissez explicitement les repères du passage.');
      if(!source||!heard||!attested)throw Error('Écoutez le passage en entier, puis confirmez explicitement son contenu.');
      const checked=voiceDataSchema.parse({source:stableAsset(template,source),start,end,label,cue,humanValidated:true});
      profile=existing?await preparationProfiles.save(existing,name,checked):await preparationProfiles.create({kind,name,favorite,data:checked});
    }else{
      const checked=existing?.kind==='preset'&&!sameTemplate?preset:validateProjectData(template,stableLocalData(template,preset));
      profile=existing?await preparationProfiles.save(existing,name,checked):await preparationProfiles.create({kind,name,favorite,templateId:template.id,templateVersion:template.version,libraryVersion:template.libraryVersion,data:checked});
    }onSaved(profile);
  }catch(cause){setError(cause instanceof Error?cause.message:String(cause));setConflict(cause instanceof ApiError&&cause.status===409);}finally{setBusy(false);onBusyChange(false);}}
  const auditionIdentity=JSON.stringify([name,label,cue.kind,cue.value,range.revision]);
  const headings={programme:'Fiche programme',preset:'Réglage réutilisable',voice:'Passage de voix validé'};
  const sameTemplate=!existing||existing.template_id===template.id&&existing.template_version===template.version&&existing.library_version===template.libraryVersion;
  return <form className="profile-editor" onSubmit={event=>{event.preventDefault();void save();}}><h3>{existing?'Modifier':'Créer'} · {headings[kind]}</h3><p className="small muted">Partagé avec l’équipe. Aucun ordre de diffusion, aucun fichier envoyé.</p><fieldset disabled={busy}><label>Nom de la fiche<input required maxLength={120} value={name} onChange={event=>setName(event.target.value)}/></label>
    {kind==='programme'?<><label>Titre du programme<input required maxLength={120} value={programme.title} onChange={event=>setProgramme({...programme,title:event.target.value})}/></label><ProgrammePalette palette={programme.palette} onChange={palette=>setProgramme(current=>({...current,palette}))}/><div className="profile-appointments"><strong>Rendez-vous annoncés · {programme.appointments.length}/3</strong>{programme.appointments.map((appointment,index)=><div className="profile-appointment" key={index}><label>Annonce {index+1}<select value={appointment.announcement} onChange={event=>setProgramme({...programme,appointments:programme.appointments.map((value,n)=>n===index?{...value,announcement:event.target.value as typeof value.announcement}:value)})}>{preparationAnnouncements.map(value=><option key={value}>{value}</option>)}</select></label><label>Heure {index+1}<input type="time" required value={appointment.time} onChange={event=>setProgramme({...programme,appointments:programme.appointments.map((value,n)=>n===index?{...value,time:event.target.value}:value)})}/></label><button type="button" aria-label={`Retirer le rendez-vous ${index+1}`} onClick={()=>setProgramme({...programme,appointments:programme.appointments.filter((_,n)=>n!==index)})}>Retirer</button></div>)}<button type="button" disabled={programme.appointments.length>=3} onClick={()=>setProgramme({...programme,appointments:[...programme.appointments,{announcement:'Ce soir',time:'20:30'}]})}>Ajouter un rendez-vous</button></div><ProfileAssetPicker label="Logo du programme (facultatif)" value={programme.logo} kind="image" media={media} onChange={logo=>setProgramme(current=>({...current,logo}))}/><PinnedVoiceChoice value={programme.voice} onChange={voice=>setProgramme(current=>({...current,voice}))}/></>:null}
    {kind==='voice'?<>
      <ProfileAssetPicker label="Source audio" value={source} kind="audio" media={media} onChange={rangeDraft.select} selectionAction={source?<WholeVoiceRange state={range} onMeasure={()=>void rangeDraft.measure(measureVoiceDuration)} onCancel={rangeDraft.cancel}/>:null}/>
      <div className="profile-range">
        <label>Début (s)<input type="number" min="0" max="86400" step="any" required disabled={measuring} value={start} onChange={event=>rangeDraft.manual('start',Number(event.target.value))}/></label>
        <label>Fin (s)<input type="number" min="0" max="86400" step="any" required disabled={measuring} value={end} onChange={event=>rangeDraft.manual('end',Number(event.target.value))}/></label>
      </div>
      <label>Libellé du passage<input required maxLength={120} value={label} onChange={event=>setLabel(event.target.value)}/></label>
      <div className="profile-range"><label>Classement<select value={cue.kind} onChange={event=>setCue(event.target.value==='time'?{kind:'time',value:'20:30'}:event.target.value==='variant'?{kind:'variant',value:'rediffusion'}:{kind:'announcement',value:'Ce soir'})}><option value="announcement">Annonce / jour</option><option value="time">Horaire</option><option value="variant">Variante éditoriale</option></select></label><label>Contenu annoncé{cue.kind==='time'?<input type="time" required value={cue.value} onChange={event=>setCue({kind:'time',value:event.target.value})}/>:<select value={cue.value} onChange={event=>setCue({...cue,value:event.target.value} as VoiceData['cue'])}>{(cue.kind==='announcement'?preparationAnnouncements:voiceVariants).map(value=><option key={value}>{value}</option>)}</select>}</label></div>
      {source?<VoiceAudition key={auditionIdentity} source={source} start={start} end={end} blocked={!rangeReady} onListened={()=>{if(voiceRangeReady(rangeDraft.snapshot())&&rangeDraft.snapshot().revision===range.revision)setHeard(true);}}/>:null}
      <label className="profile-attestation"><input type="checkbox" disabled={!rangeReady||!heard} checked={attested} onChange={event=>setAttested(event.target.checked)}/>J’ai écouté ce passage et je confirme qu’il correspond au contenu annoncé ci-dessus.</label>
      <small>{!rangeReady?'Définissez les repères ou attendez le résultat de la mesure avant d’écouter et de confirmer.':heard?'Écoute terminée. Une modification des repères ou du classement imposera une nouvelle écoute.':'Écoutez le passage en entier pour activer la confirmation.'} L’outil n’effectue aucune transcription ni validation automatique du contenu.</small>
    </>:null}
    {kind==='preset'?<><p>Modèle : <strong>{existing?.template_id||template.name}</strong> · version {existing?.template_version||template.version}</p><p className="small">Cette fiche conserve tous les réglages, y compris les textes, sources, polices locales et formats. Seules des références de fichiers vérifiées sont enregistrées.</p>{existing?<button type="button" disabled={!sameTemplate} onClick={()=>{try{setPreset(validateProjectData(template,stableLocalData(template,data)));setError('');}catch(cause){setError(cause instanceof Error?cause.message:String(cause));}}}>Remplacer par les réglages du brouillon actuel</button>:null}<small>{Object.keys(preset).length} réglages capturés.{!sameTemplate?' Le modèle ou sa version diffère : seul le nom peut être modifié ici.':''}</small></>:null}
    {!existing?<label className="row"><input type="checkbox" checked={favorite} onChange={event=>setFavorite(event.target.checked)}/>Ajouter aux favoris de l’équipe</label>:null}
    {error?<div className="notice error" role="alert">{error}{conflict?<p>Vos saisies sont conservées. Aucune écriture n’a été répétée. Revenez à la fiche pour charger sa version partagée et comparer avant de réessayer.</p>:null}</div>:null}<div className="row wrap"><button className="primary" type="submit" disabled={kind==='voice'&&(!rangeReady||!heard||!attested)}>{busy?'Enregistrement…':existing?'Enregistrer une révision':'Créer la fiche'}</button><button type="button" onClick={onCancel}>Annuler</button></div></fieldset></form>;
}
