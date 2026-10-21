import {useCallback,useEffect,useRef,useState} from 'react';
import type {FormEvent,MutableRefObject} from 'react';
import {ArrowRight,CalendarDays,Check,ChevronDown,Plus,Search,Tv} from 'lucide-react';
import {api,request} from './api';
import {activeChannelId,selectChannel} from './channel-context';
import type {Channel,Programme,ProgrammeData,SearchResults} from './channel-model';
import {channelPresets,channelNameKey} from './channel-presets';
import {canApprove,statusLabels} from './domain';
import type {Member,Project} from './domain';
import {plannerKinds,plannerLabels} from './day-planner-model';
import type {PlannerSummary} from './day-planner-model';
import {plannerAPI} from './day-planner-api';
import {preparationProfiles} from './preparation-profile-api';
import {sharedProfileAsset} from './preparation-profile-model';
import type {PreparationProfileCursor,PreparationProfileSummary} from './preparation-profile-model';
import type {MediaAsset} from './domain';
import type {WorkspaceNavigation} from './Workspace';
import NewProjectDialog from './NewProjectDialog';
import './channel-workspace.css';
import {HelpBubble} from './GraphicsHelp';

const message=(error:unknown)=>error instanceof Error?error.message:'Action non confirmée.';

type ResourcePage<T,C>={rows:T[];next:C|null};
function useResourcePages<T extends {id:string},C>(fetchPage:(cursor:C|null,signal:AbortSignal)=>Promise<ResourcePage<T,C>>){
  const [rows,setRows]=useState<T[]>([]),[next,setNext]=useState<C|null>(null),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const requestRef=useRef<AbortController|null>(null),cursorRef=useRef<C|null>(null);
  const load=useCallback(async(cursor:C|null)=>{
    if(requestRef.current)return;
    const controller=new AbortController();requestRef.current=controller;cursorRef.current=cursor;setBusy(true);setError('');
    try{
      const page=await fetchPage(cursor,controller.signal);
      if(controller.signal.aborted)return;
      setRows(previous=>cursor===null?page.rows:[...new Map([...previous,...page.rows].map(row=>[row.id,row])).values()]);setNext(page.next);setLoaded(true);
    }catch(error){if(!controller.signal.aborted)setError(message(error));}
    finally{if(requestRef.current===controller){requestRef.current=null;if(!controller.signal.aborted)setBusy(false);}}
  },[fetchPage]);
  useEffect(()=>{void load(null);return()=>{requestRef.current?.abort();requestRef.current=null;};},[load]);
  return {rows,next,loaded,busy,error,retry:()=>void load(cursorRef.current),more:()=>{if(next!==null)void load(next);}};
}
const mediaUrl=(id:string)=>`/api/graphics/media/${id}/content`;
const loadLogos=async(_cursor:null,signal:AbortSignal):Promise<ResourcePage<MediaAsset,never>>=>({rows:(await api.media(signal)).filter(media=>media.status==='ready'&&media.mime_type.startsWith('image/')&&sharedProfileAsset.test(mediaUrl(media.id))),next:null});
const loadVoices=async(next:PreparationProfileCursor|null,signal:AbortSignal):Promise<ResourcePage<PreparationProfileSummary,PreparationProfileCursor>>=>{
  const page=await preparationProfiles.list({kind:'voice',limit:50,next},signal);
  return {rows:page.profiles.filter(profile=>profile.kind==='voice'&&!profile.archived&&!!profile.validated_by&&!!profile.validated_at),next:page.next};
};
const loadDirectories=async(offset:number|null,signal:AbortSignal):Promise<ResourcePage<PlannerSummary,number>>=>{
  const page=await plannerAPI.list('directory',offset??0,undefined,signal);
  return {rows:page.documents.filter(directory=>directory.kind==='directory'&&!directory.archived),next:page.next};
};
function ResourceError({error,retry}:{error:string;retry:()=>void}){return error?<div className="resource-error"><p role="alert">{error}</p><button type="button" onClick={retry}>Réessayer</button></div>:null;}
function SharedLogoField({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}){
  const resource=useResourcePages(loadLogos);
  const missing=!!value&&!resource.rows.some(media=>mediaUrl(media.id)===value);
  return <fieldset className="shared-resource-field"><legend>{label}</legend>
    <select aria-label={label} value={value} onChange={event=>onChange(event.target.value)}><option value="">Aucun logo</option>{missing?<option value={value}>Logo associé · référence conservée</option>:null}{resource.rows.map(media=><option key={media.id} value={mediaUrl(media.id)}>{media.name}</option>)}</select>
    {resource.busy||(!resource.loaded&&!resource.error)?<p className="resource-hint" role="status">Chargement des images partagées…</p>:null}
    <ResourceError error={resource.error} retry={resource.retry}/>
    {resource.loaded&&!resource.error&&!resource.rows.length?<p className="resource-hint">Aucune image partagée prête dans cette chaîne.</p>:null}
    <p className="resource-hint">Choisissez une image déjà partagée dans la médiathèque de cette chaîne. Aucun import n’est lancé ici.</p>
    {missing?<p className="resource-hint">Le logo enregistré reste conservé tant que vous ne le remplacez pas.</p>:null}
  </fieldset>;
}
function UsualVoiceField({value,onChange}:{value:string|null;onChange:(value:string|null)=>void}){
  const resource=useResourcePages(loadVoices);
  const missing=!!value&&!resource.rows.some(voice=>voice.id===value);
  return <fieldset className="shared-resource-field"><legend>Voix habituelle</legend>
    <select aria-label="Voix habituelle" value={value??''} onChange={event=>onChange(event.target.value||null)}><option value="">Aucune voix habituelle</option>{missing?<option value={value!}>Voix associée · référence conservée</option>:null}{resource.rows.map(voice=><option value={voice.id} key={voice.id}>{voice.name}</option>)}</select>
    {resource.busy||(!resource.loaded&&!resource.error)?<p className="resource-hint" role="status">Chargement des voix validées…</p>:null}
    <ResourceError error={resource.error} retry={resource.retry}/>
    {resource.loaded&&!resource.error&&!resource.rows.length?<p className="resource-hint">{resource.next?'Aucune voix validée dans les résultats chargés.':'Aucune voix validée disponible dans cette chaîne.'}</p>:null}
    {resource.next&&!resource.error?<button type="button" className="resource-more" disabled={resource.busy} onClick={resource.more}>Charger d’autres voix</button>:null}
    <p className="resource-hint">Profil validé de cette chaîne, à confirmer lors de la préparation. Aucun son ni calage n’est appliqué automatiquement.</p>
    {missing?<p className="resource-hint">La voix enregistrée n’est pas dans les résultats chargés ; sa référence est conservée.</p>:null}
  </fieldset>;
}
function DirectoryField({value,onChange}:{value:string[];onChange:(value:string[])=>void}){
  const resource=useResourcePages(loadDirectories);
  const missing=value.filter(id=>!resource.rows.some(directory=>directory.id===id));
  function toggle(id:string,checked:boolean){onChange(checked?[...value,id]:value.filter(value=>value!==id));}
  return <fieldset className="shared-resource-field"><legend>Emplacements partagés</legend>
    <p className="resource-hint">Ces liens vers le catalogue n’autorisent pas l’accès au disque local ou au réseau. L’accès reste à confirmer dans le connecteur ; aucun fichier n’est lié automatiquement.</p>
    <div className="resource-options">{resource.rows.map(directory=><label className="programme-check" key={directory.id}><input type="checkbox" checked={value.includes(directory.id)} disabled={!value.includes(directory.id)&&value.length>=32} onChange={event=>toggle(directory.id,event.target.checked)}/><span>{directory.name}</span></label>)}
      {missing.map(id=><label className="programme-check" key={id}><input type="checkbox" checked onChange={()=>toggle(id,false)}/><span>Emplacement associé non chargé<small>Référence conservée · {id.slice(0,8)}</small></span></label>)}
    </div>
    {resource.busy||(!resource.loaded&&!resource.error)?<p className="resource-hint" role="status">Chargement des emplacements…</p>:null}
    <ResourceError error={resource.error} retry={resource.retry}/>
    {resource.loaded&&!resource.error&&!resource.rows.length?<p className="resource-hint">{resource.next!==null?'Aucun emplacement disponible dans les résultats chargés.':'Aucun emplacement partagé disponible dans cette chaîne.'}</p>:null}
    {resource.next!==null&&!resource.error?<button type="button" className="resource-more" disabled={resource.busy} onClick={resource.more}>Charger d’autres emplacements</button>:null}
    {value.length>=32?<p className="resource-hint">32 emplacements maximum. Retirez un lien pour en ajouter un autre.</p>:null}
  </fieldset>;
}

