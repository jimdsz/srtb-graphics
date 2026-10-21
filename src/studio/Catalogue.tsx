import {lazy, Suspense, useEffect, useMemo, useState} from 'react';
import {ArrowRight, LayoutGrid, Monitor, Smartphone, Play, Search, Film} from 'lucide-react';
import type {BroadcastTemplate} from './domain';
import {api} from './api';
import {cataloguePreviewData} from './catalogue-preview';
import {simpleBaDefaults} from './presentation';
import Activity from './Activity';
import {HelpBubble} from './GraphicsHelp';

const Preview=lazy(()=>import('./Preview'));
const choiceKey=(template:BroadcastTemplate)=>template.id+(template.fields._studio_ba_mode?.default==='simple'?'-simple':'');
const posterById:Record<string,string>={
  BTV_PopUp:'/thumbnails/btv-popup.png',
  BTV_BA_TDS:'/library/v1.7.0/BTV_BA_TDS/lib/frames/frame_0070.png',
};

function catalogueChoices(templates:BroadcastTemplate[]):BroadcastTemplate[]{
  const base=templates.find(template=>template.id==='BTV_BA_1P');
  if(!base)return templates;
  const simpleData=simpleBaDefaults(cataloguePreviewData(base));
  return [{...base,name:'Bande-annonce simple',description:'Un programme et un rendez-vous. Choisissez votre média, la date de diffusion et la voix.',fields:Object.fromEntries(Object.entries(base.fields).map(([key,field])=>[key,{...field,default:simpleData[key]}]))},...templates];
}

