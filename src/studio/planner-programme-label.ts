import {dateSchema} from './day-planner-model';
import type {PlannerRow} from './day-planner-model';

const dayLabel=new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'short',timeZone:'UTC'});
/** Identify an occurrence, not just an emission: a week can repeat its title. */
export function plannerProgrammeSchedule(row:Pick<PlannerRow,'airDate'|'time'>){
  const day=dateSchema.safeParse(row.airDate).success?dayLabel.format(new Date(row.airDate+'T12:00:00Z')):'Date à préciser';
  return `${day} · ${row.time.slice(0,5)||'Heure à préciser'}`;
}
export function plannerProgrammeLabel(row:Pick<PlannerRow,'title'|'airDate'|'time'>){
  return `${row.title} · ${plannerProgrammeSchedule(row)}`;
}
