import {useMemo,useState} from 'react';
import {ArrowRight,CalendarDays,Check,ImagePlus,Link2,TriangleAlert,Users} from 'lucide-react';
import type {Plan} from './day-planner-model';
import {proposeWeeklySchedule} from './day-planner-assistant';
import {plannerWeekly,weeklyProposalStart} from './planner-weekly';
import {connectedLocal} from './local-media';
import {plannerMediaLabels,plannerMediaState} from './planner-resume';
import NewProjectDialog from './NewProjectDialog';
import './planner-weekly-proposal.css';

const weekdayLabel=new Intl.DateTimeFormat('fr-FR',{weekday:'long',timeZone:'UTC'});
const dateLabel=new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'short',timeZone:'UTC'});
const periodLabel=new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});

export default function PlannerWeeklyProposalDialog({plan,onApply,onClose}:{plan:Plan;onApply:(selection:{startDate:string;rowIds:string[]})=>void;onClose:()=>void}){
  const [startDate,setStartDate]=useState(()=>weeklyProposalStart(plan));
  const {proposal,error}=useMemo(()=>{
    if(!startDate)return {proposal:null,error:''};
    try{return {proposal:proposeWeeklySchedule(plan.rows,startDate),error:''};}
    catch(cause){return {proposal:null,error:cause instanceof Error?cause.message:String(cause)};}
  },[plan.rows,startDate]);
  const rows=new Map(plan.rows.map(row=>[row.id,row]));
  const count=proposal?.rowIds.length??0,hasSelection=plannerWeekly(plan).rowIds.length>0;
  function apply(){if(!proposal||!count)return;onApply({startDate:proposal.startDate,rowIds:proposal.rowIds});onClose();}

  return <NewProjectDialog labelledBy="planner-week-proposal-title" busy={false} onClose={onClose}>
    <div className="planner-week-proposal-dialog">
      <header><p className="eyebrow">À faire / Semainier</p><h2 id="planner-week-proposal-title">Proposer une semaine</h2><p>Un programme par date réelle de diffusion.</p></header>
      <div className="planner-week-period-picker">
        <label htmlFor="planner-week-first-day">Premier jour<input id="planner-week-first-day" type="date" max="9999-12-25" data-dialog-autofocus value={startDate} aria-invalid={!!error} aria-describedby={error?'planner-week-period-error':'planner-week-period-hint'} onChange={event=>setStartDate(event.target.value)}/></label>
        <p id="planner-week-period-hint"><CalendarDays size={20} aria-hidden="true"/><span>{proposal?<><strong>7 jours consécutifs</strong><span>Jusqu’au {periodLabel.format(new Date(proposal.endDate+'T12:00:00Z'))}</span></>:<span>Choisissez le début de la période.</span>}</span></p>
      </div>
      {error?<p className="planner-week-proposal-error" id="planner-week-period-error" role="alert"><TriangleAlert size={17} aria-hidden="true"/>{error}</p>:null}
      {proposal?<>
        <div className="planner-week-proposal-heading"><span>Proposition à relire</span><strong role="status" aria-live="polite">{count}/7 {count===1?'programme':'programmes'}</strong></div>
        <ol className="planner-week-proposal-days" aria-label="Les sept jours proposés">{proposal.days.map(day=>{
          const row=day.rowId?rows.get(day.rowId):undefined,date=new Date(day.date+'T12:00:00Z');
          const mediaState=row?plannerMediaState(row.media,connectedLocal):null;
          return <li key={day.date} className={row?'':'is-empty'}>
            <time dateTime={day.date}><strong>{weekdayLabel.format(date)}</strong><span>{dateLabel.format(date)}</span></time>
            {row?<div className="planner-week-proposal-programme"><strong>{row.title}</strong><span><span className="planner-week-proposal-time">{row.time.slice(0,5)||'Heure à préciser'}</span><span className="planner-week-proposal-media">{mediaState==='local'?<Check size={13} aria-hidden="true"/>:mediaState==='shared'?<Users size={13} aria-hidden="true"/>:mediaState==='reconnect'?<Link2 size={13} aria-hidden="true"/>:<ImagePlus size={13} aria-hidden="true"/>}{plannerMediaLabels[mediaState!]}</span></span></div>:<div className="planner-week-proposal-programme"><strong>À choisir</strong><span>Aucun programme proposé pour ce jour.</span></div>}
          </li>;
        })}</ol>
        {count<7?<p className="planner-week-proposal-help" role="status">{count?'Vous pourrez compléter les jours manquants dans « Le semainier ».':'Aucun programme à proposer sur cette période. Choisissez un autre premier jour ou composez votre sélection manuellement.'}</p>:null}
      </>:!error?<div className="planner-week-proposal-empty"><CalendarDays size={26} strokeWidth={1.5} aria-hidden="true"/><p>Les sept journées apparaîtront ici.</p></div>:null}
      <p className={`planner-week-proposal-scope${hasSelection?' will-replace':''}`}>{hasSelection?<><strong>La sélection actuelle sera remplacée.</strong> Les formats, la voix et les projets déjà créés sont conservés.</>:<>Vous pourrez ajuster les programmes et leur ordre après confirmation. Aucun projet n’est créé ici.</>}</p>
      <footer className="planner-week-proposal-actions"><button type="button" onClick={onClose}>Revenir sans modifier</button><button type="button" className="primary" disabled={!proposal||!count} onClick={apply}>Utiliser la proposition<ArrowRight size={17} aria-hidden="true"/></button></footer>
    </div>
  </NewProjectDialog>;
}
