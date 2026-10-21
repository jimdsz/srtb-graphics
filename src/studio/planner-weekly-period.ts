import {addDays,dateSchema} from './day-planner-model';
import type {PlannerRow} from './day-planner-model';

/** Keep the imported week's anchor stable when an airing is moved across midnight. */
export function defaultWeeklyStart(rows:readonly PlannerRow[]):string{
  return rows.filter(row=>row.included&&dateSchema.safeParse(row.broadcastDate).success&&row.broadcastDate<='9999-12-25')
    .map(row=>row.broadcastDate).sort()[0]??'';
}
export function weeklyPeriod(startDate:string):string[]{
  if(!dateSchema.safeParse(startDate).success||startDate>'9999-12-25')throw Error('Choisissez une date de début valide pour les sept jours du semainier.');
  return Array.from({length:7},(_,i)=>addDays(startDate,i));
}
