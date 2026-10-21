import {useEffect, useId, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {ArrowLeft, ArrowRight, AudioLines, BookOpen, Check, CheckCheck, CircleHelp, Clock3, Crop, Download, FolderOpen, HardDrive, Home, Layers, LayoutGrid, Link2, LockKeyhole, Palette, Play, RotateCcw, Shapes, ShieldCheck, SlidersHorizontal, Sparkles, Tv, Type, UserRound, Users, X} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';
import {availableHelpTopics, helpTopic, isHelpTopic, readHelpProgress, safeHelpDestination, writeHelpProgress} from './graphics-help';
import type {GraphicsHelpPage, GraphicsHelpRole, GraphicsHelpSection, GraphicsHelpTopic, HelpProgress, HelpStep} from './graphics-help';
import './graphics-help.css';

export type {GraphicsHelpPage, GraphicsHelpRole, GraphicsHelpSection} from './graphics-help';
const HELP_REQUEST_EVENT = 'srtb-graphics-help-request';

/** Opens explanation only. Callers retain their own draft/navigation guards. */
export function requestGraphicsHelp(section: GraphicsHelpSection | 'start'): void {
  if(typeof window!=='undefined'&&isHelpTopic(section))window.dispatchEvent(new CustomEvent(HELP_REQUEST_EVENT,{detail:{section}}));
}

const topicIcons: Record<GraphicsHelpTopic,LucideIcon> = {
  start:Sparkles,sharing:Users,home:Home,planner:CheckCheck,projects:FolderOpen,programmes:Tv,
  library:LayoutGrid,media:HardDrive,validation:ShieldCheck,admin:Users,channels:Tv,connector:Link2,
  editor:SlidersHorizontal,audio:AudioLines,montage:Layers,crop:Crop,export:Download,
  text:Type,logos:Shapes,graphics:Palette,timing:Clock3,derivations:Layers,habits:CheckCheck,
};

function Scene({step,run}:{step:HelpStep;run:number}) {
  const scene=step.scene;
  const icons: [LucideIcon,LucideIcon,LucideIcon] = scene==='privacy'?[UserRound,ShieldCheck,LockKeyhole]:scene==='local'?[HardDrive,Link2,FolderOpen]:scene==='team'?[Users,CheckCheck,UserRound]:scene==='export'?[SlidersHorizontal,Download,Check]:scene==='review'?[ShieldCheck,SlidersHorizontal,Check]:scene==='channels'?[Tv,FolderOpen,Users]:scene==='episode'?[Tv,Play,Play]:scene==='shared-media'?[HardDrive,ShieldCheck,Users]:scene==='library'?[LayoutGrid,Play,FolderOpen]:[Tv,SlidersHorizontal,Check];
  return <figure className={`graphics-help-scene graphics-help-scene-${scene}`} key={`${scene}-${run}`}>
    <div className="graphics-help-scene-top"><span className="graphics-help-demo-wordmark">SRTB <span>Graphics</span></span><span>Démonstration</span></div>
    {scene==='text'||scene==='logos'?<div className="graphics-help-tool-demo" aria-hidden="true"><div className="graphics-help-mini-monitor"><span className="graphics-help-mini-corner">16:9</span>{scene==='text'?<><div className="graphics-help-mini-title">LE MAGAZINE<span>Ce soir · 20:30</span></div><svg className="graphics-help-mini-cursor" width="23" height="28" viewBox="0 0 23 28"><path d="M3 2 3 23 8 18 12 26 16 24 12 16 20 16Z" fill="var(--gh-ink)" stroke="var(--gh-surface)" strokeWidth="2"/></svg></>:<><div className="graphics-help-mini-logo"><Shapes size={23}/></div><div className="graphics-help-mini-title is-static">VOTRE ÉMISSION<span>Logo supplémentaire</span></div></>}</div><div className="graphics-help-mini-inspector"><strong>{scene==='text'?'Texte sélectionné':'Logo supplémentaire'}</strong><span>{scene==='text'?'Taille':'Taille maximale'}<b>{scene==='text'?'110 %':'12 %'}</b></span><span>{scene==='text'?'Police':'Position'}<b>{scene==='text'?'Du modèle':'En haut à droite'}</b></span><span>{scene==='text'?'Couleur':'Apparition'}<b>{scene==='text'?<i/>:'Fondu'}</b></span></div></div>:null}
    {scene==='crop'?<div className="graphics-help-crop-demo" aria-hidden="true"><svg viewBox="0 0 420 172" fill="none"><rect x="4" y="4" width="412" height="164" rx="12" className="gh-demo-background"/><path d="M4 133 115 64 181 113 255 75 416 160V168H4Z" className="gh-demo-landscape"/><circle cx="320" cy="39" r="16" className="gh-demo-sun"/><g className="graphics-help-crop-subject"><circle cx="210" cy="67" r="17" className="gh-demo-subject"/><path d="M177 130c0-25 14-40 33-40s33 15 33 40" className="gh-demo-subject"/></g><path d="M4 4H160V168H4ZM260 4H416V168H260Z" className="gh-demo-mask"/><rect x="160" y="7" width="100" height="158" rx="4" className="gh-demo-frame"/><path d="M210 9V162M162 59H258M162 113H258" className="gh-demo-grid"/></svg></div>:scene==='audio'?<div className="graphics-help-audio-demo" aria-hidden="true"><svg viewBox="0 0 420 146" fill="none"><rect x="4" y="4" width="412" height="138" rx="12" className="gh-demo-background"/>{[26,67,108].map((y,index)=><g key={y}><path d={`M20 ${y+9}H400`} className="gh-demo-grid"/>{Array.from({length:38},(_,i)=><rect key={i} x={24+i*10} y={y+9-(4+(i*7+index*13)%15)/2} width="4" height={4+(i*7+index*13)%15} rx="2" className={index===1?'gh-demo-subject':'gh-demo-wave'}/>)}</g>)}<path d="M26 12V134" className="graphics-help-playhead gh-demo-frame"/></svg></div>:null}
    <div className={`graphics-help-demo-cards${scene==='programme'||scene==='episode'?' is-branch':''}`}>
      {step.labels.map((label,index)=>{const Icon=icons[index];return <div className={`graphics-help-demo-card graphics-help-demo-part part-${index}`} key={index}><span className="graphics-help-demo-icon"><Icon size={23} strokeWidth={1.5} aria-hidden="true"/></span><strong>{label}</strong>{scene==='privacy'&&index===2?<span className="graphics-help-demo-badge">Choix explicite</span>:null}{scene==='team'&&index===2?<span className="graphics-help-demo-badge">1 responsable</span>:null}</div>;})}
    </div>
    <figcaption>Exemple visuel · aucun contenu de vos projets</figcaption>
  </figure>;
}

export interface GraphicsHelpProps {
  memberId: string;
  role: GraphicsHelpRole;
  helpSection?: GraphicsHelpSection | string;
  channelName?: string;
  /** Read-only route change; pass the Studio navigation function to retain its draft guard. */
  onNavigate?: (page: GraphicsHelpPage) => void;
  className?: string;
  /** Disable only the first-use invitation. The Guide button always remains available. */
  onboarding?: boolean;
}

export default function GraphicsHelp(props: GraphicsHelpProps) {
  return <GraphicsHelpSession key={props.memberId.trim().toLowerCase()} {...props}/>;
}

function GraphicsHelpSession({memberId,role,helpSection='home',channelName,onNavigate,className='',onboarding=true}:GraphicsHelpProps) {
  const [progress,setProgress]=useState(()=>readHelpProgress(memberId));
  const progressRef=useRef(progress);
  const [storageUnavailable,setStorageUnavailable]=useState(false);
  const [open,setOpen]=useState(false);
  const [topicId,setTopicId]=useState<GraphicsHelpTopic>(isHelpTopic(helpSection)?helpSection:'home');
  const [stepIndex,setStepIndex]=useState(0);
  const [run,setRun]=useState(0);
  const [completedNow,setCompletedNow]=useState(false);
  const dialog=useRef<HTMLDialogElement>(null);
  const trigger=useRef<HTMLButtonElement>(null);
  const title=useRef<HTMLHeadingElement>(null);
  const stepTitle=useRef<HTMLHeadingElement>(null);
  const opener=useRef<HTMLElement|null>(null);
  const pendingNavigation=useRef<GraphicsHelpPage|null>(null);
  const navigateRef=useRef(onNavigate);navigateRef.current=onNavigate;
  const content=useRef<HTMLDivElement>(null);
  const body=useRef<HTMLDivElement>(null);
  const id=useId();
  const topics=availableHelpTopics(role);
  const topic=helpTopic(topicId,role);
  const index=Math.min(stepIndex,topic.steps.length-1);
  const currentStep=topic.steps[index];
  const destination=safeHelpDestination(topic,role);
  const showInvitation=onboarding&&!progress.dismissed&&!open;

  function save(next:HelpProgress){
    progressRef.current=next;setProgress(next);
    setStorageUnavailable(!writeHelpProgress(memberId,next));
  }
  function chooseTopic(next:GraphicsHelpTopic,index=0){
    const allowed=next==='admin'&&role!=='admin'?'channels':next;
    const nextIndex=Math.max(0,Math.min(index,helpTopic(allowed,role).steps.length-1));
    setTopicId(allowed);setStepIndex(nextIndex);setRun(value=>value+1);setCompletedNow(false);
    save({...progressRef.current,dismissed:true,last:{topic:allowed,step:nextIndex}});
    content.current?.scrollTo({top:0,behavior:'instant'});
    body.current?.scrollTo({top:0,behavior:'instant'});
  }
  function openGuide(section:GraphicsHelpTopic,index=0){
    if(!open)opener.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    chooseTopic(section,index);setOpen(true);
  }
  function closeGuide(){setOpen(false);}
  function dismissInvitation(){save({...progressRef.current,dismissed:true});}

  const openGuideRef=useRef(openGuide);openGuideRef.current=openGuide;
  useEffect(()=>{
    const listener=(event:Event)=>{
      const section=(event as CustomEvent<{section?:unknown}>).detail?.section;
      if(isHelpTopic(section))openGuideRef.current(section);
    };
    window.addEventListener(HELP_REQUEST_EVENT,listener);
    return()=>window.removeEventListener(HELP_REQUEST_EVENT,listener);
  },[]);
  useEffect(()=>{
    if(!showInvitation)return;
    const escape=(event:KeyboardEvent)=>{
      // Do not steal Escape from a project dialog, a menu, or another popover.
      if(event.key==='Escape'&&!document.querySelector('dialog[open]')&&(!('showPopover' in HTMLElement.prototype)||!document.querySelector(':popover-open'))){
        const next={...progressRef.current,dismissed:true};
        progressRef.current=next;setProgress(next);setStorageUnavailable(!writeHelpProgress(memberId,next));
      }
    };
    window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape);
  },[showInvitation,memberId]);
  useEffect(()=>{
    if(!open)return;
    const element=dialog.current;
    if(!element)return;
    element.showModal();
    title.current?.focus({preventScroll:true});
    return()=>{
      element.close();
      const destination=pendingNavigation.current;pendingNavigation.current=null;
      if(destination){queueMicrotask(()=>navigateRef.current?.(destination));return;}
      const previous=opener.current;
      if(previous?.isConnected&&!previous.closest('.graphics-help-invitation,.graphics-help-bubble'))previous.focus({preventScroll:true});
      else trigger.current?.focus({preventScroll:true});
    };
  },[open]);
  useEffect(()=>{
    if(open&&run>1)stepTitle.current?.focus({preventScroll:true});
  },[stepIndex,topicId]);

  function advance(){
    if(index<topic.steps.length-1){chooseTopic(topicId,index+1);return;}
    save({...progressRef.current,dismissed:true,last:null,completed:[...new Set([...progressRef.current.completed,topicId])]});
    setCompletedNow(true);
  }
  return <>
    <button type="button" ref={trigger} className={`graphics-help-trigger ${className}`.trim()} aria-label="Guide" aria-haspopup="dialog" onClick={()=>{const last=progressRef.current.last;openGuide(last?.topic??(isHelpTopic(helpSection)?helpSection:'home'),last?.step??0);}}><BookOpen size={17} strokeWidth={1.7} aria-hidden="true"/><span>Guide</span></button>
    {showInvitation&&typeof document!=='undefined'?createPortal(<aside className="graphics-help-invitation" aria-labelledby={`${id}-welcome`}><button type="button" className="graphics-help-icon-button" aria-label="Fermer l’invitation à la prise en main" onClick={dismissInvitation}><X size={17} aria-hidden="true"/></button><span className="graphics-help-eyebrow">Bienvenue dans Graphics</span><h2 id={`${id}-welcome`}>Vos repères, en images.</h2><p>Émissions, projets, partage : un parcours court, à votre rythme.</p><div><button type="button" className="graphics-help-primary" onClick={()=>openGuide('start')}><Play size={15} aria-hidden="true"/>Prise en main</button><button type="button" className="graphics-help-quiet" onClick={dismissInvitation}>Plus tard</button></div></aside>,document.body):null}
    {open&&typeof document!=='undefined'?createPortal(<dialog className="graphics-help-dialog" ref={dialog} aria-labelledby={`${id}-title`} onCancel={event=>{event.preventDefault();closeGuide();}} onClose={closeGuide} onKeyDown={event=>{
      if(event.key!=='Tab')return;
      const controls=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]')).filter(node=>node.getClientRects().length>0);
      const first=controls[0],last=controls.at(-1),active=document.activeElement;
      if(event.shiftKey&&(active===first||!controls.includes(active as HTMLElement))){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&(active===last||!controls.includes(active as HTMLElement))){event.preventDefault();first?.focus();}
    }}>
      <div className="graphics-help-layout">
        <header className="graphics-help-header"><div><span className="graphics-help-eyebrow">SRTB Graphics · Guide visuel</span><h2 id={`${id}-title`} ref={title} tabIndex={-1}>Un repère pour chaque étape.</h2><p>{channelName?`Chaîne : ${channelName}`:'Dans votre chaîne de travail'}<span aria-hidden="true"> · </span>À votre rythme</p></div><button type="button" className="graphics-help-icon-button" aria-label="Fermer le guide" onClick={closeGuide}><X size={21} aria-hidden="true"/></button></header>
        <div className="graphics-help-body" ref={body}>
          <nav className="graphics-help-topics" aria-label="Rubriques du guide">
            {topics.map(item=>{const Icon=topicIcons[item.id];return <button type="button" key={item.id} aria-current={item.id===topicId?'step':undefined} onClick={()=>chooseTopic(item.id)}><Icon size={17} strokeWidth={1.6} aria-hidden="true"/><span>{item.title}</span>{progress.completed.includes(item.id)?<Check size={14} aria-label="Parcours terminé"/>:null}</button>;})}
          </nav>
          <div className="graphics-help-content" ref={content}>
            <label className="graphics-help-topic-picker">Rubrique<select value={topicId} onChange={event=>{if(isHelpTopic(event.target.value))chooseTopic(event.target.value);}}>{topics.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
            <div className="graphics-help-topic-heading"><div><span className="graphics-help-eyebrow">{topic.title}</span><p>{topic.short}</p></div><span className="graphics-help-scope"><ShieldCheck size={14} aria-hidden="true"/>{topic.scope}</span></div>
            <div className="graphics-help-step-top"><span>Étape {index+1} / {topic.steps.length}</span><button type="button" className="graphics-help-quiet" aria-label="Rejouer la démonstration" onClick={()=>setRun(value=>value+1)}><RotateCcw size={14} aria-hidden="true"/>Rejouer</button></div>
            <div className="graphics-help-step-copy"><h3 ref={stepTitle} tabIndex={-1}>{currentStep.title}</h3><p>{currentStep.body}</p><p className="graphics-help-cue"><CircleHelp size={17} aria-hidden="true"/><span>{currentStep.cue}</span></p></div>
            <Scene step={currentStep} run={run}/>
            {completedNow?<div className="graphics-help-completed" role="status"><CheckCheck size={22} aria-hidden="true"/><div><strong>Vous avez les repères.</strong><p>Ce parcours reste disponible à tout moment dans Guide.</p></div></div>:null}
            {storageUnavailable?<p className="graphics-help-storage" role="status">La progression reste disponible pendant cette ouverture. Le navigateur ne permet pas de la conserver pour plus tard.</p>:null}
          </div>
        </div>
        <footer className="graphics-help-footer"><div className="graphics-help-step-controls"><button type="button" disabled={index===0} onClick={()=>chooseTopic(topicId,index-1)}><ArrowLeft size={16} aria-hidden="true"/>Précédent</button>{completedNow?<button type="button" className="graphics-help-primary" onClick={closeGuide}>Revenir à mon travail<Check size={16} aria-hidden="true"/></button>:<button type="button" className="graphics-help-primary" onClick={advance}>{index===topic.steps.length-1?'Terminer ce parcours':'Suivant'}<ArrowRight size={16} aria-hidden="true"/></button>}</div><div className="graphics-help-footer-secondary"><button type="button" className="graphics-help-quiet" onClick={closeGuide}>Quitter · reprendre plus tard</button>{destination&&onNavigate?<button type="button" className="graphics-help-quiet" onClick={()=>{pendingNavigation.current=destination;closeGuide();}}>Ouvrir {topic.title}<ArrowRight size={14} aria-hidden="true"/></button>:null}</div><p>Lecture seule · progression sur ce navigateur · aucun projet modifié</p></footer>
      </div>
    </dialog>,document.body):null}
  </>;
}

