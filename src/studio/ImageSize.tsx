import {useEffect,useId,useState} from 'react';
import {Maximize2,RotateCcw} from 'lucide-react';
import type {FieldValue,ProjectData} from './domain';
import {imageScale,imageSizePatch,isResizableImage} from './image-sizing-model';
export default function ImageSize({value,field,data,onPatch}:{value:FieldValue;field:string;data:ProjectData;onPatch:(patch:ProjectData)=>void}){
  const id=useId(),size=imageScale(data,field),[draft,setDraft]=useState(String(size));
  useEffect(()=>setDraft(String(size)),[size]);
  if(!isResizableImage(value))return null;
  const change=(size:number)=>{if(Number.isFinite(size)&&size>=10&&size<=300)onPatch(imageSizePatch(data,field,size));};
  return <section className="image-size-setting" aria-label="Taille de l’image">
    <label htmlFor={id}><Maximize2 size={15} aria-hidden="true"/>Taille de l’image</label>
    <div className="image-size-controls"><input id={id} type="range" min="10" max="300" step="1" value={size} onChange={e=>change(Number(e.target.value))}/><label><span className="visually-hidden">Taille de l’image en pourcentage</span><input type="number" min="10" max="300" value={draft} onChange={e=>{setDraft(e.target.value);if(e.target.value!=='')change(Number(e.target.value));}} onBlur={()=>setDraft(String(size))}/> %</label><button type="button" title="Rétablir la taille d’origine" aria-label="Rétablir la taille d’origine" disabled={size===100} onClick={()=>change(100)}><RotateCcw size={15} aria-hidden="true"/></button></div>
    <small>Proportions conservées. Réduire laisse de la transparence autour ; agrandir peut couper les bords. Réglage propre à ce format, identique à l’export.</small>
  </section>;
}
