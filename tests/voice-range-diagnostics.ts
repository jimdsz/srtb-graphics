import type {VoiceRangeState} from '../src/studio/voice-range-draft';

/** Archived local test helper, disconnected from the application. No bytes,
 * names, URLs, global or IO. Explicitly attach only in a local test harness. */
export function attachVoiceRangeDiagnostics(form:HTMLFormElement,snapshot:()=>VoiceRangeState){
  const started=performance.now(),entries:Record<string,unknown>[]=[];
  let previousGeometry='',live=true;
  function geometry(){
    const button=form.querySelector<HTMLButtonElement>('[data-voice-action="measure"]');
    if(!button)return null;
    const rect=button.getBoundingClientRect(),round=(value:number)=>Math.round(value*10)/10;
    return {x:round(rect.x),y:round(rect.y),width:round(rect.width),height:round(rect.height),disabled:button.disabled};
  }
  function record(event:string,extra:Record<string,unknown>={}){
    if(!live)return;
    const state=snapshot();entries.push({ms:Math.round(performance.now()-started),event,status:state.status,revision:state.revision,hasSource:!!state.source,start:state.start,end:state.end,button:geometry(),...extra});
    if(entries.length>48)entries.shift();
    form.setAttribute('data-voice-range-debug',JSON.stringify(entries));
  }
  function capture(event:Event){
    const target=event.target instanceof Element?event.target:null;
    const action=target?.closest('[data-voice-action]')?.getAttribute('data-voice-action');
    const extra:Record<string,unknown>={target:action||target?.tagName||'unknown',trusted:event.isTrusted};
    if(target instanceof HTMLInputElement)extra.inputType=target.type;
    if(event instanceof MouseEvent){extra.x=event.clientX;extra.y=event.clientY;}
    record(event.type,extra);
    queueMicrotask(()=>record(`${event.type}:after`,extra));
  }
  const types=['change','pointerdown','pointerup','click','keydown'];
  for(const type of types)form.addEventListener(type,capture,true);
  const observer=new MutationObserver(()=>{
    const current=JSON.stringify(geometry());
    if(current!==previousGeometry){previousGeometry=current;record('button-layout');}
  });
  observer.observe(form,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['disabled','aria-busy']});
  record('attached');
  return()=>{live=false;observer.disconnect();for(const type of types)form.removeEventListener(type,capture,true);form.removeAttribute('data-voice-range-debug');};
}
