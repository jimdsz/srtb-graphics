import type {IndexedMedia} from './day-planner-model';

type Evidence={dates:string[];uncertain:boolean};
const months=['janvier','fevrier','mars','avril','mai','juin','juillet','aout','septembre','octobre','novembre','decembre'];
const cache=new WeakMap<IndexedMedia,{path:string;evidence:Evidence}>();
const display=(iso:string)=>iso.split('-').reverse().join('/');

/** Filename hints only, never recording metadata or proof of an episode's identity.
 * All path components count: conflicting dates require an editorial choice. */
function inspect(path:string):Evidence{
 const value=path.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const dates=new Set<string>();let uncertain=false;
 function add(year:number,month:number,day:number){
  const iso=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  const date=new Date(iso+'T12:00:00Z');
  if(year<1900||year>2199||!Number.isFinite(+date)||date.toISOString().slice(0,10)!==iso)uncertain=true;
  else dates.add(iso);
 }
 // Keep matched spans out of subsequent patterns (an ISO date is not also D/M/Y).
 const spans:Array<[number,number]>=[];
 function collect(pattern:RegExp,read:(m:RegExpMatchArray)=>void){
  for(const m of value.matchAll(pattern)){
   const start=m.index!,end=start+m[0].length;
   if(spans.some(([a,b])=>start<b&&end>a))continue;
   spans.push([start,end]);read(m);
  }
 }
 collect(/(?<![a-z0-9])(19\d{2}|20\d{2}|21\d{2})[-_. /]+(\d{1,2})[-_. /]+(\d{1,2})(?![a-z0-9])/g,m=>add(+m[1],+m[2],+m[3]));
 collect(/(?<![a-z0-9])(\d{1,2})[-_. /]+(\d{1,2})[-_. /]+(19\d{2}|20\d{2}|21\d{2})(?![a-z0-9])/g,m=>add(+m[3],+m[2],+m[1]));
 collect(/(?<![a-z0-9])(19\d{2}|20\d{2}|21\d{2})(\d{2})(\d{2})(?![a-z0-9])/g,m=>add(+m[1],+m[2],+m[3]));
 collect(new RegExp(`(?<![a-z0-9])(\\d{1,2})(?:er)?[-_. /]+(${months.join('|')})[-_. /]+(19\\d{2}|20\\d{2}|21\\d{2})(?![a-z0-9])`,'g'),m=>add(+m[3],months.indexOf(m[2])+1,+m[1]));
 // Do not infer a century, year, or range endpoint from abbreviated labels.
 collect(/(?<![a-z0-9])\d{1,2}[-_. /]+\d{1,2}[-_. /]+\d{2}(?![a-z0-9])/g,()=>{uncertain=true;});
 if(/\d{1,2}\s*(?:au|a|–|—)\s*\d{1,2}/.test(value))uncertain=true;
 return {dates:[...dates].sort(),uncertain};
}

export function mediaDateHint(file:IndexedMedia,airDate:string){
 let saved=cache.get(file);
 if(!saved||saved.path!==file.path){saved={path:file.path,evidence:inspect(file.path)};cache.set(file,saved);}
 const {dates,uncertain}=saved.evidence;
 if(uncertain||dates.length>1)return {status:'uncertain' as const,manual:true,reason:'Date du nom ambiguë ou incomplète · choix manuel'};
 if(!dates.length)return {status:'unknown' as const,manual:false,reason:''};
 if(dates[0]!==airDate)return {status:'different' as const,manual:true,reason:`Date du nom : ${display(dates[0])} · diffusion : ${display(airDate)} · à vérifier`};
 return {status:'matching' as const,manual:false,reason:`Date du nom : ${display(airDate)} · même jour que la diffusion`};
}
