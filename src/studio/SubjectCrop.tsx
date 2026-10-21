import {useEffect,useRef,useState} from 'react';
import {Crosshair,Check,X,ChevronDown} from 'lucide-react';
import type {CropMotion} from './crop-motion';
import type {SubjectBox} from './subject-tracker';
import {analyzeSubject,seekSubjectFrame} from './subject-analysis';
import {timeLabel} from './media-trim';

export default function SubjectCrop({url,start,end,duration,ratio,onPreview,onApply,onBusy}:{url:string;start:number;end:number;duration:number;ratio:number;onPreview:(motion:CropMotion|null)=>void;onApply:(motion:CropMotion)=>void;onBusy:(value:boolean)=>void}){
 const [open,setOpen]=useState(false),[ready,setReady]=useState(false),[box,setBox]=useState<SubjectBox>({x:.35,y:.25,w:.3,h:.5}),[busy,setBusy]=useState(false),[progress,setProgress]=useState(0),[error,setError]=useState('');
 const [result,setResult]=useState<{motion:CropMotion;stoppedAt:number|null}|null>(null),[after,setAfter]=useState(false),[accept,setAccept]=useState(false);
 const video=useRef<HTMLVideoElement|null>(null),canvas=useRef<HTMLCanvasElement|null>(null),reference=useRef<HTMLCanvasElement|null>(null),operation=useRef<AbortController|null>(null),lock=useRef(false),drag=useRef<{x:number;y:number}|null>(null),alive=useRef(true);
 const callbacks=useRef({onPreview,onApply,onBusy});callbacks.current={onPreview,onApply,onBusy};
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;operation.current?.abort();callbacks.current.onPreview(null);callbacks.current.onBusy(false);};},[]);
 useEffect(()=>{
  if(!open)return;const c=new AbortController(),node=document.createElement('video');video.current=node;setReady(false);setError('');node.crossOrigin='anonymous';node.preload='auto';node.muted=true;node.playsInline=true;
  const fail=()=>{if(!c.signal.aborted)setError('Impossible de lire le sujet. Vérifiez le média et son accès.');};
  const timer=setTimeout(fail,15000);
  node.onloadeddata=()=>{void seekSubjectFrame(node,start,c.signal).then(()=>{if(!c.signal.aborted){const image=document.createElement('canvas');image.width=480;image.height=Math.round(480*node.videoHeight/node.videoWidth);image.getContext('2d')!.drawImage(node,0,0,image.width,image.height);reference.current=image;setReady(true);clearTimeout(timer);}}).catch(fail);};node.onerror=fail;node.src=url;
  return()=>{c.abort();clearTimeout(timer);node.pause();node.removeAttribute('src');node.load();video.current=null;};
 },[open,url,start]);
 useEffect(()=>{
  const c=canvas.current,image=reference.current;if(!c||!image||!ready||busy)return;
  c.width=image.width;c.height=image.height;const ctx=c.getContext('2d')!;ctx.drawImage(image,0,0,c.width,c.height);
  ctx.strokeStyle='#ffe149';ctx.lineWidth=3;ctx.strokeRect(box.x*c.width,box.y*c.height,box.w*c.width,box.h*c.height);
 },[ready,box,open,busy]);
 function clear(){callbacks.current.onPreview(null);setResult(null);setAfter(false);setAccept(false);setError('');}
 function close(){operation.current?.abort();clear();setOpen(false);}
 async function calculate(){
  if(lock.current||!video.current)return;lock.current=true;const c=new AbortController();operation.current=c;clear();setBusy(true);callbacks.current.onBusy(true);setProgress(0);
  try{const next=await analyzeSubject(video.current,box,start,end,duration,ratio,c.signal,setProgress);c.signal.throwIfAborted();if(alive.current){setResult(next);setAfter(true);callbacks.current.onPreview(next.motion);}}
  catch(e){if(alive.current&&!c.signal.aborted)setError(e instanceof Error?e.message:String(e));}
  finally{lock.current=false;if(alive.current){setBusy(false);callbacks.current.onBusy(false);}}
 }
 const coordinate=(event:React.PointerEvent<HTMLCanvasElement>)=>{const r=event.currentTarget.getBoundingClientRect();return {x:Math.max(0,Math.min(1,(event.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(event.clientY-r.top)/r.height))};};
 return <section className="subject-crop" aria-label="Suivi assisté du sujet">
  {!open?<><div className="subject-crop-intro"><Crosshair size={19} aria-hidden="true"/><div><strong>Gardez le sujet dans le cadre</strong><p>Sélectionnez-le, puis vérifiez le mouvement proposé.</p></div></div><button type="button" className="subject-crop-start" disabled={duration>60||duration<=.04} onClick={()=>setOpen(true)}>Suivre un sujet</button></>:<>
   <div className="subject-crop-heading"><div><span className="subject-crop-step">{result?'ÉTAPE 2 SUR 2':'ÉTAPE 1 SUR 2'}</span><strong>{result?'Vérifiez le mouvement':'Choisissez le sujet'}</strong></div><button type="button" className="icon-button" aria-label="Fermer le suivi du sujet" onClick={close}><X size={17} aria-hidden="true"/></button></div>
   {!result?<><p className="small">Entourez un détail contrasté dans l’image de départ.</p>
   {!ready&&!error?<p role="status">Lecture de l’image…</p>:null}
   <canvas ref={canvas} aria-label="Image entière : zone du sujet à suivre" style={{aspectRatio:video.current?.videoWidth&&video.current.videoHeight?`${video.current.videoWidth}/${video.current.videoHeight}`:'16/9'}}
    onPointerDown={e=>{if(!ready||busy||result)return;drag.current=coordinate(e);e.currentTarget.setPointerCapture(e.pointerId);}}
    onPointerMove={e=>{const p=drag.current;if(!p||busy)return;const to=coordinate(e);setBox({x:Math.min(p.x,to.x),y:Math.min(p.y,to.y),w:Math.abs(to.x-p.x),h:Math.abs(to.y-p.y)});}}
    onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}} onLostPointerCapture={()=>{drag.current=null;}}/>
   <fieldset disabled={busy||!ready} className="subject-crop-selection"><details className="subject-crop-coordinates"><summary>Ajuster la zone au clavier<ChevronDown size={15} aria-hidden="true"/></summary><div className="subject-crop-coordinate-grid">{(['x','y','w','h'] as const).map((key,i)=><label key={key}>{['Gauche','Haut','Largeur','Hauteur'][i]} (%)<input type="number" min="0" max="100" step="1" value={Math.round(box[key]*100)} onChange={e=>setBox(v=>({...v,[key]:Math.max(0,Math.min(100,Number(e.target.value)))/100}))}/></label>)}</div></details><button type="button" className="primary" disabled={box.w<.05||box.h<.05||box.x+box.w>1.001||box.y+box.h>1.001} onClick={()=>void calculate()}><Crosshair size={16} aria-hidden="true"/>{busy?'Analyse en cours…':'Proposer un cadrage'}</button></fieldset></>:null}
   {busy?<div className="subject-crop-progress" role="status"><progress aria-label="Analyse du sujet" max={100} value={progress}/><span>{progress} % analysés</span><button type="button" onClick={()=>operation.current?.abort()}>Annuler le calcul</button></div>:null}
   {error?<p className="crop-notice" role="alert">{error}</p>:null}
   {result?<><p className="small">Lisez l’aperçu ci-dessous et comparez les deux cadrages.</p><div className="subject-crop-compare" role="group" aria-label="Comparer le cadrage"><button type="button" aria-pressed={!after} onClick={()=>{setAfter(false);callbacks.current.onPreview(null);}}>Avant</button><button type="button" aria-pressed={after} onClick={()=>{setAfter(true);callbacks.current.onPreview(result.motion);}}>Proposition</button></div>
    {result.stoppedAt!==null?<><p className="crop-notice" role="status">Sujet perdu ou ambigu à {timeLabel(result.stoppedAt)}. Le cadrage reste ensuite fixe.</p><label className="check subject-crop-consent"><input type="checkbox" checked={accept} onChange={e=>setAccept(e.target.checked)}/><span>J’ai vérifié la suite et j’accepte ce cadrage partiel.</span></label></>:<p className="small">Tout l’extrait a été analysé. Vérifiez le sujet et les bords.</p>}
    <button className="primary" type="button" disabled={result.stoppedAt!==null&&!accept} onClick={()=>{callbacks.current.onApply(result.motion);close();}}><Check size={16} aria-hidden="true"/>Appliquer ce cadrage</button>
    <button type="button" className="quiet subject-crop-retry" onClick={()=>{clear();setReady(false);const node=video.current;if(node)void seekSubjectFrame(node,start,new AbortController().signal).then(()=>{if(alive.current)setReady(true);}).catch(()=>{});}}>Choisir un autre sujet</button>
   </>:null}
   <small className="subject-crop-local">Calcul sur ce poste. Le suivi s’arrête si le sujet est perdu.</small>
  </>}
  {!open&&duration>60?<small>Suivi disponible jusqu’à 60 secondes. Au-delà, utilisez les repères manuels.</small>:null}
 </section>;
}
