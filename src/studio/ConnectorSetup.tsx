import {useEffect,useId,useRef,useState} from 'react';
import {ArrowDownToLine,Check,ChevronDown,FolderLock,Link2,Monitor,RefreshCw,ShieldCheck,Unplug} from 'lucide-react';
import Activity from './Activity';
import {connectorDownloads,connectorHealth,connectorRoots,disconnectConnector,hasConnectorSession,pairConnector} from './connector-client';
import type {ConnectorRoot} from './connector-client';
import './connector-setup.css';
import {HelpBubble} from './GraphicsHelp';

type Platform='windows'|'mac';
type Step='idle'|'checking'|'pair'|'pairing'|'connected'|'refreshing';
type Retry='check'|'pair'|'roots';

function thisPlatform():Platform|null{
 if(typeof navigator==='undefined')return null;
 const platform=navigator.platform||navigator.userAgent;
 if(/win/i.test(platform))return 'windows';
 if(/mac/i.test(platform)&&navigator.maxTouchPoints<2)return 'mac';
 return null;
}

function rootStatus(root:ConnectorRoot){
 switch(root.state){
  case 'ready':return `${root.files} fichier${root.files===1?'':'s'} référencé${root.files===1?'':'s'}${root.partial?' · index partiel':''}`;
  case 'scanning':return 'Lecture des noms en cours';
  case 'error':return 'Dossier à vérifier dans le connecteur';
  case 'cancelled':return 'Lecture arrêtée';
  default:return 'Dossier autorisé · pas encore indexé';
 }
}