type ChannelIdentity=Pick<Channel,'name'|'logo'|'accent'|'timezone'>;
const identityOf=(channel:Channel):ChannelIdentity=>({name:channel.name,logo:channel.logo||'',accent:channel.accent,timezone:channel.timezone});

export function ChannelSwitcher({onSelected}:{onSelected?:(name:string)=>void}={}){
  const [channels,setChannels]=useState<Channel[]>([]),[error,setError]=useState(''),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[name,setName]=useState(''),[loaded,setLoaded]=useState(false);
  const [team,setTeam]=useState<Member[]>([]),[members,setMembers]=useState<Member[]>([]),[showTeam,setShowTeam]=useState(false);
  const [identity,setIdentity]=useState<ChannelIdentity|null>(null),[identityOpened,setIdentityOpened]=useState(false),[savedNotice,setSavedNotice]=useState(''),[pendingLeave,setPendingLeave]=useState<{next:()=>void}|null>(null),[createdChannel,setCreatedChannel]=useState<string|null>(null);
  const selected=channels.find(channel=>channel.id===activeChannelId());
  useEffect(()=>{onSelected?.(selected?.name||'');},[onSelected,selected?.name]);
  const identityDirty=!!identity&&!!selected&&JSON.stringify(identity)!==JSON.stringify(identityOf(selected));
  const dirty=open&&(identityDirty||!!name.trim());
  useEffect(()=>{
    let cancelled=false;
    void api.channels().then(rows=>{
      if(cancelled)return;
      setChannels(rows);
      if(rows.length&&!rows.some(channel=>channel.id===activeChannelId()))selectChannel(rows[0].id);
    }).catch(error=>{if(!cancelled)setError(message(error));}).finally(()=>{if(!cancelled)setLoaded(true);});
    return()=>{cancelled=true;};
  },[]);
  useEffect(()=>{
    const unload=(event:BeforeUnloadEvent)=>{if(dirty||busy)event.preventDefault();};
    const change=(event:Event)=>{
      if(event.defaultPrevented||(!dirty&&!busy))return;
      const proceed=(event as CustomEvent<{proceed?:()=>void}>).detail?.proceed;
      if(proceed){event.preventDefault();setPendingLeave({next:proceed});}
    };
    window.addEventListener('beforeunload',unload);window.addEventListener('srtb-before-channel-change',change);
    return()=>{window.removeEventListener('beforeunload',unload);window.removeEventListener('srtb-before-channel-change',change);};
  },[dirty,busy]);
  function closeManager(){setOpen(false);setName('');setIdentity(null);setIdentityOpened(false);setSavedNotice('');setShowTeam(false);}
  function requestClose(){if(dirty)setPendingLeave({next:closeManager});else closeManager();}
  async function createChannel(){
    if(busy)return;setBusy(true);setError('');setSavedNotice('');
    try{
      const channel=await api.createChannel({name:name.trim(),accent:'#EFBD32',timezone:'Africa/Porto-Novo'});
      setChannels(rows=>[...rows.filter(row=>row.id!==channel.id),{...channel,canManage:true}]);closeManager();
      // Let dirty guards observe the successful save before switching context.
      setCreatedChannel(channel.id);
    }catch(error){setError(message(error));}finally{setBusy(false);}
  }
  useEffect(()=>{if(createdChannel&&!dirty&&!busy){selectChannel(createdChannel);setCreatedChannel(null);}},[createdChannel,dirty,busy]);
  async function saveIdentity(event:FormEvent){
    event.preventDefault();if(!identity||!selected||busy)return;setError('');setSavedNotice('');
    const data={...identity,name:identity.name.trim(),accent:identity.accent.trim(),timezone:identity.timezone.trim()};
    try{new Intl.DateTimeFormat('fr',{timeZone:data.timezone});}catch{setError('Fuseau horaire non reconnu. Exemple : Africa/Porto-Novo.');return;}
    setBusy(true);
    try{
      const saved=await api.updateChannel(selected.id,selected.revision,data);
      setChannels(rows=>rows.map(channel=>channel.id===saved.id?saved:channel));setIdentity(identityOf(saved));setSavedNotice('Identité de la chaîne enregistrée.');
    }catch(error){setError(message(error));}finally{setBusy(false);}
  }
  async function loadTeam(){
    setBusy(true);setError('');
    try{const [allowed,all]=await Promise.all([api.channelMembers(activeChannelId()),api.members()]);setTeam(allowed);setMembers(all);setShowTeam(true);}
    catch(error){setError(message(error));}finally{setBusy(false);}
  }
  async function updateMember(member:Member,allowed:boolean){
    setBusy(true);setError('');
    try{await api.setChannelMember(activeChannelId(),member.email,allowed);setTeam(rows=>allowed?[...rows.filter(row=>row.email!==member.email),member]:rows.filter(row=>row.email!==member.email));}
    catch(error){setError(message(error));}finally{setBusy(false);}
  }
  return <div className="channel-switcher">
    {selected?.logo&&sharedProfileAsset.test(selected.logo)?<img className="channel-logo" src={selected.logo} alt="" width="28" height="28"/>:<Tv size={20} aria-hidden="true"/>}
    <select aria-label="Chaîne de travail" value={selected?.id||''} onChange={event=>selectChannel(event.target.value)} disabled={!channels.length}><option value="" disabled>{channels.length?'Choisir une chaîne':error?'Chaînes indisponibles':loaded?'Aucune chaîne accessible':'Chargement…'}</option>{channels.map(channel=><option value={channel.id} key={channel.id}>{channel.name}</option>)}</select>
    {selected?.canManage?<button type="button" className="quiet channel-manage" aria-label="Gérer les chaînes" title="Chaînes, identité et accès de l’équipe" onClick={()=>{setIdentity(identityOf(selected));setOpen(true);setError('');}}>Gérer</button>:null}
    <HelpBubble section="channels"/>
    {error&&!open?<span className="channel-error" role="alert">{error}</span>:null}
    {open?<NewProjectDialog busy={busy} labelledBy="channel-title" onClose={requestClose}><div className="channel-dialog-content">
      <h2 id="channel-title">Chaînes & équipes</h2>
      {error?<p role="alert" className="notice error">{error}</p>:null}
      {savedNotice?<p className="small" role="status">{savedNotice}</p>:null}
      <form onSubmit={event=>{event.preventDefault();if(identityDirty)setPendingLeave({next:()=>void createChannel()});else void createChannel();}}><fieldset className="channel-preset-choices" disabled={busy}><legend>Ajouter un espace de chaîne</legend><div>{channelPresets.map(preset=>{const exists=channels.some(channel=>channelNameKey(channel.name)===channelNameKey(preset));return <button key={preset} type="button" aria-pressed={name===preset} disabled={exists} onClick={()=>setName(preset)}><Tv size={16} aria-hidden="true"/>{preset}{exists?<Check size={14} aria-label="Déjà créée"/>:null}</button>;})}</div></fieldset><label>Nouvelle chaîne<input data-dialog-autofocus value={name} onChange={event=>setName(event.target.value)} maxLength={120} required disabled={busy} placeholder="Nom de votre chaîne"/></label><p className="small muted">Bibliothèque, médias, voix et émissions séparés, vides au départ. Aucun modèle BTV n’est copié. Choisissez ensuite l’équipe autorisée.</p><button className="primary" disabled={busy||!name.trim()}><Plus size={16} aria-hidden="true"/>{busy?'En cours…':'Créer la chaîne'}</button></form>
      {identity?<details className="channel-identity resource-disclosure" onToggle={event=>{if(event.currentTarget.open)setIdentityOpened(true);}}><summary>Identité de la chaîne</summary><form onSubmit={event=>void saveIdentity(event)}><fieldset className="channel-identity-fields" disabled={busy}>
        <label>Nom de la chaîne<input value={identity.name} required maxLength={120} onChange={event=>{setIdentity({...identity,name:event.target.value});setSavedNotice('');}}/></label>
        {identityOpened?<SharedLogoField label="Logo de la chaîne" value={identity.logo} onChange={logo=>{setIdentity({...identity,logo});setSavedNotice('');}}/>:null}
        <label>Couleur d’accent<span className="channel-colour-input"><span aria-hidden="true" style={{backgroundColor:/^#[\da-f]{6}$/i.test(identity.accent)?identity.accent:'transparent'}}/><input value={identity.accent} required pattern="#[0-9a-fA-F]{6}" title="Couleur hexadécimale à six caractères, par exemple #EFBD32" maxLength={7} spellCheck={false} onChange={event=>{setIdentity({...identity,accent:event.target.value});setSavedNotice('');}}/></span></label>
        <label>Fuseau horaire<input value={identity.timezone} required maxLength={100} placeholder="Africa/Porto-Novo" spellCheck={false} onChange={event=>{setIdentity({...identity,timezone:event.target.value});setSavedNotice('');}}/><small className="resource-hint">Exemple : Africa/Porto-Novo.</small></label>
      </fieldset><div className="row"><button className="primary" disabled={busy||!identityDirty}>Enregistrer l’identité</button><button type="button" disabled={busy||!identityDirty} onClick={()=>{if(selected)setIdentity(identityOf(selected));setError('');setSavedNotice('');}}>Rétablir</button></div></form></details>:null}
      <div className="channel-team-section"><button type="button" disabled={busy} aria-expanded={showTeam} onClick={()=>showTeam?setShowTeam(false):void loadTeam()}>Équipe · {selected?.name}<ChevronDown size={16} aria-hidden="true"/></button>
        {showTeam?<ul className="channel-team">{members.map(member=><li key={member.email}><label><input type="checkbox" disabled={busy||member.role==='admin'} checked={member.role==='admin'||team.some(row=>row.email===member.email)} onChange={event=>void updateMember(member,event.target.checked)}/><span>{member.name}<small>{member.role==='admin'?'Accès administrateur':member.email}</small></span></label></li>)}</ul>:null}
      </div>
    </div></NewProjectDialog>:null}
    {pendingLeave?<NewProjectDialog busy={busy} labelledBy="channel-leave-title" onClose={()=>setPendingLeave(null)}><h2 id="channel-leave-title">Conserver ces réglages ouverts ?</h2><p>Vos modifications ne sont pas encore enregistrées.</p><div className="row"><button className="primary" disabled={busy} onClick={()=>setPendingLeave(null)}>Continuer la modification</button><button disabled={busy} onClick={()=>{const next=pendingLeave.next;setPendingLeave(null);next();}}>Fermer sans enregistrer</button></div></NewProjectDialog>:null}
  </div>;
}

const emptyProgramme:ProgrammeData={name:'',aliases:[],category:'',replayUrl:'',recurring:false,recipe:[],notes:'',directoryIds:[],voiceProfileId:null,logo:''};
const programmeData=(data:ProgrammeData):ProgrammeData=>({...data,logo:data.logo||''});
function ProgrammeResources({draft,onChange}:{draft:ProgrammeData;onChange:(data:ProgrammeData)=>void}){
  const [opened,setOpened]=useState(false);
  return <details className="resource-disclosure programme-resources" onToggle={event=>{if(event.currentTarget.open)setOpened(true);}}><summary>Réglages avancés</summary>
    {opened?<div className="programme-resource-fields"><SharedLogoField label="Logo de l’émission" value={draft.logo||''} onChange={logo=>onChange({...draft,logo})}/><UsualVoiceField value={draft.voiceProfileId} onChange={voiceProfileId=>onChange({...draft,voiceProfileId})}/><DirectoryField value={draft.directoryIds} onChange={directoryIds=>onChange({...draft,directoryIds})}/></div>:null}
  </details>;
}
export function ProgrammeWorkspace({member,navigationRef}:{member:Member;navigationRef?:MutableRefObject<WorkspaceNavigation|null>}){
  const [programmes,setProgrammes]=useState<Programme[]>([]),[draft,setDraft]=useState<ProgrammeData|null>(null),[selected,setSelected]=useState<Programme|null>(null),[filter,setFilter]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false);
  const [pendingLeave,setPendingLeave]=useState<{next:()=>void}|null>(null);
  const firstField=useRef<HTMLInputElement>(null);
  const canEditRecipe=canApprove(member.role);
  const dirty=draft!==null&&JSON.stringify(draft)!==JSON.stringify(programmeData(selected?.data??emptyProgramme));
  useEffect(()=>{let cancelled=false;void api.programmes().then(rows=>{if(!cancelled){setProgrammes(rows);setLoaded(true);}}).catch(error=>{if(!cancelled)setError(message(error));});return()=>{cancelled=true;};},[]);
  useEffect(()=>{if(draft)firstField.current?.focus();},[selected?.id,draft===null]);
  useEffect(()=>{
    function leave(next:()=>void){if(dirty||busy)setPendingLeave({next});else next();}
    if(navigationRef)navigationRef.current={leave};
    const change=(event:Event)=>{
      if(event.defaultPrevented||(!dirty&&!busy))return;
      const proceed=(event as CustomEvent<{proceed?:()=>void}>).detail?.proceed;
      if(proceed){event.preventDefault();leave(proceed);}
    };
    const unload=(event:BeforeUnloadEvent)=>{if(dirty||busy)event.preventDefault();};
    window.addEventListener('srtb-before-channel-change',change);window.addEventListener('beforeunload',unload);
    return()=>{if(navigationRef)navigationRef.current=null;window.removeEventListener('srtb-before-channel-change',change);window.removeEventListener('beforeunload',unload);};
  },[dirty,busy,navigationRef]);
  function leave(next:()=>void){if(dirty||busy)setPendingLeave({next});else next();}
  function edit(value:Programme|null){leave(()=>{setSelected(value);setDraft(structuredClone(programmeData(value?.data??emptyProgramme)));setError('');});}
  async function save(event:FormEvent){
    event.preventDefault();if(!draft||busy)return;setBusy(true);setError('');
    try{
      const data={...draft,name:draft.name.trim(),aliases:draft.aliases.map(alias=>alias.trim()).filter(Boolean)};
      const saved=await api.saveProgramme(selected?.id||null,selected?.revision||0,data);
      setProgrammes(rows=>[...rows.filter(row=>row.id!==saved.id),saved].sort((a,b)=>a.name.localeCompare(b.name,'fr')));setSelected(saved);setDraft(null);
    }catch(error){setError(message(error));}finally{setBusy(false);}
  }
  const query=filter.trim().toLocaleLowerCase('fr');
  const visible=programmes.filter(programme=>[programme.name,...programme.data.aliases].some(name=>name.toLocaleLowerCase('fr').includes(query)));
  return <section className="programme-workspace">
    <header className="section-heading"><div><div className="help-title-row"><h1>Émissions</h1><HelpBubble section="programmes" role={member.role}/></div><p>Les fiches communes à votre chaîne. Vos montages restent dans Projets.</p></div><button onClick={()=>edit(null)} disabled={busy}><Plus size={17} aria-hidden="true"/>Nouvelle émission</button></header>
    {error?<p className="notice error" role="alert">{error}</p>:null}
    <label className="channel-search"><span className="sr-only">Rechercher une émission</span><span className="search-control"><Search size={18} aria-hidden="true"/><input type="search" placeholder="Rechercher une émission…" value={filter} onChange={event=>setFilter(event.target.value)}/></span></label>
    <div className={`programme-layout${draft&&programmes.length?' has-inspector':''}`}><div className="programme-list" hidden={!!draft&&!programmes.length}>
      {!loaded&&!error?<p role="status">Chargement des émissions…</p>:null}
      {loaded&&!visible.length?<div className="empty"><Tv size={28} strokeWidth={1.3} aria-hidden="true"/><h2>{query?'Aucune émission trouvée':'Aucune émission pour le moment'}</h2><p>{query?'Essayez un autre titre.':'Créez une fiche pour retrouver ses réglages et ses habitudes.'}</p>{query?<button onClick={()=>setFilter('')}>Effacer la recherche</button>:null}</div>:null}
      {visible.map(programme=><button type="button" aria-pressed={selected?.id===programme.id} key={programme.id} onClick={()=>edit(programme)} disabled={busy}><Tv size={20} aria-hidden="true"/><span><strong>{programme.name}</strong><small>{programme.data.category||'Émission'}{programme.data.recurring?' · Habillage permanent':''}</small></span><span className="muted">v{programme.revision}</span><ArrowRight size={16} aria-hidden="true"/></button>)}
    </div>
    {draft?<form className="programme-inspector" onSubmit={event=>void save(event)}><h2>{selected?'Fiche émission':'Nouvelle émission'}</h2><fieldset disabled={busy} className="programme-fields">
      <label>Titre officiel<input ref={firstField} value={draft.name} required maxLength={200} onChange={event=>setDraft({...draft,name:event.target.value})}/></label>
      <label>Autres noms <span className="muted">Un nom par ligne</span><textarea value={draft.aliases.join('\n')} onChange={event=>setDraft({...draft,aliases:event.target.value.split('\n')})}/></label>
      <label>Type d’émission<input value={draft.category} maxLength={80} onChange={event=>setDraft({...draft,category:event.target.value})}/></label>
      <label>Lien replay<input type="url" placeholder="https://…" value={draft.replayUrl} onChange={event=>setDraft({...draft,replayUrl:event.target.value})}/></label>
      <label className="programme-check"><input type="checkbox" checked={draft.recurring} disabled={!canEditRecipe} onChange={event=>setDraft({...draft,recurring:event.target.checked})}/><span>Habillage permanent à réutiliser<small>À confirmer pour le JT ou la météo.</small></span></label>
      {activeChannelId()==='benin-tv'?<fieldset className="programme-recipes" disabled={!canEditRecipe}><legend>Livrables habituels</legend>{plannerKinds.map(kind=><label className="programme-check" key={kind}><input type="checkbox" checked={draft.recipe.includes(kind)} onChange={event=>setDraft({...draft,recipe:event.target.checked?[...draft.recipe,kind]:draft.recipe.filter(value=>value!==kind)})}/>{plannerLabels[kind]}</label>)}</fieldset>:null}
      {!canEditRecipe?<p className="resource-hint">Recette à valider par un administrateur ou diffuseur.</p>:null}
      <label>Notes de préparation<textarea value={draft.notes} maxLength={2000} onChange={event=>setDraft({...draft,notes:event.target.value})}/></label>
      <ProgrammeResources key={selected?.id||'new'} draft={draft} onChange={setDraft}/>
    </fieldset><div className="row"><button className="primary" disabled={busy}><Check size={16} aria-hidden="true"/>{busy?'Enregistrement…':'Enregistrer'}</button><button type="button" disabled={busy} onClick={()=>leave(()=>setDraft(null))}>Annuler</button></div></form>:null}</div>
    {pendingLeave?<NewProjectDialog busy={busy} labelledBy="programme-leave-title" onClose={()=>setPendingLeave(null)}><h2 id="programme-leave-title">Conserver cette fiche ouverte ?</h2><p>{busy?'L’enregistrement se termine. Patientez avant de quitter.':'Vos modifications ne sont pas encore enregistrées.'}</p><div className="row"><button className="primary" disabled={busy} onClick={()=>setPendingLeave(null)}>Rester sur la fiche</button><button disabled={busy} onClick={()=>{const next=pendingLeave.next;setPendingLeave(null);next();}}>Quitter sans enregistrer</button></div></NewProjectDialog>:null}
  </section>;
}

export function GlobalSearch({onOpenProject,onOpenProgramme,onOpenMedia}:{onOpenProject:(project:Project)=>void;onOpenProgramme?:()=>void;onOpenMedia?:()=>void}){
  const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[results,setResults]=useState<SearchResults|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{
    const shortcut=(event:KeyboardEvent)=>{
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'&&!event.altKey){
        if(document.querySelector('dialog[open]')&&!open)return;
        event.preventDefault();setOpen(true);
      }
    };
    window.addEventListener('keydown',shortcut);return()=>window.removeEventListener('keydown',shortcut);
  },[open]);
  useEffect(()=>{
    setResults(null);setError('');
    if(!open||query.trim().length<2){setBusy(false);return;}
    const controller=new AbortController();setBusy(true);
    const timer=setTimeout(()=>{
      void api.search(query.trim(),controller.signal).then(value=>{if(!controller.signal.aborted)setResults(value);}).catch(error=>{if(!controller.signal.aborted)setError(message(error));}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
    },250);
    return()=>{clearTimeout(timer);controller.abort();};
  },[query,open]);
  return <><button type="button" className="global-search-trigger" aria-label="Rechercher dans cette chaîne" aria-keyshortcuts="Control+k Meta+k" onClick={()=>setOpen(true)}><Search size={17} aria-hidden="true"/><span>Rechercher</span><kbd aria-hidden="true">Ctrl K</kbd></button>
    {open?<NewProjectDialog busy={false} labelledBy="global-search-title" onClose={()=>setOpen(false)}><div className="channel-dialog-content global-search-content"><h2 id="global-search-title">Rechercher dans cette chaîne</h2><label><span className="sr-only">Projet, émission ou média</span><span className="search-control"><Search size={18} aria-hidden="true"/><input data-dialog-autofocus type="search" placeholder="Projet, émission ou média…" value={query} maxLength={120} onChange={event=>setQuery(event.target.value)} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false);}}}/></span></label>
      {query.trim().length<2?<p className="muted small">Saisissez au moins deux caractères.</p>:null}
      {busy?<p role="status" className="small muted">Recherche…</p>:null}{error?<p className="notice error" role="alert">{error}</p>:null}
      {results?<div className="global-search-results">
        {results.projects.length?<section aria-label="Projets trouvés"><h3>Projets</h3>{results.projects.map(project=><button type="button" className="search-result" key={project.id} onClick={()=>{setOpen(false);onOpenProject(project);}}><span>{project.title}<small>{statusLabels[project.status]}</small></span><ArrowRight size={16} aria-hidden="true"/></button>)}</section>:null}
        {results.programmes.length?<section aria-label="Émissions trouvées"><h3>Émissions</h3>{results.programmes.map(programme=><button type="button" className="search-result" key={programme.id} disabled={!onOpenProgramme} onClick={()=>{setOpen(false);onOpenProgramme?.();}}><span>{programme.name}<small>{programme.data.category||'Émission'} · Ouvrir les fiches émission</small></span><ArrowRight size={16} aria-hidden="true"/></button>)}</section>:null}
        {results.media.length?<section aria-label="Médias trouvés"><h3>Médias</h3>{results.media.map(media=><button type="button" className="search-result" key={media.id} disabled={!onOpenMedia} onClick={()=>{setOpen(false);onOpenMedia?.();}}><span>{media.name}<small>Média partagé · Ouvrir la médiathèque</small></span><ArrowRight size={16} aria-hidden="true"/></button>)}</section>:null}
        {!results.projects.length&&!results.programmes.length&&!results.media.length?<p className="empty" role="status">Aucun résultat pour « {query.trim()} ».</p>:null}
      </div>:null}
    </div></NewProjectDialog>:null}
  </>;
}

export function PlannerHomeSummary({onOpenPlanner}:{onOpenPlanner:()=>void}){
  const [summary,setSummary]=useState<{plans:number;updatedAt:string|null}|null>(null);
  useEffect(()=>{let stopped=false;void request<{plans:number;updatedAt:string|null}>('/planner-summary').then(value=>{if(!stopped)setSummary(value);}).catch(()=>{});return()=>{stopped=true;};},[]);
  return <section className="planner-home-summary"><CalendarDays size={22} strokeWidth={1.5} aria-hidden="true"/><div><h2>À faire en équipe</h2><p>{summary?summary.plans?`${summary.plans} préparation${summary.plans>1?'s':''} disponible${summary.plans>1?'s':''}`:'Importez votre conducteur pour préparer la journée.':'Retrouvez les préparations de la chaîne.'}</p></div><button className="primary" onClick={onOpenPlanner}>Ouvrir À faire<ArrowRight size={16} aria-hidden="true"/></button></section>;
}
