import {useRef} from 'react';
import type {PointerEvent} from 'react';
import {Move,Scaling,RotateCcw,X} from 'lucide-react';
import {commercialTextSlots} from './model';
import type {CommercialData} from './model';
import {editCommercialElement,elementSettings,selectionKey} from './editing';
import type {CommercialEditBox,CommercialSelection} from './editing';
import {commercialLogoAutoAligned} from './logo-layout';
import type {CommercialLogoSize} from './logo-layout';

export const elementLabel=(data:CommercialData,item:CommercialSelection)=>item.kind==='logo'?'Logo annonceur':`${item.kind==='title'?'Titre':'Texte'} · ${commercialTextSlots(data)[item.page]?.label??'Séquence'}`;
interface Props {data:CommercialData;boxes:CommercialEditBox[];selection:CommercialSelection|null;disabled:boolean;logoSize?:CommercialLogoSize|null;onSelect:(item:CommercialSelection|null)=>void;onChange:(data:CommercialData)=>void}
export function CanvasEditing({data,boxes,selection,disabled,logoSize,onSelect,onChange}:Props){
  const layer=useRef<HTMLDivElement>(null),latest=useRef({data,onChange,logoSize});latest.current={data,onChange,logoSize};
  const drag=useRef<{pointer:number;item:CommercialSelection;clientX:number;clientY:number;ratio:number;box:CommercialEditBox;settings:ReturnType<typeof elementSettings>;initial:ReturnType<typeof elementSettings>;initialData:CommercialData;data:CommercialData;mode:'move'|'resize'}|null>(null);
  function begin(event:PointerEvent<HTMLButtonElement>,box:CommercialEditBox,mode:'move'|'resize'){
    if(disabled||drag.current||event.button!==0||!layer.current)return;event.preventDefault();event.currentTarget.focus({preventScroll:true});onSelect(box);
    const settings=elementSettings(data,box,logoSize);
    drag.current={pointer:event.pointerId,item:box,clientX:event.clientX,clientY:event.clientY,ratio:1920/layer.current.getBoundingClientRect().width,box,settings,initial:settings,initialData:data,data,mode};
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event:PointerEvent<HTMLButtonElement>){
    const active=drag.current;if(!active||active.pointer!==event.pointerId)return;
    const dx=(event.clientX-active.clientX)*active.ratio,dy=(event.clientY-active.clientY)*active.ratio,autoAligned=active.item.kind==='logo'&&!!active.data.logo&&commercialLogoAutoAligned(active.data.logo);
    let patch:Partial<{x:number;y:number;scale:number}>;
    if(active.mode==='move')patch={x:active.settings.x+dx,y:active.settings.y+(autoAligned?0:dy)};
    else{const angle=active.box.rotation*Math.PI/180,x=dx*Math.cos(angle)+dy*Math.sin(angle),y=-dx*Math.sin(angle)+dy*Math.cos(angle),{width,height}=active.box;patch={scale:active.settings.scale*(1+2*(x*width+y*height)/(width*width+height*height))};}
    // Rebase every pointer event on the applied position, including at a border.
    // Waiting for React/the canvas here would accumulate invisible overshoot.
    const next=editCommercialElement(active.data,active.item,patch,latest.current.logoSize),applied=elementSettings(next,active.item,latest.current.logoSize);
    const factor=applied.scale/active.settings.scale,changed=applied.x!==active.settings.x||applied.y!==active.settings.y||applied.scale!==active.settings.scale;
    active.box={...active.box,width:active.box.width*factor,height:active.box.height*factor};
    active.data=next;active.settings=applied;active.clientX=event.clientX;active.clientY=event.clientY;
    if(!autoAligned||changed)latest.current.onChange(next);
  }
  function finish(event:PointerEvent<HTMLButtonElement>,cancel=false){
    const active=drag.current;if(!active||active.pointer!==event.pointerId)return;drag.current=null;
    if(cancel)latest.current.onChange(active.item.kind==='logo'?{...latest.current.data,logo:active.initialData.logo}:editCommercialElement(latest.current.data,active.item,active.initial,latest.current.logoSize));
    if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return <div ref={layer} className="commercial-edit-layer" aria-label="Éléments modifiables de l’aperçu">
    {boxes.map(box=>{const key=selectionKey(box),selected=!!selection&&selectionKey(selection)===key;return <div key={key} className={`commercial-element${selected?' is-selected':''}`} style={{left:`${box.x/19.2}%`,top:`${box.y/10.8}%`,width:`${box.width/19.2}%`,height:`${box.height/10.8}%`,transform:`translate(-50%,-50%) rotate(${box.rotation}deg)`}}>
      <button type="button" className="commercial-element-hit" disabled={disabled} aria-label={`Sélectionner ${elementLabel(data,box)}`} aria-pressed={selected} onClick={event=>{event.currentTarget.focus({preventScroll:true});onSelect(box);}} onPointerDown={event=>begin(event,box,'move')} onPointerMove={move} onPointerUp={event=>finish(event)} onPointerCancel={event=>finish(event,true)} onKeyDown={event=>{
        if(event.key==='Escape'){onSelect(null);return;}const step=event.shiftKey?10:1,settings=elementSettings(data,box,logoSize),delta=event.key==='ArrowLeft'?[-step,0]:event.key==='ArrowRight'?[step,0]:event.key==='ArrowUp'?[0,-step]:event.key==='ArrowDown'?[0,step]:null;
        if(delta){event.preventDefault();if(delta[1]&&box.kind==='logo'&&data.logo&&commercialLogoAutoAligned(data.logo))return;onSelect(box);onChange(editCommercialElement(data,box,{x:settings.x+delta[0],y:settings.y+delta[1]},logoSize));}
      }}><span>{elementLabel(data,box)}</span></button>
      {selected?<button type="button" className="commercial-element-resize" disabled={disabled} aria-label={`Redimensionner ${elementLabel(data,box)}`} title="Glisser pour régler la taille" onPointerDown={event=>begin(event,box,'resize')} onPointerMove={move} onPointerUp={event=>finish(event)} onPointerCancel={event=>finish(event,true)} onKeyDown={event=>{if(['ArrowUp','ArrowRight','ArrowDown','ArrowLeft'].includes(event.key)){event.preventDefault();const current=elementSettings(data,box,logoSize);onChange(editCommercialElement(data,box,{scale:current.scale+(['ArrowUp','ArrowRight'].includes(event.key)?1:-1)*.05},logoSize));}}}><Scaling size={12} aria-hidden="true"/></button>:null}
    </div>;})}
  </div>;
}
export function ElementTransform({data,selection,disabled,logoSize,onSelect,onChange}:Omit<Props,'boxes'>){
  if(!selection)return null;const settings=elementSettings(data,selection,logoSize),autoAligned=selection.kind==='logo'&&!!data.logo&&commercialLogoAutoAligned(data.logo);
  const patch=(change:Partial<{x:number;y:number;scale:number}>)=>onChange(editCommercialElement(data,selection,change,logoSize));
  return <fieldset className="commercial-element-settings" disabled={disabled} aria-label={`Taille et position · ${elementLabel(data,selection)}`}><legend><Move size={15} aria-hidden="true"/>{elementLabel(data,selection)}</legend>
    <label>Taille · {Math.round(settings.scale*100)} %<input type="range" aria-label="Taille de l’élément sélectionné" min={settings.min} max={settings.max} step="0.01" value={settings.scale} onChange={event=>patch({scale:Number(event.target.value)})}/></label>
    <label>Position horizontale<input type="number" aria-label="Position horizontale de l’élément sélectionné" min={-settings.limitX} max={settings.limitX} step="1" value={Number(settings.x.toFixed(2))} onChange={event=>patch({x:Number(event.target.value)})}/></label>
    <label>Position verticale<input type="number" aria-label="Position verticale de l’élément sélectionné" min={-settings.limitY} max={settings.limitY} step="1" disabled={autoAligned} value={autoAligned?0:Number(settings.y.toFixed(2))} onChange={event=>patch({y:Number(event.target.value)})}/></label>
    <button type="button" aria-label="Rétablir la taille et la position" title="Rétablir la taille et la position" onClick={()=>patch({x:0,y:0,scale:1})}><RotateCcw size={17}/></button><button type="button" aria-label="Terminer la modification de l’élément" onClick={()=>onSelect(null)}><X size={17}/></button>
    <small>{autoAligned?'Le logo reste aligné avec « Le fil des annonces ». Glissez-le horizontalement ou utilisez les flèches gauche et droite ; sa poignée règle sa taille. La position libre se règle dans les options du logo.':'Glissez l’élément pour le déplacer, sa poignée pour le redimensionner. Les flèches du clavier permettent un réglage précis.'}</small>
  </fieldset>;
}