/** Small on-demand explanation. Its native popover supports Escape and light dismissal. */
export function HelpBubble({section,role='designer',label}: {section:GraphicsHelpSection;role?:GraphicsHelpRole;label?:string}) {
  const id=useId();
  const button=useRef<HTMLButtonElement>(null);
  const panel=useRef<HTMLDivElement>(null);
  const [position,setPosition]=useState({left:12,top:60});
  const [nativePopover]=useState(()=>typeof HTMLElement!=='undefined'&&'showPopover' in HTMLElement.prototype);
  const [fallbackOpen,setFallbackOpen]=useState(false);
  const topic=helpTopic(section,role);
  useEffect(()=>{
    if(!fallbackOpen)return;
    const close=(event:Event)=>{
      if(event instanceof KeyboardEvent&&event.key==='Escape'){setFallbackOpen(false);button.current?.focus();}
      if(event instanceof PointerEvent&&event.target instanceof Node&&!panel.current?.contains(event.target)&&!button.current?.contains(event.target))setFallbackOpen(false);
    };
    window.addEventListener('keydown',close);window.addEventListener('pointerdown',close);
    return()=>{window.removeEventListener('keydown',close);window.removeEventListener('pointerdown',close);};
  },[fallbackOpen]);
  function positionBubble(){
    const rect=button.current?.getBoundingClientRect();if(!rect)return;
    const width=Math.min(352,window.innerWidth-24);
    const maxHeight=Math.min(280,window.innerHeight-24);
    setPosition({left:Math.max(12,Math.min(rect.left,window.innerWidth-width-12)),top:Math.max(12,Math.min(rect.bottom+8,window.innerHeight-maxHeight-12))});
  }
  return <><button ref={button} type="button" className="graphics-help-bubble-trigger" popoverTarget={nativePopover?id:undefined} aria-expanded={nativePopover?undefined:fallbackOpen} aria-controls={id} aria-label={label||`Aide : ${topic.title}`} onClick={()=>{positionBubble();if(!nativePopover)setFallbackOpen(value=>!value);}}><CircleHelp size={17} aria-hidden="true"/>{label?<span>{label}</span>:null}</button>{typeof document!=='undefined'?createPortal(<div id={id} popover={nativePopover?'auto':undefined} hidden={!nativePopover&&!fallbackOpen} className={`graphics-help-bubble${fallbackOpen?' is-open':''}`} ref={panel} style={position}><div><strong>{topic.title}</strong><button type="button" className="graphics-help-icon-button" popoverTarget={nativePopover?id:undefined} popoverTargetAction={nativePopover?'hide':undefined} aria-label="Fermer cette aide" onClick={()=>{if(!nativePopover){setFallbackOpen(false);button.current?.focus();}}}><X size={15} aria-hidden="true"/></button></div><p>{topic.short}</p><p className="graphics-help-bubble-scope">{topic.scope}</p><p>{topic.steps[0].cue}</p><button type="button" className="graphics-help-quiet" onClick={()=>{if(nativePopover)panel.current?.hidePopover();else setFallbackOpen(false);requestGraphicsHelp(section);}}>Voir pas à pas<ArrowRight size={15} aria-hidden="true"/></button></div>,document.body):null}</>;
}
