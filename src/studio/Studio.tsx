import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type {WorkspaceNavigation} from './Workspace';
import { Home, LayoutGrid, FolderOpen, Image, CheckCheck, Users, ArrowRight, ArrowLeft, Plus, Menu, X, Search, CalendarDays, Tv, LockKeyhole } from 'lucide-react';
import { api } from './api';
import type { ProjectPage } from './api';
import { broadcastTemplates, roleLabels, statusLabels,templateDefaults,canApprove } from './domain';
import type { BroadcastTemplate, MediaAsset, Member, Project } from './domain';
import Catalogue from './Catalogue';
import NewProjectDialog from './NewProjectDialog';
import LogoutButton from './LogoutButton';
import ThemeToggle from './ThemeToggle';
import Activity from './Activity';
import {projectTemplateName} from './presentation';
import SurfaceTransition from './ui/SurfaceTransition';
import ConnectorWelcome from './ConnectorWelcome';
import {ChannelSwitcher, ProgrammeWorkspace, GlobalSearch} from './ChannelWorkspace';
import ExportQueuePanel from './ExportQueuePanel';
import {activeChannelId} from './channel-context';
import ProductionOverview from './ProductionOverview';
import type {ProductionOverviewItem} from './production-overview-model';
import type {PlannerEntry} from './planner-entry';
import {validationAction,validationViews} from './validation-workflow';
import type {ValidationStatus} from './validation-workflow';
import GraphicsHelp,{HelpBubble} from './GraphicsHelp';

const Workspace = lazy(() => import('./Workspace'));
const MediaLibrary = lazy(() => import('./MediaLibrary'));
const Admin = lazy(() => import('./Admin'));
const DayPlanner = lazy(() => import('./DayPlanner'));
type Page = 'home' | 'library' | 'projects' | 'media' | 'validation' | 'admin' | 'planner' | 'programmes';
const nav = [
  { id: 'home', title: 'Accueil', icon: Home },
  { id: 'planner', title: 'À faire', icon: CalendarDays },
  { id: 'projects', title: 'Projets', icon: FolderOpen },
  { id: 'programmes', title: 'Émissions', icon: Tv },
  { id: 'library', title: 'Bibliothèque', icon: LayoutGrid },
  { id: 'media', title: 'Médias', icon: Image },
  { id: 'validation', title: 'À valider', icon: CheckCheck },
  { id: 'admin', title: 'Équipe & accès', icon: Users },
] as const;
const templatesById = new Map(broadcastTemplates.map(template => [template.id, template]));
const projectModelName=(project:Project)=>{const template=templatesById.get(project.template_id);return template?projectTemplateName(template,project.data):project.template_id;};
const projectDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const todayDate = new Intl.DateTimeFormat('fr-FR', { weekday:'long', day:'numeric', month:'long' });

function ProjectList({ projects, open, onCreate, remove,member,reviewStatus,emptyTitle = 'Aucun projet dans cette vue', emptyDescription = 'Choisissez un modèle dans la bibliothèque pour commencer.',busy=false }: { member:Member;remove:(project:Project)=>void;busy?:boolean;reviewStatus?:ValidationStatus;projects: Project[]; open: (project: Project,tab?:'settings'|'exports') => void; onCreate?: () => void; emptyTitle?: string; emptyDescription?: string }) {
  const action=reviewStatus?validationAction(reviewStatus,canApprove(member.role)):'Exporter';
  if (!projects.length) return <div className="empty project-empty"><FolderOpen size={30} strokeWidth={1.3} aria-hidden="true" /><h2>{emptyTitle}</h2><p>{emptyDescription}</p>{onCreate ? <button onClick={onCreate}>Choisir un modèle <ArrowRight size={17} /></button> : null}</div>;
  return <div className="project-list"><div className="project-list-labels" aria-hidden="true"><span>Projet / modèle</span><span>État</span><span>Modifié</span><span /></div>{projects.map(project => <div className="project-row" key={project.id} data-project-id={project.id}><button className="quiet project-row-title" disabled={busy} onClick={() => open(project)}><strong>{project.title}</strong><small>{projectModelName(project)} <span>· r{project.revision}</span></small></button><span className={`badge ${project.status}`}>{statusLabels[project.status]}</span><time dateTime={project.updated_at} title={new Date(project.updated_at).toLocaleString('fr-FR')}>{projectDate.format(new Date(project.updated_at))}</time><div className="project-row-actions"><button className="project-export" disabled={busy} aria-label={`${action} : ${project.title}`} onClick={()=>open(project,reviewStatus?'settings':'exports')}>{action}</button>{(canApprove(member.role)||member.email===project.created_by)&&(project.archived||project.status==='draft')?<button disabled={busy} aria-label={`${project.archived?'Restaurer':'Supprimer le brouillon'} : ${project.title}`} onClick={()=>remove(project)}>{project.archived?'Restaurer':'Supprimer'}</button>:null}</div></div>)}</div>;
}

