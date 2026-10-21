import {useState} from 'react';
import {Check,Scissors,RotateCcw} from 'lucide-react';
import {plannerExcerptSchema} from './day-planner-model';
import type {PlannerRow,PlannerExcerpt} from './day-planner-model';
import MediaTrim from './MediaTrim';
import NewProjectDialog from './NewProjectDialog';
import {timeLabel} from './media-trim';
import {plannerProgrammeLabel} from './planner-programme-label';

export default function PlannerExcerptDialog({row,onClose,onSelect}:{row:PlannerRow;onClose:()=>void;onSelect:(excerpt:PlannerExcerpt|null)=>void}){
  const [range,setRange]=useState({start:row.excerpt?.start??0,end:row.excerpt?.end??0}),[duration,setDuration]=useState<number|null>(null);
  if(!row.media)return null;
  const parsed=plannerExcerptSchema.safeParse({source:row.media.url,...range,end:range.end===0?Math.floor((duration??0)*25)/25:range.end,duration});
  return <NewProjectDialog labelledBy="planner-excerpt-title" busy={false} onClose={onClose}>
    <div className="planner-media-heading"><Scissors size={26} aria-hidden="true"/><div><p className="eyebrow">{plannerProgrammeLabel(row)}</p><h2 id="planner-excerpt-title">Choisir le passage</h2></div></div>
    <p className="planner-media-caption">{row.media.name}</p>
    <MediaTrim value={row.media} module="/graphics" start={Number.isFinite(range.start)?range.start:0} end={Number.isFinite(range.end)?range.end:0} onChange={setRange} onDuration={setDuration} initiallyOpen/>
    <div className="planner-excerpt-points"><label>Début (secondes)<input type="number" min="0" step="0.04" max={duration??86400} value={Number.isFinite(range.start)?range.start:''} onChange={e=>setRange(r=>({...r,start:e.target.valueAsNumber}))}/></label><label>Fin (secondes)<input type="number" min="0" step="0.04" max={duration??86400} value={Number.isFinite(range.end)?range.end:''} onChange={e=>setRange(r=>({...r,end:e.target.valueAsNumber}))}/><small>0 = fin du fichier</small></label></div>
    {duration&&!parsed.success?<p role="alert" className="notice warning">Choisissez une fin après le début, dans les {timeLabel(duration)} du fichier.</p>:null}
    <p className="small muted">Ce passage sera repris dans les nouveaux habillages de ce programme. Chaque modèle garde sa durée d’animation ; la dernière image reste affichée si le passage est plus court. Les projets déjà créés restent inchangés.</p>
    <div className="planner-dialog-footer"><button onClick={onClose}>Annuler</button>{row.excerpt?<button onClick={()=>onSelect(null)}><RotateCcw size={16} aria-hidden="true"/>Repartir du début du fichier</button>:null}<button className="primary" disabled={!duration||!parsed.success} onClick={()=>{if(parsed.success)onSelect(parsed.data);}}><Check size={16} aria-hidden="true"/>Utiliser ce passage</button></div>
  </NewProjectDialog>;
}