/** Optional, contextual setup. Merely rendering or expanding this card never contacts localhost. */
export default function ConnectorSetup({onConnected,context}:{onConnected?:()=>void;context?:'media-preparation'}){
 const preparing=context==='media-preparation';
 const id=useId(),[expanded,setExpanded]=useState(preparing),[platform,setPlatform]=useState<Platform|null>(thisPlatform);
 const [step,setStep]=useState<Step>('idle'),[code,setCode]=useState(''),[roots,setRoots]=useState<ConnectorRoot[]>([]),[authorized,setAuthorized]=useState(false);
 const [error,setError]=useState(''),[retry,setRetry]=useState<Retry>('check'),[notice,setNotice]=useState('');
 const [outdated,setOutdated]=useState(false);
 const control=useRef<AbortController|null>(null),trigger=useRef<HTMLButtonElement>(null),codeInput=useRef<HTMLInputElement>(null);
 const busy=step==='checking'||step==='pairing'||step==='refreshing';
 const connected=step==='connected'||(step==='refreshing'&&authorized);
 const download=platform?connectorDownloads[platform]:null;
 const platformName=platform==='mac'?'Mac':'Windows';

 useEffect(()=>()=>{control.current?.abort();control.current=null;},[]);
 useEffect(()=>{if(step==='pair'&&expanded)codeInput.current?.focus();},[step,expanded]);

 async function run(action:Retry){
  if(control.current)return;
  const controller=new AbortController();control.current=controller;
  setError('');setNotice('');setRetry(action);
  setStep(action==='pair'?'pairing':action==='roots'?'refreshing':'checking');
  try{
   const health=await connectorHealth(controller.signal);controller.signal.throwIfAborted();setOutdated(!health.capabilities?.includes(preparing?'media-preparation-v1':'episode-date-ranking'));
   if(action==='check'){
    if(!hasConnectorSession()){setStep('pair');return;}
   }
   if(action==='pair'){
    await pairConnector(code.trim(),controller.signal);controller.signal.throwIfAborted();
    setCode('');
   }
   const allowedRoots=await connectorRoots(controller.signal);controller.signal.throwIfAborted();
   setRoots(allowedRoots);setAuthorized(true);setStep('connected');setNotice('Connexion vérifiée. Seuls les fichiers et dossiers autorisés sont accessibles.');if(!preparing||health.capabilities?.includes('media-preparation-v1'))onConnected?.();
  }catch(reason){
   if(controller.signal.aborted)return;
   setRoots([]);setAuthorized(false);setStep(action==='pair'?'pair':'idle');
   setError(reason instanceof Error?reason.message:'Le connecteur ne répond pas.');
  }finally{if(control.current===controller)control.current=null;}
 }

 function collapse(){
  control.current?.abort();control.current=null;
  if(busy)setStep(authorized?'connected':'idle');
  setCode('');setError('');setExpanded(false);trigger.current?.focus();
 }

 function disconnect(){
  disconnectConnector();setRoots([]);setAuthorized(false);setCode('');setStep('idle');setError('');
  setNotice('Ce navigateur est déconnecté. Les autorisations des dossiers se gèrent dans le connecteur.');
 }

 return <section className="connector-setup" aria-label={preparing?'Préparer les fichiers professionnels':'Connecteur local facultatif'}>
  <button ref={trigger} type="button" className="connector-setup-trigger" aria-expanded={expanded} aria-controls={`${id}-content`} onClick={()=>expanded?collapse():setExpanded(true)}>
   <span className="connector-setup-icon">{connected?<Check size={21} strokeWidth={1.6} aria-hidden="true"/>:<Monitor size={23} strokeWidth={1.5} aria-hidden="true"/>}</span>
   <span className="connector-setup-intro"><strong>{connected?'Ce poste est connecté':preparing?'Connecter ce poste pour préparer la vidéo':hasConnectorSession()?'Retrouver mes dossiers connectés':'Retrouver les médias de ce poste'}</strong><small>{preparing?'MXF et MOV · connecteur Windows 0.3 requis':connected?`${roots.length} dossier${roots.length===1?'':'s'} autorisé${roots.length===1?'':'s'} · lecture seule`:'Facultatif · le choix de dossier ci-dessous fonctionne sans installation'}</small></span>
   <ChevronDown className="connector-setup-chevron" size={18} aria-hidden="true"/>
  </button>
  <div id={`${id}-content`} hidden={!expanded} className="connector-setup-content">
   <div className="help-title-row"><strong>Le connecteur, simplement</strong><HelpBubble section="connector"/></div>
   <p className="connector-setup-lead">{preparing?'Le connecteur crée une copie MP4 sur ce poste, utilisable dans les modèles. Vous autorisez uniquement le fichier choisi.':'Le connecteur aide Graphics à retrouver vos médias dans les dossiers de ce poste ou du réseau que vous autorisez.'}</p>
   <p className="connector-setup-privacy"><ShieldCheck size={18} aria-hidden="true"/><span>{preparing?'L’original reste intact. La copie reste sur ce poste ; aucun média n’est envoyé au cloud.':'Accès en lecture seule, limité aux dossiers choisis dans le connecteur. Vos fichiers restent sur le poste ou le réseau.'}</span></p>
   {outdated?<div className="notice warning" role="status"><strong>{preparing?'Mise à jour nécessaire pour préparer cette vidéo.':'Mise à jour du connecteur nécessaire pour la recherche réseau.'}</strong><p>{preparing?'La version 0.3 ajoute la préparation locale des vidéos professionnelles.':'La version actuelle inclut le classement par épisode et la reprise d’indexation.'}</p>{platform==='windows'&&download?.url?<><a className="button-link" href={download.url} download><ArrowDownToLine size={17}/>Télécharger la mise à jour Windows</a><p className="small">Après vos lectures et exports : arrêtez le connecteur, désinstallez l’ancienne application puis installez cette version. Les dossiers autorisés et index sont conservés ; aucun média n’est supprimé.</p></>:<p>{preparing?'Sur Mac, choisissez une copie MP4 déjà préparée.':'Le choix de dossiers ci-dessous reste disponible sans installation.'}</p>}</div>:null}

   {connected?<div className="connector-setup-connected">
    <div className="connector-setup-section-title"><FolderLock size={18} aria-hidden="true"/><h3>Dossiers autorisés sur ce poste</h3></div>
    {roots.length?<ul className="connector-setup-roots">{roots.map(root=><li key={root.id}><FolderLock size={18} aria-hidden="true"/><span><strong>{root.name}</strong><small>{rootStatus(root)}</small>{root.message?<small>{root.message}</small>:null}</span></li>)}</ul>:<p className="connector-setup-empty">{preparing?'Aucun dossier à indexer pour préparer une vidéo. Choisissez votre fichier avec le bouton de préparation.':'Le poste est connecté. Autorisez maintenant un dossier dans le connecteur, puis actualisez cette liste.'}</p>}
    <p className="connector-setup-note">Pour ajouter ou retirer un dossier, ouvrez la fenêtre du connecteur sur ce poste, puis actualisez la liste ici.</p>
    <div className="connector-setup-actions"><button type="button" disabled={busy} onClick={()=>void run('roots')}><RefreshCw size={16} aria-hidden="true"/>Actualiser</button></div>
    <p className="connector-setup-note">Vous vérifiez les propositions avant de relier un média à votre préparation.</p>
    <button type="button" className="quiet connector-setup-disconnect" disabled={busy} onClick={disconnect}><Unplug size={16} aria-hidden="true"/>Déconnecter ce navigateur</button>
   </div>:<>
    <details className="connector-setup-install" open>
     <summary>Je n’ai pas encore le connecteur</summary>
     <div className="connector-setup-section-title"><span className="connector-setup-number" aria-hidden="true">1</span><h3>Préparer ce poste</h3></div>
     <div className="connector-setup-platforms" role="group" aria-label="Système du poste">
      <button type="button" disabled={busy} aria-pressed={platform==='windows'} onClick={()=>setPlatform('windows')}>Windows</button>
      <button type="button" disabled={busy} aria-pressed={platform==='mac'} onClick={()=>setPlatform('mac')}>Mac</button>
     </div>
     {download?.url?<div className="connector-setup-download"><a className="button-link" href={download.url} download><ArrowDownToLine size={17} aria-hidden="true"/>{download.label}</a><p>{preparing?'Windows 64 bits · version interne non signée. Installez puis ouvrez le connecteur et connectez ce navigateur. Aucun dossier à indexer pour préparer un fichier.':'Windows 64 bits · version interne non signée. Installez puis ouvrez le connecteur, choisissez vos dossiers et cliquez sur « Ouvrir Graphics ».'}</p><p className="connector-setup-note">{preparing?'Si Windows ou votre organisation bloque l’installation, ne désactivez pas les protections. Utilisez une copie MP4 déjà préparée.':'Si Windows ou votre organisation bloque l’installation, ne désactivez pas les protections : le choix de dossiers ci-dessous reste utilisable.'}</p><details><summary>Vérifier le fichier</summary><p className="connector-setup-note" style={{overflowWrap:'anywhere'}}>SHA-256 : {download.sha256}</p></details></div>:<p className="connector-setup-note">{platform==='mac'?(preparing?'La préparation MXF/MOV n’est pas encore disponible sur Mac. Utilisez une copie MP4 préparée sur un poste Windows.':'Sur Mac, rien à installer : connectez le disque réseau dans Finder, puis utilisez le choix de dossier ci-dessous. Safari peut vous demander de le sélectionner à nouveau à la prochaine session.'):platform?`L’installateur pour ${platformName} n’est pas encore disponible.`:'Choisissez Windows ou Mac.'}</p>}
    </details>

    <div className="connector-setup-pair">
     <div className="connector-setup-section-title"><Link2 size={18} aria-hidden="true"/><h3>{preparing?'Connecter ce navigateur':'Retrouver mes dossiers'}</h3></div>
     {step==='pair'||step==='pairing'?<>
      <p>Dans le connecteur, cliquez sur « Ouvrir Graphics et connecter ces dossiers ». Si vous préférez garder ce navigateur et cette préparation, utilisez le code de connexion ci-dessous.</p>
      <label htmlFor={`${id}-code`}>Code de jumelage<input ref={codeInput} id={`${id}-code`} value={code} disabled={busy} autoComplete="one-time-code" autoCapitalize="off" spellCheck={false} maxLength={128} aria-describedby={`${id}-code-help`} onChange={event=>setCode(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&code.trim()&&!busy){event.preventDefault();void run('pair');}}}/></label>
      <p id={`${id}-code-help`} className="connector-setup-note">Le code est fourni par le connecteur sur ce poste.</p>
      <button type="button" className="primary" disabled={busy||!code.trim()} onClick={()=>void run('pair')}><Link2 size={17} aria-hidden="true"/>{error?'Réessayer le jumelage':'Connecter ce poste'}</button>
     </>:<>
      <p>Si le connecteur est déjà installé, ouvrez-le sur ce poste puis vérifiez sa connexion.</p>
      <button type="button" disabled={busy} onClick={()=>void run('check')}><Link2 size={17} aria-hidden="true"/>{error&&retry==='check'?'Réessayer la connexion':'Vérifier le connecteur'}</button>
     </>}
    </div>
   </>}

   {busy?<Activity label={step==='checking'?'Vérification du connecteur sur ce poste':step==='pairing'?'Connexion aux dossiers autorisés':'Actualisation des dossiers autorisés'}/>:null}
   {error?<div className="notice warning connector-setup-error" role="alert"><strong>La connexion n’a pas abouti.</strong><p>{error}</p><p>Vérifiez que le connecteur est ouvert et que le navigateur autorise l’accès au réseau local. Si cette connexion n’est pas disponible, le choix manuel reste utilisable.</p>{retry==='roots'?<button type="button" disabled={busy} onClick={()=>void run('roots')}><RefreshCw size={16} aria-hidden="true"/>Réessayer l’actualisation</button>:null}{hasConnectorSession()?<button type="button" disabled={busy} onClick={()=>{disconnect();setNotice('');setStep('pair');}}>Jumeler à nouveau</button>:null}</div>:null}
   {notice?<p className="connector-setup-note" role="status">{notice}</p>:null}
   <div className="connector-setup-footer"><button type="button" className="quiet" onClick={collapse}>{preparing?'Revenir au fichier':connected?'Revenir à la recherche de médias':'Continuer sans connecteur'}</button>{!connected&&!preparing?<small>Vous pourrez l’activer plus tard, depuis cette recherche.</small>:null}</div>
  </div>
 </section>;
}