export default function Studio({ member }: { member: Member }) {
  const [channelId,setChannelId]=useState(activeChannelId);
  useEffect(()=>{
    const change=()=>{setChannelId(activeChannelId());requestAnimationFrame(()=>document.getElementById('graphics-main')?.focus({preventScroll:true}));};
    window.addEventListener('srtb-channel-change',change);
    return()=>window.removeEventListener('srtb-channel-change',change);
  },[]);
  return <ChannelStudio key={channelId} member={member}/>;
}

function ChannelStudio({member}:{member:Member}) {
  const [channelName,setChannelName]=useState('');
  const validationTitle=canApprove(member.role)?'À valider':'Mes envois';
  const mainContent = useRef<HTMLElement>(null);
  const [page, setPage] = useState<Page>('home');
  const [navOpen, setNavOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [mediaLoaded, setMediaLoaded] = useState(false);
  const mediaLoading = useRef<Promise<void> | null>(null);
  const [next, setNext] = useState<ProjectPage['next']>(null);
  const [active, setActive] = useState<Project | null>(null);
  const [entryTab,setEntryTab]=useState<'settings'|'exports'>('settings');
  const [plannerEntry,setPlannerEntry]=useState<PlannerEntry>();
  const workspaceNavigation=useRef<WorkspaceNavigation|null>(null);
  const navigationVersion=useRef(0);
  const [archived, setArchived] = useState(false);
  const [projectScope,setProjectScope]=useState<'mine'|'team'|'accessible'>('mine');
  const [validationStatus,setValidationStatus]=useState<ValidationStatus>('submitted');
  const validationView=validationViews.find(view=>view.status===validationStatus)!;
  const listingScope=page==='validation'?(canApprove(member.role)?'accessible':'mine'):page==='home'?'mine':projectScope;
  const listingStatus=page==='validation'?validationStatus:undefined;
  const projectRequest=useRef(0);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState<BroadcastTemplate | null>(null);
  const [title, setTitle] = useState('');
  const [removing,setRemoving]=useState<Project|null>(null),[notice,setNotice]=useState('');
  useEffect(()=>{
    const beforeChange=(event:Event)=>{
      if(event.defaultPrevented)return;
      const proceed=(event as CustomEvent<{proceed?:()=>void}>).detail?.proceed;
      if(proceed&&workspaceNavigation.current&&(active||page==='planner'||page==='programmes')){
        event.preventDefault();
        workspaceNavigation.current.leave(proceed);
      }
    };
    window.addEventListener('srtb-before-channel-change',beforeChange);
    return()=>window.removeEventListener('srtb-before-channel-change',beforeChange);
  },[active,page]);
  function remove(project:Project){
    if(project.archived){void run(async()=>{changed(await api.archive(project,false));setNotice('Projet restauré. Retrouvez-le dans les projets actifs.');});}
    else setRemoving(project);
  }
  const loadMedia = useCallback((force = false) => {
    if (!force && mediaLoaded) return Promise.resolve();
    if (mediaLoading.current) return mediaLoading.current;
    const request = api.media().then(items => { setMedia(items); setMediaLoaded(true); }).finally(() => {
      if (mediaLoading.current === request) mediaLoading.current = null;
    });
    mediaLoading.current = request;
    return request;
  }, [mediaLoaded]);
  const refreshMedia = useCallback(() => loadMedia(true), [loadMedia]);
  const loadProjects = useCallback(async () => {
    const request=++projectRequest.current;
    setProjectsLoaded(false);
    setNext(null);
    const result = await api.projects(archived,null,listingScope,listingStatus);
    if(request!==projectRequest.current)return;
    setProjects(result.projects);
    setNext(result.next);
    setProjectsLoaded(true);
  }, [archived,listingScope,listingStatus]);
  useEffect(() => { void loadProjects().catch(cause => setError(cause instanceof Error ? cause.message : String(cause))); }, [loadProjects]);
  useEffect(() => {
    if (page !== 'media' || mediaLoaded) return;
    void loadMedia().catch(cause => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [loadMedia, mediaLoaded, page]);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); }
  }
  const open = (project: Project,tab:'settings'|'exports'='settings') => void run(async () => { const version=navigationVersion.current,[loaded]=await Promise.all([api.project(project.id),loadMedia()]);if(version!==navigationVersion.current)return;setEntryTab(tab);setActive(loaded);setPage(page==='validation'?'validation':'projects'); });
  function changed(project: Project) {
    setProjects(previous => [project, ...previous.filter(value => value.id !== project.id)].filter(value => !!value.archived === archived));
  }
  function navigate(destination: Page) {
    if((active||page==='planner'||page==='programmes')&&workspaceNavigation.current){workspaceNavigation.current.leave(()=>finishNavigation(destination));return;}
    finishNavigation(destination);
  }
  function finishNavigation(destination:Page,keepQuery=false){
    navigationVersion.current++;
    setActive(null);
    setPage(destination);
    if(!keepQuery)setQuery('');
    setError('');
    setNavOpen(false);
    setPlannerEntry(undefined);
    if (destination !== 'projects' && archived) { setArchived(false); setProjectsLoaded(false); }
    // The mobile menu disappears after navigation. Move focus to the stable
    // content landmark only once that accepted navigation has been rendered;
    // the draft guard never calls this function when the user cancels.
    requestAnimationFrame(()=>mainContent.current?.focus({preventScroll:true}));
  }
  function openPreparation(item:ProductionOverviewItem){
    const next=()=>{finishNavigation('planner');setPlannerEntry({requestId:crypto.randomUUID(),planId:item.planId,planRevision:item.planRevision,rowId:item.rowId});};
    if(workspaceNavigation.current&&(active||page==='planner'||page==='programmes'))workspaceNavigation.current.leave(next);else next();
  }
  function openOverviewProject(id:string){void run(async()=>{
    const version=navigationVersion.current,[project]=await Promise.all([api.project(id),loadMedia()]);
    if(version!==navigationVersion.current)return;
    setEntryTab('settings');setActive(project);setPage('projects');
  });}
  function create(template: BroadcastTemplate) { setEntryTab('settings');setCreating(template); setTitle(template.name); }
  const filtered = projects.filter(project => (page !== 'validation' || project.status === validationStatus) && `${project.title} ${project.updated_by}`.toLocaleLowerCase('fr').includes(query.toLocaleLowerCase('fr')));
  const localQualification = !!import.meta.env.VITE_STUDIO_QUALIFICATION;

  return <div className={`studio-shell${active?' is-editing':''}`}>
    <a className="skip-link" href="#graphics-main">Aller au contenu</a>
    <header className="graphics-header">
      <div className="graphics-masthead">
        <div className="graphics-identity"><a className="brand" href="#" onClick={event => { event.preventDefault(); navigate('home'); }} aria-label="SRTB Graphics — accueil"><span className="suite-wordmark">SRTB</span><span className="graphics-wordmark">Graphics</span></a></div>
        <div className="graphics-channel"><ChannelSwitcher onSelected={setChannelName}/></div>
        <GlobalSearch onOpenProject={(project:Project)=>{if(workspaceNavigation.current&&(active||page==='planner'||page==='programmes'))workspaceNavigation.current.leave(()=>open(project));else open(project);}} onOpenProgramme={()=>navigate('programmes')} onOpenMedia={()=>navigate('media')}/>
        <ExportQueuePanel/>
        <div className="profile"><div className="profile-identity"><strong>{member.name}</strong><small>{roleLabels[member.role]}</small></div><div className="account-actions"><GraphicsHelp memberId={member.email} role={member.role} channelName={channelName} helpSection={active?'editor':page} onNavigate={destination=>navigate(destination)}/><ThemeToggle /><LogoutButton /></div></div>
        <button className="mobile-nav-toggle" aria-expanded={navOpen} aria-controls="graphics-nav" onClick={() => setNavOpen(value => !value)}>{navOpen ? <X size={19} /> : <Menu size={19} />}<span>Menu</span></button>
      </div>
      <div className="graphics-navigation"><p className="navigation-caption">Production</p><nav id="graphics-nav" className={navOpen ? 'open' : ''} aria-label="Navigation Graphics">{nav.filter(item => item.id !== 'admin' || member.role === 'admin').map(item => {const label=item.id==='validation'?validationTitle:item.title;return <button key={item.id} className={item.id==='admin'?'navigation-admin':undefined} title={label} aria-label={label} aria-current={page === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><item.icon size={18} strokeWidth={1.7} aria-hidden="true" /><span className="navigation-label">{label}</span></button>;})}</nav><div className="navigation-bottom"><a className="navigation-tools-link" href="/"><ArrowLeft size={15} aria-hidden="true"/>Tous les outils</a><span className="off-air-label"><span className="onair-dot" /> Préparation hors antenne</span>{localQualification?<small>Banc local · données temporaires</small>:null}</div></div>
    </header>
    <div className="studio-body">
      <main id="graphics-main" ref={mainContent} tabIndex={-1}>
        <ConnectorWelcome onConnected={()=>navigate('planner')}/>
        {error ? <div className="notice error" role="alert">{error}<button className="quiet" onClick={() => setError('')}>Fermer</button></div> : null}
        {notice?<div className="notice" role="status">{notice}<button className="quiet" onClick={()=>setNotice('')}>Fermer</button></div>:null}
        <SurfaceTransition identity={active?.id||page}><Suspense fallback={<Activity label="Ouverture de l’espace de travail"/>}>
          {active ? <Workspace key={active.id} initialTab={entryTab} backLabel={page==='validation'?validationTitle:'Projets'} navigationRef={workspaceNavigation} project={active} member={member} media={media} onBack={() => { finishNavigation(page==='validation'?'validation':'projects',true); void loadProjects().catch(cause => setError(cause instanceof Error ? cause.message : String(cause))); }} onChanged={changed} onOpenProject={open} /> : <>
            {page === 'home' ? <>
              <div className="section-heading home-heading"><div><p className="eyebrow home-date">{todayDate.format(new Date())}</p><div className="help-title-row"><h1>Aujourd’hui</h1><HelpBubble section="home" role={member.role}/></div></div><button className="new-project-button" onClick={() => navigate('library')}><Plus size={18} aria-hidden="true"/>Nouveau projet</button></div>
              <ProductionOverview reviewer={canApprove(member.role)} busy={busy} onOpenPlanner={()=>navigate('planner')} onOpenItem={openPreparation} onOpenProject={openOverviewProject}/>
              <section className="recent-projects" aria-labelledby="recent-projects-heading"><div className="desk-heading"><div><h2 id="recent-projects-heading">À reprendre</h2><span className="desk-caption">Vos derniers projets dans cette chaîne</span></div><button className="quiet" onClick={() => navigate('projects')}>Tous les projets <ArrowRight size={16} aria-hidden="true"/></button></div>{projectsLoaded ? <ProjectList member={member} remove={remove} busy={busy} projects={projects.slice(0, 3)} open={open} onCreate={() => navigate('library')} emptyTitle="Votre espace est prêt" emptyDescription="Choisissez un modèle pour créer votre premier projet." /> : <div className="empty" role="status">{error ? 'Les projets n’ont pas pu être chargés.' : <Activity label="Chargement de vos projets"/>}{error ? <button disabled={busy} onClick={() => void run(loadProjects)}>Réessayer</button> : null}</div>}</section>
              <div className="home-resources" aria-label="Accès rapides"><button onClick={()=>navigate('programmes')}><Tv size={18} aria-hidden="true"/><span>Émissions</span><ArrowRight size={16} aria-hidden="true"/></button><button onClick={()=>navigate('media')}><Image size={18} aria-hidden="true"/><span>Médias de l’équipe</span><ArrowRight size={16} aria-hidden="true"/></button><button onClick={()=>navigate('validation')}><CheckCheck size={18} aria-hidden="true"/><span>{canApprove(member.role)?'Relecture & validation':'Suivre mes envois'}</span><ArrowRight size={16} aria-hidden="true"/></button></div>
            </> : null}
            {page === 'library' ? <Catalogue create={create} /> : null}
            {page === 'programmes' ? <ProgrammeWorkspace member={member} navigationRef={workspaceNavigation}/> : null}
            {page === 'planner' ? <DayPlanner member={member} navigationRef={workspaceNavigation} onOpenProject={open} entry={plannerEntry} onEntryConsumed={()=>setPlannerEntry(undefined)}/> : null}
            {page === 'projects' || page === 'validation' ? <>
              <div className="section-heading"><div><div className="help-title-row"><h1>{page === 'validation' ? validationTitle : 'Projets'}</h1><HelpBubble section={page} role={member.role}/></div><p>{page === 'validation' ? canApprove(member.role)?'Ouvrez la version, contrôlez l’image et le son, puis validez ou demandez une correction.':'Suivez vos versions envoyées au diffuseur et les corrections à reprendre.' : 'Vos créations et les projets partagés avec l’équipe.'}</p></div>{page==='projects'?<button onClick={() => navigate('library')}><Plus size={18} aria-hidden="true"/> Nouveau projet</button>:null}</div>
              {page==='validation'?<div className="validation-views" role="group" aria-label="Suivi des envois">{validationViews.map(view=><button type="button" key={view.status} aria-pressed={validationStatus===view.status} disabled={busy} onClick={()=>{if(validationStatus===view.status)return;setValidationStatus(view.status);setProjectsLoaded(false);setNext(null);setError('');}}>{view.label}</button>)}</div>:null}
              <div className="filter-row">{page==='projects'?<label>Afficher<select aria-label="Visibilité des projets" value={projectScope} onChange={event=>{setProjectScope(event.target.value as typeof projectScope);setProjectsLoaded(false);}}><option value="mine">Mes projets</option><option value="team">Partagés avec l’équipe</option>{canApprove(member.role)?<option value="accessible">Tous · administration / diffusion</option>:null}</select></label>:null}<label className="search">Rechercher un projet<span className="search-control"><Search size={18} aria-hidden="true" /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Titre ou membre…" /></span></label>{page === 'projects' ? <label className="check"><input type="checkbox" checked={archived} onChange={event => { setArchived(event.target.checked); setProjectsLoaded(false); }} />Corbeille et archives</label> : null}<button disabled={busy} onClick={() => void run(loadProjects)}>Actualiser</button></div>
              {projectsLoaded ? <ProjectList member={member} remove={remove} busy={busy} reviewStatus={page==='validation'?validationStatus:undefined} projects={filtered} open={open} emptyTitle={query ? 'Aucun projet correspondant' : page === 'validation' ? validationView.emptyTitle : archived ? 'La corbeille est vide' : 'Aucun projet pour le moment'} emptyDescription={query ? 'Essayez un autre titre ou un autre membre.' : page === 'validation' ? validationView.emptyDescription : archived ? 'Les projets archivés restent conservés avec leur historique.' : 'Choisissez un modèle pour commencer.'} onCreate={!query && page === 'projects' && !archived ? () => navigate('library') : undefined} /> : <div className="empty" role="status">{error ? 'Les projets n’ont pas pu être chargés.' : <Activity label="Chargement des projets"/>}</div>}
              {next ? <button className="load-more" disabled={busy} onClick={() => void run(async () => { const request=projectRequest.current; const result = await api.projects(archived, next,listingScope,listingStatus); if(request!==projectRequest.current)return; setProjects(previous => [...previous, ...result.projects.filter(project => !previous.some(value => value.id === project.id))]); setNext(result.next); })}>Charger la suite <ArrowRight size={17} /></button> : null}
            </> : null}
            {page === 'media' ? mediaLoaded ? <MediaLibrary media={media} refresh={refreshMedia} onOpenProjects={()=>navigate('projects')} /> : <Activity label="Ouverture de la médiathèque" detail="Graphics charge uniquement les références partagées. Les fichiers de votre poste ou du réseau ne sont pas envoyés." /> : null}
            {page === 'admin' && member.role === 'admin' ? <Admin member={member} /> : null}
          </>}
        </Suspense></SurfaceTransition>
        {creating ? <NewProjectDialog busy={busy} onClose={() => setCreating(null)}><p className="eyebrow">Nouveau projet</p><h2 id="create-heading">{creating.name}</h2><p className="project-create-summary">{creating.category} · modèle v{creating.version}</p>{error ? <div className="notice error" role="alert">{error}</div> : null}<form onSubmit={event => { event.preventDefault(); void run(async () => { const [project] = await Promise.all([api.create(creating.id, title,templateDefaults(creating)),loadMedia()]); changed(project); setActive(project); setPage('projects'); setCreating(null); }); }}><label>Nom du projet<input data-dialog-autofocus required maxLength={120} value={title} onChange={event => setTitle(event.target.value)} /></label><p className="project-privacy-note"><LockKeyhole size={16} aria-hidden="true"/><span>Privé · accessible à vous, aux administrateurs et aux diffuseurs. Vous pourrez le partager avec l’équipe.</span></p><div className="row"><button className="primary" disabled={busy}>{busy ? 'Création…' : 'Créer le projet'} <ArrowRight size={17} aria-hidden="true"/></button><button type="button" disabled={busy} onClick={() => setCreating(null)}>Annuler</button></div></form></NewProjectDialog> : null}
      </main>
      {removing?<NewProjectDialog labelledBy="remove-heading" busy={busy} onClose={()=>setRemoving(null)}><h2 id="remove-heading">Supprimer ce brouillon ?</h2><p>{removing.title}</p><p>Il sera placé dans la corbeille, avec son historique. Vous pourrez le restaurer depuis Projets → Corbeille et archives. Aucun média ne sera supprimé.</p>{error?<p role="alert" className="notice error">{error}</p>:null}<div className="row"><button className="primary" disabled={busy} onClick={()=>void run(async()=>{const project=await api.archive(removing,true);changed(project);setRemoving(null);setNotice('Brouillon déplacé dans la corbeille. Vous pouvez le restaurer depuis Projets → Corbeille et archives.');})}>{busy?'Suppression…':'Mettre à la corbeille'}</button><button disabled={busy} onClick={()=>setRemoving(null)}>Annuler</button></div></NewProjectDialog>:null}
      <footer><span>SRTB Graphics · Préparation hors antenne</span><span className="design-credit">Conçu par Ji:mmy de Souza</span></footer>
    </div>
  </div>;
}
