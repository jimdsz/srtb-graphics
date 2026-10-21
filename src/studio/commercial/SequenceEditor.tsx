import {useEffect,useId,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,Copy,Plus,Trash2} from 'lucide-react';
import {COMMERCIAL_MAX_DURATION,COMMERCIAL_MAX_SEQUENCES,COMMERCIAL_MIN_SEQUENCE_DURATION,commercialSequenceTimeline,commercialTextSlots,createCommercialSequences} from './model';
import type {CommercialData,CommercialSequence} from './model';
import {COMMERCIAL_LAYOUT_CHOICES,COMMERCIAL_LAYOUT_LABELS} from './sequence-labels';
import {durationLabel} from './DurationSettings';
import CommercialDialog from './CommercialDialog';
import './sequence-editor.css';

const clock=(seconds:number)=>`${Math.floor(seconds/60).toString().padStart(2,'0')}:${Math.floor(seconds%60).toString().padStart(2,'0')}`;
function DurationInput({value,disabled,label,onFocus,onCommit}:{value:number;disabled:boolean;label:string;onFocus:()=>void;onCommit:(value:number)=>void}){
  const [draft,setDraft]=useState(String(Math.round(value*10)/10));
  useEffect(()=>setDraft(String(Math.round(value*10)/10)),[value]);
  function commit(){
    const parsed=Number(draft);
    if(!draft.trim()||!Number.isFinite(parsed)){setDraft(String(Math.round(value*10)/10));return;}
    const next=Math.min(COMMERCIAL_MAX_DURATION,Math.max(COMMERCIAL_MIN_SEQUENCE_DURATION,Math.round(parsed*10)/10));
    setDraft(String(next));if(Math.abs(next-value)>.01)onCommit(next);
  }
  return <input name="sequence-duration" autoComplete="off" inputMode="decimal" type="number" aria-label={label} min={COMMERCIAL_MIN_SEQUENCE_DURATION} max={COMMERCIAL_MAX_DURATION} step="0.1" value={draft} disabled={disabled} onFocus={onFocus} onChange={event=>setDraft(event.target.value)} onBlur={commit} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();event.currentTarget.blur();}}}/>;
}