export default function Catalogue({create}:{create:(template:BroadcastTemplate)=>void}){
  const [available,setAvailable]=useState<BroadcastTemplate[]|null>(null);
  const [error,setError]=useState('');
  const [attempt,setAttempt]=useState(0);
  const [query,setQuery]=useState('');
  const [category,setCategory]=useState('Tous');
  const [selectedId,setSelectedId]=useState('BTV_BA_TDS');
  const [previewId,setPreviewId]=useState<string|null>(null);
  useEffect(()=>{
    let current=true;
    setError('');
    api.catalogue().then(templates=>{if(current)setAvailable(templates);}).catch(cause=>{if(current)setError(cause instanceof Error?cause.message:'La bibliothèque ne peut pas être chargée.');});
    return()=>{current=false;};
  },[attempt]);
  const choices=useMemo(()=>catalogueChoices(available??[]),[available]);
  const categories=['Tous',...new Set(choices.map(template=>template.category))];
  const search=query.trim().toLocaleLowerCase('fr');
  const templates=choices.filter(template=>(category==='Tous'||template.category===category)&&`${template.name} ${template.description}`.toLocaleLowerCase('fr').includes(search));
  const selected=templates.find(template=>choiceKey(template)===selectedId)??templates[0];
  const previewData=useMemo(()=>selected?cataloguePreviewData(selected):null,[selected]);
  const poster=selected?posterById[selected.id]:undefined;

  function selectTemplate(id:string){setSelectedId(id);setPreviewId(null);}
  function clearFilters(){setQuery('');setCategory('Tous');setPreviewId(null);}

  return <>
    <div className="section-heading catalogue-heading"><div><div className="help-title-row"><h1>Bibliothèque</h1><HelpBubble section="library"/></div><p>Les modèles de votre chaîne, prêts à personnaliser.</p></div>{available?.length?<span className="library-version">{choices.length} modèles</span>:null}</div>
    {error?<div className="notice error" role="alert"><p>{error}</p><button onClick={()=>setAttempt(value=>value+1)}>Réessayer</button></div>:null}
    {!available&&!error?<Activity label="Chargement de la bibliothèque"/>:null}
    {available?.length===0?<div className="empty catalogue-empty"><LayoutGrid size={32} strokeWidth={1.3} aria-hidden="true"/><h2>La bibliothèque de cette chaîne est vide</h2><p>Les modèles ajoutés par votre administrateur apparaîtront ici.</p></div>:null}
    {available&&available.length>0?<>
      <div className="filter-row catalogue-filters"><label className="search"><span className="sr-only">Rechercher un modèle</span><span className="search-control"><Search size={18} aria-hidden="true"/><input type="search" value={query} onChange={event=>{setQuery(event.target.value);setPreviewId(null);}} placeholder="Rechercher un modèle…"/></span></label><label className="catalogue-family"><span className="sr-only">Famille</span><select aria-label="Famille" value={category} onChange={event=>{setCategory(event.target.value);setPreviewId(null);}}>{categories.map(value=><option key={value}>{value}</option>)}</select></label><span className="filter-result" role="status">{templates.length} résultat{templates.length>1?'s':''}</span></div>
      {selected?<div className="catalogue-layout">
        <div className="catalogue-index">
          <div className="catalogue-list" aria-label="Choisir un modèle">{templates.map(template=><button key={choiceKey(template)} className="catalogue-choice" aria-pressed={choiceKey(selected)===choiceKey(template)} onClick={()=>selectTemplate(choiceKey(template))}><span className="catalogue-choice-image" aria-hidden="true">{posterById[template.id]?<img src={posterById[template.id]} alt="" loading="lazy" width="96" height="54"/>:<Film size={23} strokeWidth={1.3}/>}</span><span className="catalogue-choice-copy"><strong>{template.name}</strong><small>{template.category}</small></span><ArrowRight size={15} aria-hidden="true"/></button>)}</div>
          <label className="catalogue-mobile-choice">Choisir un modèle<select value={choiceKey(selected)} onChange={event=>selectTemplate(event.target.value)}>{templates.map(template=><option key={choiceKey(template)} value={choiceKey(template)}>{template.name}</option>)}</select></label>
        </div>
        <article className="template-detail" aria-label={`Modèle : ${selected.name}`}>
          <div className="template-detail-heading"><div><p className="eyebrow">{selected.category}</p><h2>{selected.name}</h2></div><button className="primary" onClick={()=>create(selected)}>Créer un projet<ArrowRight size={17} aria-hidden="true"/></button></div>
          {previewId===choiceKey(selected)&&previewData?<Suspense fallback={<div className="preview-gate preview-gate-loading"><Activity label="Ouverture de l’aperçu…"/></div>}><Preview key={choiceKey(selected)} template={selected} data={previewData}/></Suspense>:<div className={`preview-gate${poster?' has-native-frame':''}`}>
            {poster?<img src={poster} alt={`Image du modèle ${selected.name}`} width="1920" height="1080"/>:<div className="preview-gate-title"><Film size={32} strokeWidth={1.1} aria-hidden="true"/><p>{selected.name}</p></div>}
            <button onClick={()=>setPreviewId(choiceKey(selected))}><Play size={16} aria-hidden="true"/>Charger l’aperçu</button>
            <span className="preview-gate-caption">Animation chargée à la demande</span>
          </div>}
          <div className="template-format-strip" aria-label="Formats de création"><span><Monitor size={15} aria-hidden="true"/>TV 16:9</span><span><Smartphone size={15} aria-hidden="true"/>Portrait 4:5</span><span><Smartphone size={15} aria-hidden="true"/>Vertical 9:16</span></div>
          <p className="template-description">{selected.description}</p>
          <details className="template-information"><summary>Détails du modèle</summary><dl><div><dt>Format TV</dt><dd>{selected.width} × {selected.height}</dd></div><div><dt>Cadence</dt><dd>{selected.fps} images/s</dd></div><div><dt>Version</dt><dd>{selected.version}</dd></div></dl><p>Les médias de démonstration restent dans cet aperçu. Choisissez vos médias dans le projet.</p>{selected.id==='BTV_Passerelle_Replay'?<p>Le QR code de démonstration renvoie à SRTB Graphics. Vous renseignerez l’adresse réelle du replay dans votre projet.</p>:null}</details>
        </article>
      </div>:<div className="empty"><Search size={28} aria-hidden="true"/><h2>Aucun modèle trouvé</h2><p>Essayez un autre terme ou une autre famille.</p><button onClick={clearFilters}>Effacer les filtres</button></div>}
    </>:null}
  </>;
}
