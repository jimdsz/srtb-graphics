import {useEffect,useRef,useState} from 'react';
import type {RefObject} from 'react';
import type {BroadcastTemplate,ProjectData} from './domain';
import type {TextBox} from './typography-engine';
import {currentStyle} from './typography-model';
import {clampTextPosition,nudgeText,textArrow} from './typography-position';
import {finishTextDrag} from './typography-drag';
import {dimensions} from './presentation';
import type {LegacyGraphic} from './video/engine';
interface Drag {field:string;x:number;y:number;pointerX:number;pointerY:number;dx:number;dy:number;ready:boolean;cancelled:boolean;released:boolean;moved:boolean}
export default function TypographyHandles({host,data,template,onChange,disabled,onInspect,onSelect,playing=false}:{playing?:boolean;host:RefObject<HTMLDivElement|null>;data:ProjectData;template:BroadcastTemplate;onChange:(next:ProjectData)=>void;disabled:boolean;onInspect:()=>Promise<boolean>;onSelect?:(field:string)=>void}){
  const [selected,setSelected]=useState(''),[boxes,setBoxes]=useState<TextBox[]>([]);
  const latest=useRef(data),selection=useRef(''),drag=useRef<Drag|null>(null),blocked=useRef(disabled),queue=useRef(Promise.resolve());
  latest.current=data;blocked.current=disabled;
  const control=()=>{const g=host.current?.firstElementChild as LegacyGraphic|null;return latest.current._studio_format&&latest.current._studio_format!=='tv'?g?.__socialTypography:g?.__typography;};
  function select(field:string){selection.current=field;setSelected(field);if(field)onSelect?.(field);}
  function refresh(){setBoxes(control()?.boxes()||[]);}
  function cancel(){const d=drag.current;if(d){d.cancelled=true;const st=currentStyle(latest.current,d.field);control()?.nudge(d.field,st?.x??0,st?.y??0);}drag.current=null;}
  function move(d:Drag){if(!d.ready||d.cancelled||!d.moved||blocked.current)return;control()?.nudge(d.field,clampTextPosition(d.x+d.dx),clampTextPosition(d.y+d.dy));refresh();}
  function commit(d:Drag){
    if(d.cancelled||blocked.current||!d.ready)return;
    drag.current=null;
    if(!d.moved)return;
    const next=finishTextDrag(latest.current,d);
    if(next===latest.current){const st=currentStyle(next,d.field);control()?.nudge(d.field,st?.x??0,st?.y??0);return;}
    const after=currentStyle(next,d.field)!;
    latest.current=next;control()?.nudge(d.field,after.x??0,after.y??0);onChange(next);refresh();
  }
  useEffect(()=>{if(disabled){cancel();select('');setBoxes([]);return;}const screen=host.current?.parentElement;let hovering=false;
    const tick=()=>{if(!playing||hovering||drag.current)refresh();};
    const enter=()=>{hovering=true;tick();},leave=()=>{hovering=false;if(playing&&!drag.current)setBoxes([]);};
    if(playing)setBoxes([]);else refresh();
    screen?.addEventListener('pointerenter',enter);screen?.addEventListener('pointerleave',leave);
    const timer=setInterval(tick,150);
    return()=>{clearInterval(timer);screen?.removeEventListener('pointerenter',enter);screen?.removeEventListener('pointerleave',leave);};
  },[disabled,data._studio_format,host,playing]);
  useEffect(()=>{const screen=host.current?.parentElement;if(!screen)return;const blank=(event:PointerEvent)=>{if(!(event.target instanceof Element)||!event.target.closest('.typography-handle')){cancel();select('');}};screen.addEventListener('pointerdown',blank);return()=>{screen.removeEventListener('pointerdown',blank);cancel();};},[host]);
  useEffect(()=>{const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){cancel();select('');refresh();}};window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape);},[]);
  return <>{!disabled?<><div className="typography-handles" aria-label="Sélection directe des textes">
    {boxes.map((box,index)=><button type="button" key={box.field+index} aria-label={'Déplacer '+(template.fields[box.field]?.title||box.field)} aria-pressed={selected===box.field} className={`typography-handle${selected===box.field?' is-selected':''}`} style={{left:box.x*100+'%',top:box.y*100+'%',width:Math.max(.01,box.width)*100+'%',height:Math.max(.01,box.height)*100+'%'}}
      onFocus={()=>select(box.field)}
      onPointerDown={e=>{
        if(e.button!==0||e.ctrlKey||e.altKey||e.metaKey)return;
        e.preventDefault();cancel();e.currentTarget.setAttribute('data-dragging','');select(box.field);e.currentTarget.focus({preventScroll:true});e.currentTarget.setPointerCapture(e.pointerId);
        const st=currentStyle(latest.current,box.field),d:Drag={field:box.field,x:st?.x??0,y:st?.y??0,pointerX:e.clientX,pointerY:e.clientY,dx:0,dy:0,ready:false,cancelled:false,released:false,moved:false};drag.current=d;
        void onInspect().then(allowed=>{if(!allowed||d.cancelled){if(drag.current===d)cancel();return;}d.ready=true;if(d.released)commit(d);else move(d);});
      }}
      onPointerMove={e=>{const d=drag.current;if(!d||d.released)return;const rect=host.current!.getBoundingClientRect(),size=dimensions(latest.current);d.dx=(e.clientX-d.pointerX)*size.width/rect.width;d.dy=(e.clientY-d.pointerY)*size.height/rect.height;d.moved ||= Math.hypot(e.clientX-d.pointerX,e.clientY-d.pointerY)>=2;move(d);}}
      onPointerUp={e=>{e.currentTarget.removeAttribute('data-dragging');const d=drag.current;if(!d)return;d.released=true;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);commit(d);}}
      onPointerCancel={e=>{e.currentTarget.removeAttribute('data-dragging');cancel();refresh();}}
      onLostPointerCapture={()=>{if(drag.current&&!drag.current.released){cancel();refresh();}}}
      onKeyDown={e=>{
        const delta=textArrow(e);if(!delta||e.target!==e.currentTarget)return;e.preventDefault();cancel();const field=box.field;
        // Read the newest draft after every acknowledgement: repeats accumulate.
        queue.current=queue.current.then(async()=>{if(blocked.current||selection.current!==field||!await onInspect()||blocked.current||selection.current!==field)return;const next=nudgeText(latest.current,field,delta),st=currentStyle(next,field)!;latest.current=next;control()?.nudge(field,st.x??0,st.y??0);onChange(next);refresh();});
      }}
    ><span>{template.fields[box.field]?.title||box.field}</span></button>)}
  </div>{selected?<span className="typography-selection-help">Glisser · flèches 1 px · Maj 10 px · Échap désélectionne</span>:null}</>:null}</>;
}
