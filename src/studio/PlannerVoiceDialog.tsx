import {useEffect,useId,useRef,useState,useSyncExternalStore} from 'react';
import {Check,ChevronDown,Headphones,Mic2,RefreshCw,SlidersHorizontal,VolumeX} from 'lucide-react';
import type {MediaAsset} from './domain';
import type {ProfileAsset} from './preparation-profile-model';
import type {VoiceData} from './preparation-profile-model';
import {preparationProfiles} from './preparation-profile-api';
import {readProgrammeResources,programmeVoiceProposal} from './planner-programme-resources';
import {searchRead} from './planner-team-search';
import {api} from './api';
import {VoiceAudition} from './PreparationProfileEditor';
import {measureVoiceDuration} from './voice-duration';
import type {VoiceDurationProgress} from './voice-duration';
import {plannerVoiceCue,plannerVoicePatch,plannerVoicePlacement} from './planner-voice';
import {plannerVoiceLabels} from './planner-voice-model';
import type {PlannerVoice,PlannerVoiceKind} from './planner-voice-model';
import {plannerVoiceSeconds as seconds} from './planner-voice-ui';
import Activity from './Activity';
import NewProjectDialog from './NewProjectDialog';
import './planner-voice.css';

// decodeAudioData cannot be cancelled. Keep the lock beyond a dialog's lifetime
// until the actual promise settles, even after the timeout or a source change.
type Measurement={controller:AbortController;promise:Promise<void>};
let activeMeasurement:Measurement|null=null;
const measurementListeners=new Set<()=>void>();
const subscribeMeasurement=(listener:()=>void)=>{measurementListeners.add(listener);return()=>{measurementListeners.delete(listener);};};
const measurementBusy=()=>activeMeasurement!==null;
const publishMeasurement=()=>{for(const listener of measurementListeners)listener();};
const sourceFor=(asset:MediaAsset):ProfileAsset=>({url:`/api/graphics/media/${asset.id}/content`,name:asset.name,mimeType:asset.mime_type});
const number=(value:string)=>value.trim()?Number(value):NaN;
const identity=(source:ProfileAsset|null,duration:number|null,start:number,end:number,cue:string)=>JSON.stringify([source,duration,start,end,cue]);

