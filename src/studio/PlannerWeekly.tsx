import {ArrowDown,ArrowRight,ArrowUp,CalendarDays,Check,ChevronDown,ImagePlus,Link2,Mic2,Monitor,Scissors,Smartphone,TriangleAlert,Users,X} from 'lucide-react';
import type {Plan,PlannerTask,PlannerWeekly as WeeklySettings} from './day-planner-model';
import {plannerFormats} from './day-planner-model';
import {moveWeeklyProgramme,plannerWeekly,weeklySelectionReview} from './planner-weekly';
import {connectedLocal} from './local-media';
import {plannerMediaLabels,plannerMediaState} from './planner-resume';
import {plannerVoiceDescription} from './planner-voice-ui';
import {plannerProgrammeLabel,plannerProgrammeSchedule} from './planner-programme-label';
import {timeLabel} from './media-trim';
import {plannerTaskReview} from './planner-task-review';
import './planner-weekly-proposal.css';

const labels={tv:'TV · 16:9',portrait:'Portrait · 4:5',vertical:'Vertical · 9:16'};
const periodLabel=new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
export default function PlannerWeekly({plan,tasks,sourceRevision,hasUnsavedChanges=false,onChange,onCreate,onOpen,onVoice,onPropose,onMedia,onExcerpt}:{plan:Plan;tasks:PlannerTask[];sourceRevision?:number;hasUnsavedChanges?:boolean;onChange:(patch:Partial<WeeklySettings>)=>void;onCreate:()=>void;onOpen:(projectId:string)=>void;onVoice:()=>void;onPropose:()=>void;onMedia:(rowId:string)=>void;onExcerpt:(rowId:string)=>void}){
  const weekly=plannerWeekly(plan),rows=new Map(plan.rows.map(row=>[row.id,row])),count=weekly.rowIds.length;
  const voice=plannerVoiceDescription('weekly',weekly.voice);
  const review=weeklySelectionReview(plan),missing=review.missingDates.length,duplicates=review.duplicateDates.length,outside=review.outsideRowIds.length;
  const reviewNotes=[...(missing?[`${missing} jour${missing>1?'s':''} sans programme`]:[]),...(duplicates?[`${duplicates} date${duplicates>1?'s':''} répétée${duplicates>1?'s':''}`]:[]),...(outside?[`${outside} programme${outside>1?'s':''} hors période`]:[])];
  return <details className="planner-weekly" open={count>0}>
    <summary><CalendarDays size={23} aria-hidden="true"/><span><strong>Le semainier</strong><small>Choisissez l’ordre et les formats</small></span><span className="planner-weekly-count">{count}/7</span><ChevronDown size={18} aria-hidden="true"/></summary>
    <div className="planner-weekly-content">
      <div className="planner-weekly-period"><div><small>Période de référence · 7 jours</small><strong>{review.startDate&&review.endDate?`${periodLabel.format(new Date(review.startDate+'T12:00:00Z'))} — ${periodLabel.format(new Date(review.endDate+'T12:00:00Z'))}`:'Choisissez le premier jour de votre semaine.'}</strong></div><button type="button" onClick={onPropose}><CalendarDays size={17} aria-hidden="true"/>{count?'Reproposer une semaine':'Proposer une semaine'}</button></div>
      <ol aria-label="Programmes du semainier">{weekly.rowIds.map((id,i)=>{const row=rows.get(id);if(!row)return null;const mediaState=plannerMediaState(row.media,connectedLocal),label=plannerProgrammeLabel(row),reconnect=mediaState==='reconnect';return <li key={id}>
        <span className="planner-weekly-number">{i+1}</span>
        <div className="planner-weekly-copy"><strong>{row.title}</strong><small>{plannerProgrammeSchedule(row)}</small>{row.subtitle?<small>{row.subtitle}</small>:null}<small>{mediaState==='local'?<Check size={13} aria-hidden="true"/>:mediaState==='shared'?<Users size={13} aria-hidden="true"/>:reconnect?<Link2 size={13} aria-hidden="true"/>:<ImagePlus size={13} aria-hidden="true"/>}{plannerMediaLabels[mediaState]}</small>{row.media?<small className="planner-weekly-source">{row.media.name}{row.excerpt?<span>{timeLabel(row.excerpt.start)} → {timeLabel(row.excerpt.end)}</span>:null}</small>:null}</div>
        <div className="planner-weekly-media-actions" role="group" aria-label={`Média de ${label}`}>
          <button type="button" aria-label={`${reconnect?'Reconnecter le média':row.media?'Vérifier le média':'Choisir le média'} · ${label}`} onClick={()=>onMedia(id)}>{reconnect?<Link2 size={16} aria-hidden="true"/>:<ImagePlus size={16} aria-hidden="true"/>}{reconnect?'Reconnecter':row.media?'Vérifier le média':'Choisir le média'}</button>
          {row.media?.mimeType.startsWith('video/')&&!reconnect?<button type="button" aria-label={`Choisir le passage · ${label}`} onClick={()=>onExcerpt(id)}><Scissors size={16} aria-hidden="true"/>{row.excerpt?'Ajuster le passage':'Choisir le passage'}</button>:null}
        </div>
        <div className="planner-weekly-order" role="group" aria-label={`Position de ${label}`}>
          <button type="button" aria-label={`Monter ${label}`} title="Monter" disabled={i===0} onClick={()=>onChange({rowIds:moveWeeklyProgramme(weekly.rowIds,id,-1)})}><ArrowUp size={17} aria-hidden="true"/></button>
          <button type="button" aria-label={`Descendre ${label}`} title="Descendre" disabled={i===count-1} onClick={()=>onChange({rowIds:moveWeeklyProgramme(weekly.rowIds,id,1)})}><ArrowDown size={17} aria-hidden="true"/></button>
          <button type="button" aria-label={`Retirer ${label} du semainier`} title="Retirer du semainier" onClick={()=>onChange({rowIds:weekly.rowIds.filter(value=>value!==id)})}><X size={17} aria-hidden="true"/></button>
        </div>
      </li>;})}</ol>
      {!count?<p className="muted">Cochez « Inclure dans le semainier » sur sept programmes.</p>:null}
      {count&&reviewNotes.length?<p className="planner-weekly-review" role="status"><TriangleAlert size={17} aria-hidden="true"/><span><strong>À relire :</strong> {reviewNotes.join(' · ')}.<small>Ces choix manuels sont autorisés.</small></span></p>:null}
      <div className="planner-weekly-voice"><button type="button" className={`planner-voice-choice${voice.error?' needs-review':weekly.voice?' is-confirmed':''}`} onClick={onVoice} title={voice.error||weekly.voice?.source.name}><span><strong>Voix du semainier · {voice.label}</strong><small>{voice.detail}</small></span>{voice.error?<TriangleAlert size={17} aria-hidden="true"/>:weekly.voice?<Check size={17} aria-hidden="true"/>:<Mic2 size={17} aria-hidden="true"/>}</button><p className="small muted">Une annonce « Cette semaine », indépendante des voix des sept programmes, pour les nouveaux formats du semainier.</p></div>
      <div className="planner-weekly-actions">
        <fieldset className="planner-weekly-formats"><legend>Formats à préparer</legend>{plannerFormats.map(format=><label className="check" key={format}>
          <input type="checkbox" checked={weekly.formats.includes(format)} disabled={weekly.formats.length===1&&weekly.formats.includes(format)} onChange={event=>onChange({formats:event.target.checked?[...weekly.formats,format]:weekly.formats.filter(value=>value!==format)})}/>
          {format==='tv'?<Monitor size={16} aria-hidden="true"/>:<Smartphone size={16} aria-hidden="true"/>}{labels[format]}
        </label>)}</fieldset>
        <button type="button" className="primary" disabled={count!==7} onClick={onCreate}>{weekly.formats.length===1?'Préparer le semainier':`Préparer les ${weekly.formats.length} semainiers`}<ArrowRight size={17} aria-hidden="true"/></button>
      </div>
      <p className="small muted">L’ordre et les formats sont conservés avec la préparation d’équipe. Les projets déjà créés restent inchangés.</p>
      {tasks.filter(task=>task.key.startsWith('weekly:')).map(task=><button className="planner-weekly-linked" key={task.key} onClick={()=>onOpen(task.projectId)}><span><strong>{task.title}</strong><small>{task.archived?'Archivé · ':''}{plannerTaskReview(task,sourceRevision,hasUnsavedChanges)}</small></span><ArrowRight size={14} aria-hidden="true"/></button>)}
    </div>
  </details>;
}
