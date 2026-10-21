import {addDays,dateSchema,normalized} from './day-planner-model';
import type {ScheduleSheet} from './day-planner-import';
// Lightweight UI helper. Do not import the Excel reader into the interface thread.
export function recommendedSheets(sheets:ScheduleSheet[],filename:string){
 const text=normalized(filename),m=text.match(/\b(\d{1,2})\s+au\s+(\d{1,2})\s+([a-z]+)\s+(20\d{2})\b/);
 if(!m)return [];
 const months=['janvier','fevrier','mars','avril','mai','juin','juillet','aout','septembre','octobre','novembre','decembre'],matches=months.map((name,i)=>({name,month:i+1})).filter(v=>v.name.startsWith(m[3].slice(0,4)));
 if(m[3].length<3||matches.length!==1||Number(m[2])-Number(m[1])!==6)return [];
 const month=matches[0].month,start=`${m[4]}-${String(month).padStart(2,'0')}-${m[1].padStart(2,'0')}`,last=`${m[4]}-${String(month).padStart(2,'0')}-${m[2].padStart(2,'0')}`;
 if(!dateSchema.safeParse(start).success||!dateSchema.safeParse(last).success)return [];
 const end=addDays(start,6);
 const daily=sheets.filter(s=>s.layout==='rundown'&&s.date>=start&&s.date<=end&&s.rows.length);
 if(daily.length&&new Set(daily.map(s=>s.date)).size===daily.length)return daily.map(s=>s.name);
 const grids=sheets.filter(s=>s.layout==='week'&&s.date===start&&s.rows.length);return grids.length===1?[grids[0].name]:[];
}
