import {useEffect,useId,useRef,useState} from 'react';
import type {BroadcastTemplate,ProjectData} from './domain';
import {DEFAULT_TEXT_CASE,currentStyle,patchTextStyle,styleDefaults,textContentPatch,textFields} from './typography-model';
import type {TextStyle} from './typography-model';
import {importLocalFont,localFonts} from './typography-fonts';
import {textStyleUndo,undoTextStyle} from './typography-history';
import type {TextStyleUndo} from './typography-history';
import {Bold,Italic,FolderInput,RotateCcw,Undo2,Move} from 'lucide-react';
import CharterColourChoice from './CharterColourChoice';
import {patchTextColour} from './charter-colours';
import {applyWeeklyTitleFit,weeklyTitleFitRequest} from './weekly-title-fit';
import type {WeeklyTitleFitProposal} from './weekly-title-fit';
export default function TypographySettings({template,data,onChange,disabled,selectedElement}:{template:BroadcastTemplate;data:ProjectData;onChange:(patch:ProjectData)=>void;disabled:boolean;selectedElement?:{field:string;serial:number}}){
  const fields=textFields(template),[selection,setSelection]=useState(''),[error,setError]=useState(''),[reading,setReading]=useState(false),[undo,setUndo]=useState<TextStyleUndo|null>(null),file=useRef<HTMLInputElement>(null),id=useId();
  const field=fields.some(([k])=>k===selection)?selection:fields[0]?.[0],actual=currentStyle(data,field),style={...styleDefaults,case:data[DEFAULT_TEXT_CASE]==='upper'?'upper':'original',...actual},title=fields.find(([k])=>k===field)?.[1].title||field;
  const latest=useRef(data);latest.current=data;
  const [fonts,setFonts]=useState<{id:string;name:string}[]>([]);
  const fitRequest=weeklyTitleFitRequest(template,data,field??''),fitSignature=fitRequest?.signature??'';
  const [fitProposal,setFitProposal]=useState<WeeklyTitleFitProposal|null>(null),[fitError,setFitError]=useState(''),[measuring,setMeasuring]=useState(false);
  const fitGeneration=useRef(0),fitCurrent=useRef({signature:fitSignature,disabled});fitCurrent.current={signature:fitSignature,disabled};
  useEffect(()=>{fitGeneration.current++;setFitProposal(null);setFitError('');setMeasuring(false);return()=>{fitGeneration.current++;};},[fitSignature]);
  useEffect(()=>{if(selectedElement&&fields.some(([key])=>key===selectedElement.field)){setSelection(selectedElement.field);setError('');setUndo(null);}},[selectedElement]);
  useEffect(()=>{let mounted=true;void localFonts().then(list=>{if(mounted)setFonts(list);}).catch(()=>{});return()=>{mounted=false;};},[style.font]);
  if(!field)return null;
  function commit(next:ProjectData){const before=latest.current;latest.current={...before,...next};setUndo(textStyleUndo(before,latest.current,field));onChange(next);}
  function change(patch:Partial<TextStyle>|null){commit(patchTextStyle(latest.current,field,patch));}
  async function proposeSize(){
    const generation=++fitGeneration.current,signature=fitSignature,target=field,snapshot=latest.current;
    setMeasuring(true);setFitProposal(null);setFitError('');
    const current=()=>generation===fitGeneration.current&&signature===fitCurrent.current.signature&&!fitCurrent.current.disabled;
    try{const {measureWeeklyTitleFit}=await import('./weekly-title-measure');const proposal=await measureWeeklyTitleFit(template,snapshot,target);if(current())setFitProposal(proposal);}
    catch(e){if(current())setFitError(e instanceof Error?e.message:String(e));}
    finally{if(generation===fitGeneration.current)setMeasuring(false);}
  }
  function applySize(){if(!fitProposal)return;try{commit(applyWeeklyTitleFit(template,latest.current,field,fitProposal));setFitProposal(null);}catch(e){setFitError(e instanceof Error?e.message:String(e));}}
  async function choose(file:File){setReading(true);setError('');const target=field,format=data._studio_format;try{const font=await importLocalFont(file);if(latest.current._studio_format!==format)throw Error('Le format a changé. Choisissez de nouveau la police dans ce format.');const next=patchTextStyle(latest.current,target,{font:font.id,fontName:font.name});setUndo(textStyleUndo(latest.current,{...latest.current,...next},target));onChange(next);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setReading(false);}}
  return <section className="typography-editor" aria-label="Éditeur de texte"><header><h3>Texte & typographie</h3><span>{data._studio_format==='vertical'?'9:16':data._studio_format==='portrait'?'4:5':'16:9'}</span></header>
    <fieldset disabled={disabled||reading}>
    <label htmlFor={id}>Texte à modifier</label><select id={id} value={field} onChange={e=>setSelection(e.target.value)}>{fields.map(([key,f])=><option key={key} value={key}>{f.title||key}</option>)}</select>
    <label>Contenu · {title}<textarea rows={3} maxLength={template.fields[field].maxLength||2048} value={String(data[field]??'')} onChange={e=>onChange(textContentPatch(data,field,e.target.value))}/></label>
    <CharterColourChoice value={style.colour} onChange={colour=>commit(patchTextColour(latest.current,field,colour))}/>
    <div className="typography-grid">
      <label>Police<select value={style.font} onChange={e=>change({font:e.target.value,fontName:fonts.find(f=>f.id===e.target.value)?.name||''})}><option value="original">Police du modèle</option><option value="benin">Benin Semi Bold</option><option value="suisse">Suisse Intl</option>{fonts.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}{style.font.startsWith('local-font:')&&!fonts.some(f=>f.id===style.font)?<option value={style.font}>{style.fontName||'Police importée'}</option>:null}</select></label>
      <label>Taille (%)<input aria-label="Taille du texte en pourcentage" type="number" min="10" max="400" step="1" value={style.size} onChange={e=>change({size:Number(e.target.value)})}/></label>
    </div>
    {fitRequest?<div className="text-proposal">
      <button type="button" disabled={measuring} onClick={()=>void proposeSize()}>{measuring?'Mesure de la police…':'Proposer une taille adaptée'}</button>
      <p className="small muted">Pour la largeur du titre TV à sa pose stable. Le texte et le placement restent conservés ; contrôlez ensuite l’animation dans l’aperçu.</p>
      {fitProposal?.signature===fitSignature?<div role="status">
        {fitProposal.kind==='resize'?<><p>Proposition : de {fitProposal.current} % à {fitProposal.size} %.</p><button type="button" onClick={applySize}>Appliquer la taille proposée</button></>:<p>{fitProposal.kind==='unchanged'?`Le titre tient déjà à ${fitProposal.current} % dans la zone du modèle.`:fitProposal.reason}</p>}
        <button type="button" onClick={()=>setFitProposal(null)}>Fermer la proposition</button>
      </div>:null}
      {fitError?<p role="alert">{fitError}</p>:null}
    </div>:null}
    <input ref={file} hidden type="file" accept=".otf,.ttf,.woff,.woff2" aria-label="Fichier de police locale" onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void choose(f);}}/>
    <button className="typography-font-import" type="button" aria-describedby={`${id}-font-help`} onClick={()=>file.current?.click()}><FolderInput size={15} aria-hidden="true"/>{reading?'Vérification de la police…':'Importer une police'}</button>
    <small id={`${id}-font-help`} className="typography-font-help">OTF, TTF, WOFF, WOFF2 · 12 Mo maximum · sans envoi.</small>
    <div className="typography-grid">
      <label>Alignement<select value={style.align} onChange={e=>change({align:e.target.value as TextStyle['align']})}><option value="original">Du modèle</option><option value="left">Gauche</option><option value="center">Centré</option><option value="right">Droite</option></select></label>
      <label>Casse<select value={style.case} onChange={e=>change({case:e.target.value as TextStyle['case']})}><option value="original">Du modèle</option><option value="typed">Comme saisi</option><option value="upper">MAJUSCULES</option><option value="lower">minuscules</option></select></label>
      <div className="typography-weight"><span>Style</span><div className="row"><button type="button" aria-label="Gras" title="Gras" aria-pressed={style.bold} onClick={()=>change({bold:!style.bold})}><Bold size={16}/></button><button type="button" aria-label="Italique" title="Italique" aria-pressed={style.italic} onClick={()=>change({italic:!style.italic})}><Italic size={16}/></button></div></div>
    </div>
    <details className="typography-advanced"><summary>Position, rotation & espacement</summary><div className="typography-grid">
      <label>Décalage X (px)<input type="number" min="-4096" max="4096" step="1" value={style.x} onChange={e=>change({x:Number(e.target.value)})}/></label>
      <label>Décalage Y (px)<input type="number" min="-4096" max="4096" step="1" value={style.y} onChange={e=>change({y:Number(e.target.value)})}/></label>
      <label>Rotation (°)<input type="number" min="-180" max="180" step="1" value={style.rotation} onChange={e=>change({rotation:Number(e.target.value)})}/></label>
      <label>Interligne<input type="number" min=".5" max="3" step=".05" value={style.lineHeight} onChange={e=>change({lineHeight:Number(e.target.value)})}/></label>
      <label>Espacement (px)<input type="number" min="-10" max="50" step=".5" value={style.tracking} onChange={e=>change({tracking:Number(e.target.value)})}/></label>
    </div></details>
    <div className="typography-actions">{!actual?<button type="button" onClick={()=>change({size:100})}><Move size={14}/>Personnaliser la mise en forme</button>:<button type="button" onClick={()=>change(null)}><RotateCcw size={14}/>Rétablir la charte</button>}
    {undo!==null?<button type="button" onClick={()=>{onChange(undoTextStyle(latest.current,undo));setUndo(null);}}><Undo2 size={14}/>Annuler le réglage</button>:null}</div>
    <p className="small muted typography-note">Cliquez sur un texte dans l’aperçu pour ouvrir ses réglages.</p>
    <details className="typography-help"><summary>Raccourcis, polices et charte</summary><small>Glissez le texte, ou utilisez les flèches : 1 px, Maj + flèche : 10 px. Les modifications sont visibles automatiquement ; chaque format garde ses réglages.</small><small>100 % correspond à la taille d’origine. Gras et italique sont des effets ; importez la vraie variante pour une typographie exacte. Un autre poste devra importer le même fichier de police ; le paquet HTML exporté l’embarque. Les textes personnalisés suivent leur animation. Contrôlez leurs marges et superpositions avant livraison.</small></details>
    </fieldset>{error?<p className="notice error" role="alert">{error}</p>:null}
  </section>;
}
