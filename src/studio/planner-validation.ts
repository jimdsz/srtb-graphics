import {planSchema,timeSchema} from './day-planner-model';
import type {Plan,PlannerRow} from './day-planner-model';

export class PlannerPreparationError extends Error {
  constructor(message:string,readonly field:string,readonly rowId?:string){super(message);this.name='PlannerPreparationError';}
}

const hints:Record<string,string>={
  name:'Donnez un nom à la préparation (120 caractères maximum).',
  title:'Renseignez le titre du programme (200 caractères maximum).',
  subtitle:'Limitez le sous-titre à 400 caractères.',
  category:'Limitez le type de programme à 80 caractères.',
  airDate:'Renseignez une date réelle de diffusion valide.',
  time:'Renseignez une heure de diffusion valide avant de préparer cet habillage.',
  formats:'Choisissez au moins un format : TV, portrait ou vertical.',
  media:'Vérifiez le média associé à ce programme.',
  logo:'Vérifiez le logo associé : une image PNG, JPEG ou WebP.',
  excerpt:'Vérifiez le début et la fin du passage : il doit tenir dans le média choisi.',
};
function problem(plan:Plan,field:string,index?:number):never{
  const row=index===undefined?undefined:plan.rows[index];
  const identity=row?`${row.title.trim()||`Programme · ${row.cell}`} (${row.broadcastDate}) — `:'';
  throw new PlannerPreparationError(identity+(hints[field]||'Vérifiez les réglages de cette préparation avant de continuer.'),field,row?.id);
}

/** Validate the complete saved document, then only the requested air times.
 * Incomplete hours may stay in a preparation, but cannot create a wrong graphic.
 * Never coerce a date, invent a format or silently discard a user's field. */
export function checkedPlannerPreparation(plan:Plan,requiredRowIds:readonly string[]=[]):Plan{
  if(!plan.name.trim())problem(plan,'name');
  const result=planSchema.safeParse(plan);
  if(!result.success){
    const issue=result.error.issues[0],path=issue.path;
    const index=path[0]==='rows'&&typeof path[1]==='number'?path[1]:undefined;
    const field=String(index===undefined?path[0]||'plan':path[2]||'excerpt');
    problem(plan,field,index);
  }
  const required=new Set(requiredRowIds);
  for(const [i,row] of plan.rows.entries()){
    if(!row.title.trim())problem(plan,'title',i);
    if(required.has(row.id)&&!timeSchema.safeParse(row.time).success)problem(plan,'time',i);
  }
  return result.data;
}

export const plannerRowOrder=(a:PlannerRow,b:PlannerRow)=>a.airDate.localeCompare(b.airDate)||(a.time||'99').localeCompare(b.time||'99');
/** Locate a hidden invalid row without altering either the document or selection. */
export function plannerProblemLocation(plan:Plan,error:PlannerPreparationError){
  const row=plan.rows.find(row=>row.id===error.rowId);if(!row)return null;
  const rows=plan.rows.filter(item=>item.broadcastDate===row.broadcastDate&&(!row.included||item.included)).sort(plannerRowOrder);
  return {day:row.broadcastDate,page:Math.floor(rows.findIndex(item=>item.id===row.id)/20),excluded:!row.included};
}
