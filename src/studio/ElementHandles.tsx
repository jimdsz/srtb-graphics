import {useEffect,useState} from 'react';
import type {RefObject} from 'react';
import type {BroadcastTemplate} from './domain';
import type {ElementBox} from './element-selection';
import {OVERLAY_LOGO,BRAND_POSITION} from './element-selection';
import {previewElementBoxes} from './preview-elements';
import type {LegacyGraphic} from './video/engine';

export default function ElementHandles({host,template,social,disabled,onInspect,onSelect,playing=false}:{playing?:boolean;host:RefObject<HTMLDivElement|null>;template:BroadcastTemplate;social:boolean;disabled:boolean;onInspect:()=>Promise<boolean>;onSelect:(field:string)=>void}){
  const [boxes,setBoxes]=useState<ElementBox[]>([]),[selected,setSelected]=useState('');
  useEffect(()=>{
    if(disabled){setBoxes([]);return;}
    const refresh=()=>{const g=host.current?.firstElementChild as LegacyGraphic|null;setBoxes(g?previewElementBoxes(g,template,social):[]);};
    const screen=host.current?.parentElement;let hovering=false;
    const tick=()=>{if(!playing||hovering)refresh();};
    const enter=()=>{hovering=true;tick();},leave=()=>{hovering=false;if(playing)setBoxes([]);};
    if(playing)setBoxes([]);else refresh();
    screen?.addEventListener('pointerenter',enter);screen?.addEventListener('pointerleave',leave);
    const timer=setInterval(tick,150);return()=>{clearInterval(timer);screen?.removeEventListener('pointerenter',enter);screen?.removeEventListener('pointerleave',leave);};
  },[disabled,template,social,host,playing]);
  useEffect(()=>{const screen=host.current?.parentElement;if(!screen)return;const clear=(event:Event)=>{if(!(event.target instanceof Element)||!event.target.closest('.element-handle'))setSelected('');};screen.addEventListener('pointerdown',clear);return()=>screen.removeEventListener('pointerdown',clear);},[host]);
  return <div className="element-handles" aria-label="Sélection des médias et logos">{!disabled&&boxes.map((box,index)=>{
    const field=template.fields[box.field];
    const title=box.field===OVERLAY_LOGO?'Logo supplémentaire':box.field===BRAND_POSITION?'Logo BTV':field?.title==='Fichier'?field['x-section']||field.title:field?.title||box.field;
    return <button key={box.field+index} type="button" className={`element-handle${selected===box.field?' is-selected':''}`} aria-label={'Modifier '+title} aria-pressed={selected===box.field} style={{left:box.x*100+'%',top:box.y*100+'%',width:box.width*100+'%',height:box.height*100+'%',zIndex:box.field===OVERLAY_LOGO?16:12}} onClick={()=>{setSelected(box.field);onSelect(box.field);void onInspect();}} onKeyDown={event=>{if(event.key==='Escape'){setSelected('');event.currentTarget.blur();}}}><span>{title}</span></button>;
  })}</div>;
}