type Props={kind:PlannerVoiceKind;airDate?:string;value?:PlannerVoice;title:string;programmeId?:string;programmeRevision?:number;onChange:(value?:PlannerVoice)=>void;onClose:()=>void};
export default function PlannerVoiceDialog({kind,airDate,value,title,programmeId,programmeRevision,onChange,onClose}:Props){
  const id=useId(),cue=plannerVoiceCue(kind,airDate);
  const [assets,setAssets]=useState<MediaAsset[]|null>(null),[loading,setLoading]=useState(true),[catalogueError,setCatalogueError]=useState(''),[retry,setRetry]=useState(0);
  const [source,setSource]=useState<ProfileAsset|null>(value?.source??null),[sourceDuration,setSourceDuration]=useState<number|null>(value?.sourceDuration??null);
  const [start,setStart]=useState(String(value?.start??0)),[end,setEnd]=useState(value?String(value.end):'');
  const [mode,setMode]=useState<'ba-auto'|'ba-manual'>(value?.placement.mode==='ba-manual'?'ba-manual':'ba-auto');
  const [intro,setIntro]=useState(String(value?.placement.mode==='ba-manual'?value.placement.intro:1.92));
  const [carton,setCarton]=useState(String(value?.placement.mode==='ba-manual'?value.placement.carton:3.68));
  const [delay,setDelay]=useState(String(value?.placement.mode==='single'?value.placement.delay:0));
  const initialIdentity=value&&value.cue===cue?identity(value.source,value.sourceDuration,value.start,value.end,cue):null;
  const [heard,setHeard]=useState<string|null>(initialIdentity),[confirmed,setConfirmed]=useState<string|null>(initialIdentity);
  const [measureMessage,setMeasureMessage]=useState(''),[measureError,setMeasureError]=useState(false),[progress,setProgress]=useState<VoiceDurationProgress|null>(null),[error,setError]=useState('');
  const [suggestion,setSuggestion]=useState<{name:string;revision:number;data:VoiceData}|null>(null),[suggestionMessage,setSuggestionMessage]=useState(''),[suggestionRetry,setSuggestionRetry]=useState(0);
  const suggestedRange=useRef<{start:number;end:number}|null>(null);
  const ownMeasurement=useRef<Measurement|null>(null),mounted=useRef(true),manualChosen=useRef(value?.placement.mode==='ba-manual'),previousCue=useRef(cue);
  const anyMeasurement=useSyncExternalStore(subscribeMeasurement,measurementBusy,()=>false),measuring=!!ownMeasurement.current;
  const startSeconds=number(start),endSeconds=number(end);
  const rangeReady=!!source&&sourceDuration!==null&&Number.isFinite(startSeconds)&&Number.isFinite(endSeconds)&&startSeconds>=0&&endSeconds-startSeconds>=.04-1e-7&&endSeconds<=sourceDuration+1e-7;
  const auditionKey=identity(source,sourceDuration,startSeconds,endSeconds,cue),hasHeard=heard===auditionKey,hasConfirmed=confirmed===auditionKey;
  const unavailable=!!source&&assets!==null&&!assets.some(asset=>sourceFor(asset).url===source.url);
  let candidate:PlannerVoice|undefined,placement:ReturnType<typeof plannerVoicePlacement>|undefined,validation='';
  if(rangeReady&&source&&sourceDuration!==null){
    candidate={source,sourceDuration,start:startSeconds,end:endSeconds,cue,confirmed:true,placement:kind==='ba'?mode==='ba-auto'?{mode}:{mode,intro:number(intro),carton:number(carton)}:{mode:'single',delay:number(delay)}};
    try{plannerVoicePatch(kind,candidate,airDate);placement=plannerVoicePlacement(kind,candidate);}
    catch(cause){validation=cause instanceof Error?cause.message:String(cause);}
  }
  function revoke(){setHeard(null);setConfirmed(null);setError('');}
  function cancelMeasurement(){ownMeasurement.current?.controller.abort(new DOMException('Mesure annulée. Le choix du fichier est conservé.','AbortError'));}
  function close(){cancelMeasurement();onClose();}
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;ownMeasurement.current?.controller.abort(new DOMException('Dialogue fermé.','AbortError'));};},[]);
  useEffect(()=>{if(previousCue.current!==cue){previousCue.current=cue;setHeard(null);setConfirmed(null);}},[cue]);
  useEffect(()=>{
    const c=new AbortController();setSuggestion(null);setSuggestionMessage('');
    if(programmeId)void (async()=>{
      try{
        const result=await readProgrammeResources({programmeId,programmeRevision},api.programme,c.signal);
        c.signal.throwIfAborted();if(result.warning){setSuggestionMessage(result.warning);return;}
        const profileId=result.programme?.data.voiceProfileId;if(!profileId)return;
        const profile=await searchRead(s=>preparationProfiles.get(profileId,s),c.signal,10000);c.signal.throwIfAborted();
        const data=programmeVoiceProposal(profile,cue);
        if(data)setSuggestion({name:profile.name,revision:profile.revision,data});
        else setSuggestionMessage('La voix habituelle n’est pas validée pour cette annonce. Choisissez un passage qui annonce le bon jour.');
      }catch{if(!c.signal.aborted)setSuggestionMessage('La voix habituelle est indisponible. Vos autres choix restent disponibles.');}
    })();
    return()=>c.abort();
  },[programmeId,programmeRevision,cue,suggestionRetry]);
  useEffect(()=>{
    let current=true;const controller=new AbortController();setLoading(true);setCatalogueError('');
    const timeout=setTimeout(()=>controller.abort(Error('La liste des audios tarde à répondre. Réessayez ; votre choix reste conservé.')),15000);
    void api.media(controller.signal).then(items=>{if(current)setAssets(items.filter(item=>item.status==='ready'&&item.mime_type.startsWith('audio/')).sort((a,b)=>a.name.localeCompare(b.name,'fr')));}).catch(cause=>{if(current){const reason=controller.signal.reason??cause;setCatalogueError(reason instanceof Error?reason.message:String(reason));}}).finally(()=>{clearTimeout(timeout);if(current)setLoading(false);});
    return()=>{current=false;clearTimeout(timeout);controller.abort();};
  },[retry]);
  function choose(url:string){
    suggestedRange.current=null;
    cancelMeasurement();revoke();const asset=assets?.find(item=>sourceFor(item).url===url);
    setSource(asset?sourceFor(asset):null);setSourceDuration(null);setStart('0');setEnd('');setProgress(null);setMeasureMessage('');setMeasureError(false);
  }
  async function measure(){
    if(!source||activeMeasurement)return;
    const selected=source,controller=new AbortController(),task:Measurement={controller,promise:Promise.resolve()};
    ownMeasurement.current=task;activeMeasurement=task;publishMeasurement();revoke();setMeasureError(false);setMeasureMessage('Lecture du fichier pour mesurer sa durée exacte…');setProgress(null);
    const abort=()=>{if(mounted.current&&ownMeasurement.current===task){setMeasureMessage(`${controller.signal.reason instanceof Error?controller.signal.reason.message:'Arrêt demandé.'} Libération du décodeur en cours ; aucune nouvelle mesure ne sera lancée avant sa fin.`);setMeasureError(true);}};
    controller.signal.addEventListener('abort',abort,{once:true});
    const timeout=setTimeout(()=>controller.abort(Error('La mesure dépasse 60 secondes.')),60000);
    task.promise=(async()=>{
      try{
        const duration=await measureVoiceDuration(selected,controller,p=>{if(mounted.current&&ownMeasurement.current===task&&!controller.signal.aborted){setProgress(p);setMeasureMessage(p.phase==='decoding'?'Décodage du son à 48 kHz…':'Lecture du fichier audio…');}});
        if(mounted.current&&ownMeasurement.current===task&&!controller.signal.aborted){const range=suggestedRange.current;suggestedRange.current=null;setSourceDuration(duration);setStart(String(range?.start??0));setEnd(String(range?.end??duration));setMeasureMessage(`${seconds(duration)} s mesurées.${range?' Repères de la fiche proposés ; vérifiez et écoutez le passage.':' Écoutez maintenant le passage.'}`);setMeasureError(false);}
      }catch(cause){if(mounted.current&&ownMeasurement.current===task){const reason=controller.signal.reason??cause;setMeasureMessage(reason instanceof Error?reason.message:String(reason));setMeasureError(true);}}
      finally{
        clearTimeout(timeout);controller.signal.removeEventListener('abort',abort);
        if(ownMeasurement.current===task)ownMeasurement.current=null;
        if(activeMeasurement===task)activeMeasurement=null;publishMeasurement();
      }
    })();
    await task.promise;
  }
  function setPlacement(next:'ba-auto'|'ba-manual'){
    if(next==='ba-manual'&&!manualChosen.current){if(placement){setIntro(String(Number(placement.intro!.toFixed(6))));setCarton(String(Number(placement.carton!.toFixed(6))));}manualChosen.current=true;}
    setMode(next);setError('');
  }
  function save(){
    if(!candidate||!hasConfirmed||measuring||unavailable||loading||catalogueError)return;
    try{plannerVoicePatch(kind,candidate,airDate);onChange(candidate);close();}catch(cause){setError(cause instanceof Error?cause.message:String(cause));}
  }
  return <NewProjectDialog labelledBy={`${id}-title`} busy={false} onClose={close}>
    <div className="planner-voice-dialog">
      <header><p className="eyebrow">À faire / Voix & calage</p><h2 id={`${id}-title`} tabIndex={-1} data-dialog-autofocus>{plannerVoiceLabels[kind]}</h2><p className="planner-voice-programme">{title}</p><p className="planner-voice-scope">Ce choix préparera les <strong>nouveaux brouillons de ce type, dans tous les formats retenus</strong>. Aucun projet déjà créé ne sera modifié.</p></header>
      <section className="planner-voice-section" aria-labelledby={`${id}-source-title`}>
        <h3 id={`${id}-source-title`}><span>01</span><Headphones size={18} aria-hidden="true"/>Le fichier et son passage</h3>
        {suggestion?<div className="notice"><p><strong>Voix de la fiche émission</strong> · {suggestion.name} · r{suggestion.revision}</p><button type="button" disabled={anyMeasurement||loading||!assets?.some(a=>sourceFor(a).url===suggestion.data.source.url)} onClick={()=>{cancelMeasurement();revoke();suggestedRange.current={start:suggestion.data.start,end:suggestion.data.end};setSource(suggestion.data.source);setSourceDuration(null);setStart(String(suggestion.data.start));setEnd(String(suggestion.data.end));setMeasureMessage('Mesurez le fichier puis écoutez le passage proposé.');setMeasureError(false);setProgress(null);}}>Proposer cette voix</button><p className="small muted">Aucun remplacement automatique. Le passage sera à écouter et à confirmer pour « {cue} ».</p></div>:null}
        {suggestionMessage?<p className="small" role="status">{suggestionMessage} <button type="button" className="quiet" onClick={()=>setSuggestionRetry(n=>n+1)}>Actualiser la fiche</button></p>:null}
        <label htmlFor={`${id}-source`}>Audio privé partagé<select id={`${id}-source`} value={source?.url??''} disabled={loading} onChange={event=>choose(event.target.value)}><option value="">{loading?'Chargement des audios…':'Choisir un fichier audio…'}</option>{source&&!assets?.some(asset=>sourceFor(asset).url===source.url)?<option value={source.url}>{source.name} · choix enregistré</option>:null}{assets?.map(asset=><option key={asset.id} value={sourceFor(asset).url}>{asset.name}</option>)}</select></label>
        <p className="small muted">Le nom du fichier est une étiquette, pas une validation de ce qu’il annonce. Aucun son n’est lu automatiquement.</p>
        {catalogueError?<div className="notice warning" role="alert"><p>{catalogueError}</p><button type="button" disabled={loading} onClick={()=>setRetry(n=>n+1)}><RefreshCw size={15} aria-hidden="true"/>Réessayer la liste</button></div>:null}
        {!loading&&!catalogueError&&assets?.length===0?<p className="notice" role="status">Aucun audio partagé prêt à être utilisé. Vous pouvez revenir à la grille ou préparer cet habillage sans voix.</p>:null}
        {unavailable?<p className="notice warning" role="alert">Le fichier enregistré n’apparaît plus dans les audios disponibles. Votre référence est conservée : vérifiez l’accès ou choisissez un autre fichier.</p>:null}
        {source?<div className="planner-voice-measure" aria-busy={measuring}>
          <button type="button" disabled={anyMeasurement||unavailable} onClick={()=>void measure()}>{sourceDuration===null?'Mesurer le fichier entier':'Reprendre le fichier entier'}</button>
          {measuring?<button type="button" disabled={ownMeasurement.current?.controller.signal.aborted} onClick={cancelMeasurement}>Annuler la mesure</button>:null}
          {measuring&&!ownMeasurement.current?.controller.signal.aborted?<Activity label={measureMessage} percent={progress?.phase==='reading'&&progress.total?Math.min(99,Math.floor(progress.bytes/progress.total*100)):undefined}/>:measureMessage?<p className={measureError?'notice warning':'small'} role={measureError?'alert':'status'}>{measureMessage}</p>:null}
          {anyMeasurement&&!measuring?<p className="small" role="status">La mesure précédente se termine. Vous pourrez en lancer une nouvelle dès que le décodeur sera libéré.</p>:null}
          {sourceDuration!==null?<><p className="planner-voice-duration"><strong>{rangeReady?`${seconds(endSeconds-startSeconds)} s`:'Passage à vérifier'}</strong><span>dans un fichier de {seconds(sourceDuration)} s</span></p><details className="planner-voice-range"><summary><SlidersHorizontal size={15} aria-hidden="true"/>Ajuster le passage dans le fichier<ChevronDown size={15} aria-hidden="true"/></summary><div className="planner-voice-fields"><label>Début dans le fichier (s)<input type="number" min="0" max={sourceDuration} step="any" value={start} disabled={measuring} onChange={event=>{revoke();setStart(event.target.value);}}/></label><label>Fin dans le fichier (s)<input type="number" min="0" max={sourceDuration} step="any" value={end} disabled={measuring} onChange={event=>{revoke();setEnd(event.target.value);}}/></label></div><p className="small muted">Le passage reste à sa vitesse d’origine. Modifier un repère impose une nouvelle écoute et une nouvelle confirmation.</p></details></>:<p className="small muted">La mesure utilise le son réellement décodé, pas la durée estimée du lecteur. Aucun fichier n’est envoyé.</p>}
          {sourceDuration!==null&&!rangeReady?<p className="notice warning" role="alert">Choisissez un passage d’au moins 0,04 s, entièrement compris dans ce fichier.</p>:null}
        </div>:null}
      </section>
      <section className="planner-voice-section" aria-labelledby={`${id}-cue-title`}>
        <h3 id={`${id}-cue-title`}><span>02</span><Mic2 size={18} aria-hidden="true"/>L’annonce à confirmer</h3>
        <div className="planner-voice-cue"><span>Ce que la voix doit annoncer</span><strong>{cue||'Date de diffusion à préciser'}</strong><small>{kind==='weekly'?'L’annonce du semainier, distincte des voix des sept programmes.':kind==='tds'?'Le modèle Tout de suite n’annonce ni jour ni horaire.':'Le jour correspond à la date de diffusion choisie dans la grille.'}</small></div>
        {value&&value.cue!==cue&&!hasConfirmed?<p className="notice warning" role="status">Le choix enregistré annonçait « {value.cue} ». Écoutez et confirmez le bon passage pour « {cue||'la date à préciser'} » ; rien n’a été remplacé.</p>:null}
        {source?<VoiceAudition key={auditionKey} source={source} start={rangeReady?startSeconds:0} end={rangeReady?endSeconds:0} blocked={!rangeReady||measuring||unavailable} onListened={()=>setHeard(auditionKey)}/>:null}
        <label className="planner-voice-confirm"><input type="checkbox" checked={hasConfirmed} disabled={!rangeReady||!cue||!hasHeard||measuring||unavailable} onChange={event=>setConfirmed(event.target.checked?auditionKey:null)}/><span>J’ai écouté ce passage et je confirme qu’il annonce <strong>« {cue||'le jour à préciser'} »</strong>.</span></label>
        <p className="small muted">{hasConfirmed?'Contenu confirmé pour cette préparation.':hasHeard?'Écoute terminée. Confirmez le contenu entendu.':'Écoutez le passage en entier pour activer la confirmation.'} Aucune reconnaissance automatique du contenu.</p>
      </section>
      <section className="planner-voice-section" aria-labelledby={`${id}-placement-title`}>
        <h3 id={`${id}-placement-title`}><span>03</span><SlidersHorizontal size={18} aria-hidden="true"/>Le placement dans l’habillage</h3>
        {kind==='ba'?<><fieldset className="planner-voice-modes"><legend>Ce même passage sera lu à l’introduction et au carton.</legend><label><input type="radio" name={`${id}-placement`} checked={mode==='ba-auto'} onChange={()=>setPlacement('ba-auto')}/>Proposer le placement complet</label><label><input type="radio" name={`${id}-placement`} checked={mode==='ba-manual'} onChange={()=>setPlacement('ba-manual')}/>Régler mes deux départs</label></fieldset>{mode==='ba-manual'?<div className="planner-voice-fields"><label>Introduction · après IN (s)<input type="number" min="0" max="9.68" step="any" value={intro} onChange={event=>{manualChosen.current=true;setIntro(event.target.value);}}/></label><label>Carton · après OUT (s)<input type="number" min="0" max="8.12" step="any" value={carton} onChange={event=>{manualChosen.current=true;setCarton(event.target.value);}}/></label></div>:placement?<div className="planner-voice-placement"><span>Introduction<strong>+{seconds(placement.intro!)} s après IN</strong></span><span>Carton<strong>+{seconds(placement.carton!)} s après OUT</strong></span></div>:<p className="small muted">Le placement sera calculé dès que le passage sera mesuré.</p>}<p className="small muted">Le jingle s’atténue autour de la voix. Le passage n’est ni coupé ni accéléré ; le son des vidéos reste inchangé.</p></>:<><label>Départ de la voix · après IN (s)<input type="number" min="0" max="600" step="any" value={delay} onChange={event=>setDelay(event.target.value)}/></label><p className="small muted">Un seul départ pour cet habillage. Il est indépendant du début du passage dans le fichier.</p></>}
        {validation?<p className="notice warning" role="alert">{validation}</p>:placement?<p className="planner-voice-fit"><Check size={16} aria-hidden="true"/>Le passage entier tient dans ce calage.</p>:null}
      </section>
      {error?<p className="notice error" role="alert">{error}</p>:null}
      <footer className="planner-voice-footer"><p className="small muted">Seul « Conserver » valide ce choix et ce placement. La signature sonore du modèle reste une option séparée.</p><div><button type="button" className="primary" disabled={!candidate||!hasConfirmed||!!validation||measuring||unavailable||loading||!!catalogueError} onClick={save}><Check size={17} aria-hidden="true"/>Conserver la voix et le calage</button><button type="button" onClick={close}>Revenir sans modifier</button></div><button type="button" className="quiet planner-voice-without" onClick={()=>{cancelMeasurement();onChange(undefined);onClose();}}><VolumeX size={16} aria-hidden="true"/>Préparer ce type sans voix off</button></footer>
    </div>
  </NewProjectDialog>;
}
