import {useEffect,useRef,useState} from 'react';
import {RotateCcw,Bold,Italic,Upload} from 'lucide-react';
import {commercialPageStyle} from './model';
import type {CommercialPage,CommercialTextStyle} from './model';
import {localFonts,importLocalFont} from '../typography-fonts';

export default function TypographySettings({page,index,onChange,selection,request,readable=false}:{page:CommercialPage;index:number;onChange:(page:CommercialPage)=>void;selection?:'title'|'body';request?:number;readable?:boolean}){
  const [target,setTarget]=useState<'title'|'body'>('body'),[fonts,setFonts]=useState<{id:string;name:string}[]>([]),[fontBusy,setFontBusy]=useState(false),[error,setError]=useState('');
  const fileInput=useRef<HTMLInputElement>(null),alive=useRef(true),latest=useRef({page,index,onChange,readable});latest.current={page,index,onChange,readable};
  const details=useRef<HTMLDetailsElement>(null);
  useEffect(()=>{if(selection){setTarget(selection);if(details.current)details.current.open=true;}},[selection,request]);
  useEffect(()=>{alive.current=true;void localFonts().then(result=>{if(alive.current)setFonts(result);}).catch(()=>{});return()=>{alive.current=false;};},[]);
  const style=commercialPageStyle(page,index,readable);
  function update(patch:Partial<CommercialTextStyle>){const current=latest.current;current.onChange({...current.page,style:{...commercialPageStyle(current.page,current.index,current.readable),...patch}});}
  const font=style[`${target}Font`]??'original',fontName=style[`${target}FontName`]??'',scale=target==='title'?style.titleScale:style.bodyScale;
  async function importFont(file:File){
    setFontBusy(true);setError('');
    try{const imported=await importLocalFont(file);if(!alive.current)return;setFonts(await localFonts());if(alive.current)update({[`${target}Font`]:imported.id,[`${target}FontName`]:imported.name});}
    catch(error){if(alive.current)setError(error instanceof Error?error.message:String(error));}
    finally{if(alive.current)setFontBusy(false);}
  }
  return <details ref={details} className="commercial-details"><summary>Mise en forme du texte</summary><div className="commercial-details-content">
    <label>Bloc à modifier<select value={target} disabled={fontBusy} onChange={e=>setTarget(e.target.value as 'title'|'body')}><option value="body">Texte de la zone</option><option value="title">Titre de la zone</option></select></label>
    <label>Police<select value={font} disabled={fontBusy} onChange={e=>update({[`${target}Font`]:e.target.value,[`${target}FontName`]:fonts.find(font=>font.id===e.target.value)?.name??''})}><option value="original">Police du modèle</option><option value="benin">Benin Semi Bold</option><option value="suisse">Suisse Intl</option>{fonts.map(font=><option value={font.id} key={font.id}>{font.name}</option>)}{font.startsWith('local-font:')&&!fonts.some(item=>item.id===font)?<option value={font}>{fontName||'Police à reconnecter'}</option>:null}</select></label>
    <input ref={fileInput} type="file" className="commercial-file-input" tabIndex={-1} aria-hidden="true" aria-label="Importer une police" accept=".otf,.ttf,.woff,.woff2" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void importFont(file);}}/>
    <button type="button" disabled={fontBusy} onClick={()=>fileInput.current?.click()}><Upload size={15} aria-hidden="true"/>{fontBusy?'Chargement de la police…':'Importer une police'}</button>
    {error?<p role="alert" className="commercial-error">{error}</p>:null}
    <label>Taille du {target==='title'?'titre':'texte'} · {Math.round(scale*100)} %<input type="range" min={target==='title'?0.6:0.65} max="1.4" step="0.05" value={scale} onChange={e=>update({[`${target}Scale`]:Number(e.target.value)})}/></label>
    <div className="commercial-type-style" aria-label="Style des caractères"><button type="button" aria-label="Gras" aria-pressed={style[`${target}Bold`]??false} onClick={()=>update({[`${target}Bold`]:!style[`${target}Bold`]})}><Bold size={16} aria-hidden="true"/>Gras</button><button type="button" aria-label="Italique" aria-pressed={style[`${target}Italic`]??false} onClick={()=>update({[`${target}Italic`]:!style[`${target}Italic`]})}><Italic size={16} aria-hidden="true"/>Italique</button></div>
    <label>Casse<select value={style[`${target}Case`]??'typed'} onChange={e=>update({[`${target}Case`]:e.target.value})}><option value="typed">Comme saisi</option><option value="upper">MAJUSCULES</option><option value="lower">minuscules</option></select></label>
    <label>Couleur du {target==='title'?'titre':'texte'}<input type="color" value={style[`${target}Color`]} onChange={e=>update({[`${target}Color`]:e.target.value})}/></label>
    {target==='body'?<label>Alignement du texte<select value={style.align} onChange={e=>update({align:e.target.value as CommercialTextStyle['align']})}><option value="left">À gauche</option><option value="center">Centré</option><option value="right">À droite</option></select></label>:null}
    <label>Interligne · {Math.round(style.lineHeight*100)} %<input type="range" min="0.8" max="1.5" step="0.05" value={style.lineHeight} onChange={e=>update({lineHeight:Number(e.target.value)})}/></label>
    <label>Espacement des lettres · {Math.round(style.tracking*1000)}<input type="range" min="-0.05" max="0.15" step="0.005" value={style.tracking} onChange={e=>update({tracking:Number(e.target.value)})}/></label>
    <details className="commercial-details"><summary>Position et rotation du {target==='title'?'titre':'texte'}</summary><div className="commercial-details-content">
      <div className="commercial-pair"><label>Décalage horizontal du {target==='title'?'titre':'texte'}<input type="number" min="-200" max="200" step="1" value={style[`${target}X`]??0} onChange={e=>update({[`${target}X`]:Number(e.target.value)})}/></label><label>Décalage vertical du {target==='title'?'titre':'texte'}<input type="number" min="-200" max="200" step="1" value={style[`${target}Y`]??0} onChange={e=>update({[`${target}Y`]:Number(e.target.value)})}/></label></div>
      <label>Rotation du {target==='title'?'titre':'texte'} (°)<input type="number" min="-45" max="45" step="1" value={style[`${target}Rotation`]??0} onChange={e=>update({[`${target}Rotation`]:Number(e.target.value)})}/></label>
    </div></details>
    <button type="button" onClick={()=>onChange({...page,style:undefined})}><RotateCcw size={15} aria-hidden="true"/>Mise en forme d’origine</button>
    <small>Ces réglages suivent l’animation de cette zone. Une police importée reste sur ce poste ; importez le même fichier pour travailler ailleurs.</small>
  </div></details>;
}