export default function SequenceEditor({data,page,disabled,onSelect,onChange}:{data:CommercialData;page:number;disabled:boolean;onSelect:(page:number)=>void;onChange:(data:CommercialData,page?:number)=>void}){
  const [adding,setAdding]=useState<string|null>(null),[remove,setRemove]=useState<string|null>(null),id=useId(),strip=useRef<HTMLOListElement>(null);
  const timeline=commercialSequenceTimeline(data),slots=commercialTextSlots(data),selected=slots[page]??slots[0],index=selected.sequenceIndex,entry=timeline[index];
  const custom=!!data.sequences,automatic=custom&&data.sequenceTiming!=='manual',requested=data.sequences?.[index].duration??entry.duration;
  const canAdd=timeline.length<COMMERCIAL_MAX_SEQUENCES,removeIndex=timeline.findIndex(item=>item.id===remove),addIndex=timeline.findIndex(item=>item.id===adding);
  useEffect(()=>{
    const rail=strip.current;if(!rail)return;
    function revealSelection(){
      const button=rail!.querySelector<HTMLElement>('[aria-pressed="true"]');if(!button)return;
      const a=rail!.getBoundingClientRect(),b=button.getBoundingClientRect();
      if(b.left<a.left+6)rail!.scrollLeft-=a.left-b.left+6;
      else if(b.right>a.right-6)rail!.scrollLeft+=b.right-a.right+6;
    }
    revealSelection();const observer=new ResizeObserver(revealSelection);observer.observe(rail);
    return()=>observer.disconnect();
  },[entry.id,index]);
  function editable(){return {...createCommercialSequences(data)};}
  function emit(next:CommercialData,sequenceIndex:number,slot=0){const target=commercialTextSlots(next).find(item=>item.sequenceIndex===sequenceIndex&&item.slot===slot);onChange(next,target?.index??0);}
  function add(layout:CommercialSequence['layout']){
    if(addIndex<0||!canAdd)return;
    const next=editable(),insertion=addIndex+1;
    const sequence:CommercialSequence={id:crypto.randomUUID(),layout,duration:8,pages:layout==='columns'?[{title:'AU PROGRAMME',body:''},{title:'INFORMATIONS',body:''}]:[{title:layout==='central'?'COMMUNIQUÉ':layout==='final'?'RENDEZ-VOUS':'INFORMATIONS',body:''}]};
    next.sequences=[...next.sequences!.slice(0,insertion),sequence,...next.sequences!.slice(insertion)];
    setAdding(null);emit(next,insertion);
  }
  function duplicate(){const next=editable(),sequence=structuredClone(next.sequences![index]);sequence.id=crypto.randomUUID();next.sequences=[...next.sequences!.slice(0,index+1),sequence,...next.sequences!.slice(index+1)];emit(next,index+1,selected.slot);}
  function reorder(direction:number){const next=editable(),list=[...next.sequences!];[list[index],list[index+direction]]=[list[index+direction],list[index]];next.sequences=list;emit(next,index+direction,selected.slot);}
  function deleteSequence(){if(removeIndex<0||timeline.length===1)return;const next=editable();next.sequences=next.sequences!.filter((_,i)=>i!==removeIndex);emit(next,Math.min(removeIndex,next.sequences.length-1));setRemove(null);}
  function setDuration(duration:number){const next=editable();next.sequenceTiming='manual';next.sequences=next.sequences!.map((sequence,i)=>({...sequence,duration:i===index?duration:automatic?Math.max(COMMERCIAL_MIN_SEQUENCE_DURATION,timeline[i].duration):sequence.duration}));onChange(next,page);}
  function setTiming(value:string){const next=editable();next.sequenceTiming=value==='manual'?'manual':'auto';if(value==='manual')next.sequences=next.sequences!.map((sequence,i)=>({...sequence,duration:Math.max(COMMERCIAL_MIN_SEQUENCE_DURATION,timeline[i].duration)}));onChange(next,page);}
  return <section className="commercial-sequence-editor" aria-labelledby={`${id}-title`}>
    <div className="commercial-sequence-heading"><div><h2 id={`${id}-title`}>Déroulé de l’annonce</h2><p>De gauche à droite, dans l’ordre de lecture.</p></div><button type="button" className="primary" disabled={disabled||!canAdd} onClick={()=>{onSelect(page);setAdding(entry.id);}}><Plus size={16} aria-hidden="true"/>Ajouter une séquence</button></div>
    <ol className="commercial-sequence-strip" ref={strip} aria-label="Séquences dans l’ordre de lecture">{timeline.map((item,i)=>{
      const textSlots=slots.filter(slot=>slot.sequenceIndex===i),title=textSlots.map(slot=>slot.page.title.trim()||'Texte à compléter').join(' / ');
      return <li key={item.id}><button type="button" aria-pressed={i===index} disabled={disabled} aria-label={`Séquence ${i+1} : ${title}`} onClick={()=>onSelect(textSlots[0].index)}>
        <span className="commercial-sequence-chip-top"><span className="commercial-sequence-number">{i+1}</span><small>{durationLabel(item.duration)}</small></span>
        <strong title={title}>{title}</strong><span className="commercial-sequence-layout">{COMMERCIAL_LAYOUT_LABELS[item.layout]}</span><span className="commercial-sequence-time">{clock(item.start)} – {clock(item.end)}</span>
      </button></li>;
    })}</ol>
    <div className="commercial-sequence-selection"><strong>Séquence {index+1} sur {timeline.length}</strong><div className="commercial-sequence-actions">
      <button type="button" disabled={disabled||index===0} onClick={()=>reorder(-1)}><ArrowLeft size={15} aria-hidden="true"/>Déplacer avant</button>
      <button type="button" disabled={disabled||index===timeline.length-1} onClick={()=>reorder(1)}>Déplacer après<ArrowRight size={15} aria-hidden="true"/></button>
      <button type="button" disabled={disabled||!canAdd} onClick={duplicate}><Copy size={15} aria-hidden="true"/>Dupliquer</button>
      <button type="button" disabled={disabled||timeline.length===1} aria-label={`Supprimer la séquence ${index+1}`} title="Supprimer cette séquence" onClick={()=>{onSelect(page);setRemove(entry.id);}}><Trash2 size={15} aria-hidden="true"/>Supprimer</button>
    </div></div>
    <div className="commercial-sequence-timing"><label>Durées<select name="sequence-timing" disabled={disabled} value={!custom?'template':automatic?'auto':'manual'} onChange={event=>setTiming(event.target.value)}>{!custom?<option value="template">Durées du modèle actuel</option>:null}<option value="auto">Automatiques</option><option value="manual">Personnalisées</option></select></label>
      <label className="commercial-selected-duration">Cette séquence{automatic?<output>{durationLabel(entry.duration)}</output>:<span><DurationInput key={entry.id} value={requested} disabled={disabled} label={`Durée de la séquence ${index+1} en secondes`} onFocus={()=>onSelect(page)} onCommit={setDuration}/><span>s</span></span>}</label>
      <p>{automatic?data.textMode?'Chaque écran dispose d’un temps de lecture adapté à son texte. Toute la voix off est conservée. Vérifiez les changements d’écran à l’écoute.':'Les séquences se partagent la durée de la voix off ou la durée totale choisie.':'Réglez le temps de la séquence sélectionnée. La vidéo conserve toute la voix off.'}{!automatic&&entry.duration>requested+.08?` Cette séquence reste affichée ${durationLabel(entry.duration)} pour couvrir l’annonce.`:''}</p>
    </div>
    {adding?<CommercialDialog title="Ajouter une séquence" onClose={()=>setAdding(null)}><p>Elle sera insérée après la séquence {addIndex+1}. Choisissez la disposition du texte.</p><div className="commercial-layout-options">{COMMERCIAL_LAYOUT_CHOICES.map(layout=><button key={layout} type="button" onClick={()=>add(layout)}><span className={`commercial-layout-miniature ${layout}`} aria-hidden="true"><i/><i/></span><strong>{COMMERCIAL_LAYOUT_LABELS[layout]}</strong></button>)}</div><div className="commercial-dialog-actions"><button type="button" data-autofocus onClick={()=>setAdding(null)}>Annuler</button></div></CommercialDialog>:null}
    {remove!==null?<CommercialDialog title={`Supprimer la séquence ${removeIndex+1} ?`} onClose={()=>setRemove(null)}><p>Son texte et ses réglages seront retirés de cette annonce.</p><div className="commercial-dialog-actions"><button type="button" data-autofocus onClick={()=>setRemove(null)}>Annuler</button><button type="button" className="commercial-danger" onClick={deleteSequence}>Supprimer la séquence</button></div></CommercialDialog>:null}
  </section>;
}
