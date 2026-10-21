import {useEffect,useId,useRef,useState} from 'react';
import type {BroadcastTemplate,MediaAsset,ProjectData} from './domain';
import MediaSelect from './MediaSelect';
import MediaTrim from './MediaTrim';
import {BA_CARTON_START,voicePlacementPatch,voiceRangePatch,voiceSourcePatch,voiceTimingKeys,voiceTimingWarning} from './voice-timing-model';
import {createVoiceTimingMeasurement,initialVoiceTimingMeasureState} from './voice-timing-measurement';
import Activity from './Activity';
import {chooseSharedVoice,sharedVoiceSource,teamVoiceActivation,teamVoiceLabel} from './team-voice-choice';
import {HelpBubble} from './GraphicsHelp';
import {baSocialDirect} from './ba-social-direct';

export default function VoiceTimingSettings({template,data,media,onChange,disabled}:{template:BroadcastTemplate;data:ProjectData;media:MediaAsset[];onChange:(patch:ProjectData)=>void;disabled:boolean}){
  const id=useId(),latest=useRef({template,data,disabled,onChange});latest.current={template,data,disabled,onChange};
  const [voiceId,setVoiceId]=useState(''),[choiceError,setChoiceError]=useState('');
  const audition=useRef<HTMLAudioElement>(null);
  const voices=media.filter(item=>item.status==='ready'&&item.mime_type.startsWith('audio/')).sort((a,b)=>a.name.localeCompare(b.name,'fr'));
  const chosen=voices.find(item=>item.id===voiceId);
  const [measurement,setMeasurement]=useState(initialVoiceTimingMeasureState),task=useRef<ReturnType<typeof createVoiceTimingMeasurement>|null>(null),mounted=useRef(true);
  function commit(patch:ProjectData){latest.current={...latest.current,data:{...latest.current.data,...patch}};latest.current.onChange(patch);}
  function measuringTask(){
    if(!task.current){const own=createVoiceTimingMeasurement({current:()=>latest.current,apply:commit,onChange:state=>{if(mounted.current&&task.current===own)setMeasurement(state);}});task.current=own;}
    return task.current;
  }
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;const old=task.current;task.current=null;void old?.dispose();};},[]);
  useEffect(()=>{task.current?.check();},[template,data,disabled]);
  const keys=voiceTimingKeys(template);if(!keys)return null;
  const direct=baSocialDirect(template.id,data);
  const value=data._audio_voice_url??template.fields._audio_voice_url.default??'',start=Number(data[keys.start]??0),end=Number(data[keys.end]??0),mode=String(data._studio_ba_voice_fit||'source');
  const placementError=voiceTimingWarning(template,data),canMeasure=typeof value==='object'&&value.mimeType.startsWith('audio/'),progress=measurement.progress;
  function range(range:Partial<{start:number;end:number}>){task.current?.cancel();commit(voiceRangePatch(template,latest.current.data,range));}
  function numeric(value:string,apply:(seconds:number)=>void){const number=Number(value);if(Number.isFinite(number)&&number>=0)apply(number);}
  async function useTeamVoice(){
    if(!chosen||measurement.busy||disabled)return;setChoiceError('');
    audition.current?.pause();
    commit(chooseSharedVoice(template,latest.current.data,chosen));
    const own=measuringTask();await own.run();
    if(!mounted.current||latest.current.disabled||own.snapshot().phase!=='success')return;
    const current=latest.current.data,source=current._audio_voice_url;
    if(typeof source!=='object'||source.url!==sharedVoiceSource(chosen).url)return;
    try{commit(teamVoiceActivation(template,current,Number(current[voiceTimingKeys(template)!.end])));}
    catch(cause){setChoiceError(cause instanceof Error?cause.message:String(cause));}
  }
  return <section className="voice-timing-settings" aria-label="Passage et placement de la voix"><div className="help-title-row"><h3>Fichier & calage de la voix</h3><HelpBubble section="audio"/></div><fieldset disabled={disabled}>
    <div className="team-voice-picker"><h4>Les voix de l’équipe</h4>{voices.length?<>
      <label htmlFor={`${id}-team`}>Choisir une voix<select id={`${id}-team`} value={voiceId} disabled={measurement.busy} onChange={event=>setVoiceId(event.target.value)}><option value="">Choisir…</option>{voices.map(item=><option key={item.id} value={item.id}>{teamVoiceLabel(item.name)}</option>)}</select></label>
      {chosen?<><audio ref={audition} key={chosen.id} controls preload="none" src={sharedVoiceSource(chosen).url} aria-label={`Écouter ${teamVoiceLabel(chosen.name)}`} style={{width:'100%',maxWidth:'100%'}}/><button type="button" disabled={measurement.busy} onClick={()=>void useTeamVoice()}>Utiliser et caler cette voix</button><small>{direct?'La voix sera jouée une fois sur les extraits.':keys.ba?'Le fichier entier sera placé à l’introduction et au carton, sans coupe ni accélération.':'Le fichier entier sera activé. Le départ actuel est conservé et reste réglable ci-dessous.'} Écoutez pour vérifier le contenu : le nom du fichier ne vaut pas validation éditoriale.</small></>:null}
    </>:<p className="small">Aucune voix partagée pour le moment. Les fichiers locaux restent accessibles ci-dessous.</p>}{choiceError?<p role="alert" className="notice warning">{choiceError} La voix reste désactivée ; réglez son passage ci-dessous.</p>:null}</div>
    <label htmlFor={`${id}-file`}>Fichier de voix off</label><MediaSelect id={`${id}-file`} field={template.fields._audio_voice_url} value={value} media={media} emptyLabel="Aucune voix" onChange={next=>{
      task.current?.cancel('Le fichier a changé. Relancez la mesure pour cette source.');commit(voiceSourcePatch(template,latest.current.data,next));
    }} onRange={range} selectionAction={<div className="voice-whole-file" aria-busy={measurement.busy}>
      <button type="button" disabled={measurement.busy} onClick={()=>void measuringTask().run()}>Utiliser le fichier entier (durée décodée)</button>
      {measurement.busy?<><Activity label={measurement.message} percent={progress?.phase==='reading'&&progress.total?Math.min(99,Math.floor(progress.bytes/progress.total*100)):undefined} detail={progress?`${progress.bytes.toLocaleString('fr-FR')} octets lus${progress.total?` sur ${progress.total.toLocaleString('fr-FR')}`:''}.`:undefined}/><button type="button" disabled={measurement.phase==='cancelling'} onClick={()=>task.current?.cancel()}>Annuler la mesure</button></>:measurement.message?<p className={measurement.phase==='error'?'notice error':'small'} role={measurement.phase==='error'?'alert':'status'}>{measurement.message}</p>:null}
      <small>{canMeasure?'La durée exacte vient des échantillons décodés à 48 kHz, pas du lecteur. La mesure ne joue aucun son, n’active pas la piste et ne confirme pas le contenu.':'Choisissez un fichier audio local ou déjà partagé pour mesurer le fichier entier. Les repères manuels restent disponibles.'}</small>
    </div>}/>
    <p className="small muted">{direct?'Choisissez le passage et son départ, puis activez la voix. Aucun rappel à la fin.':'Choisir un nouveau fichier désactive la voix. Les deux départs sont conservés ; une ancienne adaptation complète devient un calage personnalisé à vérifier. Réglez le passage, écoutez-le puis activez sa piste ci-dessus.'} Aucun fichier n’est envoyé.</p>
    <div className="voice-timing-block"><h4>Passage à utiliser dans le fichier</h4><div className="voice-timing-grid">
      <label>IN du fichier (s)<input disabled={measurement.busy} type="number" min="0" max="86400" step="any" value={start} onChange={event=>numeric(event.target.value,start=>range({start}))}/></label>
      <label>OUT du fichier (s)<input disabled={measurement.busy} type="number" min="0" max="86400" step="any" value={end} onChange={event=>numeric(event.target.value,end=>range({end}))}/></label>
    </div><small>{direct?'OUT = 0 : repère non défini. Mesurez le fichier entier ou choisissez sa fin.':keys.ba?'Pour la BA, OUT = 0 signifie « repère non défini », pas « fichier entier ». Choisissez les deux repères ou mesurez le fichier entier : ce même passage est lu à l’introduction et au carton.':'OUT = 0 utilise la fin réellement décodée du fichier.'} Les repères ne changent pas la vitesse.</small>
    <fieldset disabled={measurement.busy}><MediaTrim value={value} module={template.module} start={start} end={end} explicitEnd={keys.ba} onChange={range}/></fieldset></div>
    <div className="voice-timing-block"><h4>Placement dans l’animation</h4><div className="voice-timing-grid">
      {keys.ba?<><label>{direct?'Départ sur les extraits (s)':'Introduction · départ après IN (s)'}<input type="number" min="0" max={direct?600:9.68} step=".01" value={Number(data[keys.placement[0]]??1.92)} onChange={event=>numeric(event.target.value,seconds=>onChange(voicePlacementPatch(template,'intro',seconds)))}/></label>{!direct?<label>Carton · départ après OUT (s)<input type="number" min="0" max="8.12" step=".01" value={Math.round((Number(data[keys.placement[1]]??68.48)-BA_CARTON_START)*1e9)/1e9} onChange={event=>numeric(event.target.value,seconds=>onChange(voicePlacementPatch(template,'outro',seconds)))}/></label>:null}</>:<label>Départ après IN (s)<input type="number" min="0" max={template.fields[keys.placement[0]].maximum??86400} step=".01" value={Number(data[keys.placement[0]]??0)} onChange={event=>numeric(event.target.value,seconds=>onChange(voicePlacementPatch(template,'delay',seconds)))}/></label>}
    </div>{direct?<small>Une seule lecture, sans signature sonore. La voix entière doit tenir avant la fin des extraits. Le placement TV de sortie est conservé.</small>:keys.ba?<><p className="small"><strong>{mode==='manual'?'Calage personnalisé':mode==='fit-complete'?'Placement complet accepté':'Calage du modèle'}</strong>. Modifier un départ passe en calage personnalisé, sans déplacer l’autre départ. Le jingle s’atténue autour de la voix ; le son des médias reste inchangé.</p>{mode==='fit-complete'?<small>Modifier le passage conserve les départs actuels et passe également en calage personnalisé.</small>:null}<small>Le passage entier doit tenir avant la fin de l’introduction et du carton. Le lancement de l’aperçu et l’export vérifient aussi votre durée réelle avant OUT ; aucune coupe automatique.</small></>:<small>Ce départ est indépendant du point IN dans le fichier. Le passage entier doit tenir dans la durée de l’animation ; ajustez la durée ou le départ, sans coupe automatique.</small>}</div>
    {placementError?<p className="notice warning" role="status">{placementError}</p>:null}
  </fieldset></section>;
}
