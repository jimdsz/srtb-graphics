import {read,utils} from 'xlsx';
import type {CellObject,WorkSheet} from 'xlsx';
import {unzipSync} from 'fflate';
import {addDays,dateSchema,normalized} from './day-planner-model';
import type {PlannerRow} from './day-planner-model';
import {recurringProgramme} from './day-planner-recurrence';

export type ScheduleSheet={name:string;layout:'rundown'|'week'|'unknown';date:string;warnings:string[];rows:PlannerRow[]};
const months=['janvier','fevrier','mars','avril','mai','juin','juillet','aout','septembre','octobre','novembre','decembre'];
const monthNumber=(s:string)=>months.findIndex(m=>m.startsWith(s.slice(0,4)))+1;
const iso=(year:number,month:number,day:number)=>`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
function dateFrom(s:string,year:number):string{
  const n=normalized(s);let m=n.match(/\b(\d{1,2})\s+(?:au\s+\d{1,2}\s+)?([a-z]+)\s*(20\d{2})?\b/);
  if(!m||!monthNumber(m[2]))return '';
  const result=iso(Number(m[3]||year),monthNumber(m[2]),Number(m[1]));return dateSchema.safeParse(result).success?result:'';
}
export function scheduleTime(value:unknown):{time:string;seconds:number;day:number}|null{
  if(typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<8){const total=Math.round(value*86400),seconds=total%86400;return {time:[Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(n=>String(n).padStart(2,'0')).join(':'),seconds,day:Math.floor(total/86400)};}
  if(typeof value!=='string')return null;
  const m=value.trim().match(/^(\d{1,2})\s*[:hH]\s*(\d{2})(?:\s*:\s*(\d{2}))?$/);
  if(!m||Number(m[1])>23||Number(m[2])>59||Number(m[3]||0)>59)return null;
  return {time:`${m[1].padStart(2,'0')}:${m[2]}:${m[3]||'00'}`,seconds:Number(m[1])*3600+Number(m[2])*60+Number(m[3]||0),day:0};
}
export function describeProgramme(raw:string){
  const n=normalized(raw),excluded=/^(?:page pub|page publicitaire|bandes? annonces?|pub\b|jingle\b|fin des programmes)/.test(n);
  const recurring=recurringProgramme(raw);
  const issues:string[]=[];
  let clean=raw.replace(/\s+/g,' ').trim(),repeatRemoved=false;
  const stripRepeat=(text:string)=>text.replace(/^(?:rediffusion|rediff|redif)\s+/i,()=>{repeatRemoved=true;return '';});
  clean=stripRepeat(clean);
  const prefix=clean.match(/^(MAGAZINE|MAG|DOCUMENTAIRE|DOC|SERIE|SÉRIE|JEU|DIVERTISSEMENT|SPORT|CINÉMA|CINEMA|FILM)\s*:\s*/i);
  const category=prefix?({mag:'Magazine',doc:'Documentaire',serie:'Série'}[normalized(prefix[1])]||prefix[1]):recurring?.kind==='news'?'Information':recurring?.kind==='weather'?'Météo':'Programme';
  if(prefix)clean=stripRepeat(clean.slice(prefix[0].length));
  clean=clean.replace(/[★®]/g,'').replace(/\(\s*(?:rediffusion|rediff|redif)\s*\)/ig,()=>{repeatRemoved=true;return '';}).trim();
  // Only standalone, explicitly delimited continuity instructions are removed
  // from proposed on-screen copy. Keep the original cell on the row for review.
  // Do not split arbitrary '+' titles, correct typos or infer missing programmes.
  const segments=clean.split(/\s+\+\s+/),technical=/^(?:page pub(?:licitaire)?|pub(?:licite)?|meteo|bandes? annonces?|jingle)$/;
  const removed=segments.slice(1).filter(part=>technical.test(normalized(part)));
  if(removed.length){clean=[segments[0],...segments.slice(1).filter(part=>!technical.test(normalized(part)))].join(' + ');issues.push('Mention de conduite retirée du texte proposé : '+removed.join(' + ').slice(0,160)+'.');}
  clean=clean.replace(/\s+(?:rediffusion|rediff|redif)$/i,()=>{repeatRemoved=true;return '';}).replace(/\s+/g,' ').trim();
  if(repeatRemoved)issues.push('Mention de rediffusion retirée du texte proposé. La cellule source est conservée.');
  if(/^redif\w*\b/i.test(clean)||/^page$/i.test(clean))issues.push('Libellé de conduite ambigu : vérifiez le titre et les habillages à préparer.');
  const parts=clean.split(/\s*\/\s*/);let title=parts.shift()||clean,subtitle=parts.join(' / ');
  const episode=title.match(/\s+((?:N[°ºo]\s*|eps?\.?\s*)\d+.*)$/i);
  if(episode){title=title.slice(0,episode.index).trim();subtitle=[episode[1],subtitle].filter(Boolean).join(' · ');}
  if(title.length>200||subtitle.length>400)issues.push('Texte source trop long : vérifiez la proposition abrégée avant de créer les habillages.');
  if(recurring)issues.push(recurring.reason);
  return {title:title.slice(0,200)||'Programme à préciser',subtitle:subtitle.slice(0,400),category,included:!excluded,kinds:excluded||recurring?[]:['ba','popup'] as const,issues};
}
function entry(raw:string,sheet:string,cell:string,date:string,time:ReturnType<typeof scheduleTime>,duration:number|null,issues:string[]):PlannerRow{
  const d=describeProgramme(raw);return {id:sheet+'!'+cell,sheet,cell,raw:raw.slice(0,2000),broadcastDate:date,airDate:time?addDays(date,time.day):date,time:time?.time??'',duration,...d,kinds:[...d.kinds],formats:['tv'],issues:[...issues,...d.issues],media:null,location:null};
}
const value=(s:WorkSheet,r:number,c:number)=>s[utils.encode_cell({r,c})] as CellObject|undefined;
const string=(v:unknown)=>v==null?'':String(v);
export function parseSchedule(buffer:ArrayBuffer,filename:string,referenceYear:number):ScheduleSheet[]{
  if(buffer.byteLength>10*1024**2)throw Error('Le classeur dépasse 10 Mo. Exportez uniquement les onglets utiles au format XLSX.');
  if(new Uint8Array(buffer)[0]!==0x50||new Uint8Array(buffer)[1]!==0x4b)throw Error('Choisissez un classeur .xlsx non chiffré. Les macros et les anciens .xls ne sont pas acceptés.');
  let expanded=0,count=0;
  unzipSync(new Uint8Array(buffer),{filter:file=>{expanded+=file.originalSize;count++;if(expanded>64*1024**2||count>2000)throw Error('Classeur trop complexe. Conservez uniquement les feuilles utiles.');return false;}});
  const wb=read(buffer,{type:'array',cellFormula:true,cellHTML:false,cellNF:false,cellStyles:false,bookVBA:false,sheetRows:5000,cellDates:false});
  if(wb.SheetNames.length>80)throw Error('Limite de 80 feuilles par import.');
  const year=Number(filename.match(/\b(20\d{2})\b/)?.[1]||referenceYear);
  if(year<2000||year>2100)throw Error('Précisez une année entre 2000 et 2100.');
  return wb.SheetNames.map(name=>{
    const s=wb.Sheets[name],range=utils.decode_range(s['!ref']||'A1');
    const result:ScheduleSheet={name,layout:'unknown',date:'',warnings:[],rows:[]};
    if(range.e.r>=4999||range.e.c>100){result.warnings.push('Feuille trop grande pour cet import (5 000 lignes, 100 colonnes).');return result;}
    const heading=Array.from({length:Math.min(10,range.e.r+1)},(_,r)=>string(value(s,r,0)?.v)).join(' ');
    result.date=dateFrom(heading,year)||dateFrom(name,year);
    if(!/20\d{2}/.test(name+' '+heading)&&result.date)result.warnings.push(`Année ${year} reprise du fichier ou du choix d’import : à confirmer.`);
    const headerRow=Array.from({length:Math.min(30,range.e.r+1)},(_,r)=>r).find(r=>normalized(string(value(s,r,0)?.v))==='horaire');
    if(headerRow===undefined)return result;
    const headers=Array.from({length:Math.min(range.e.c+1,101)},(_,c)=>normalized(string(value(s,headerRow,c)?.v)));
    const titleCol=headers.findIndex(h=>/^(description|programme|emission|titre)$/.test(h)),durationCol=headers.findIndex(h=>h==='duree');
    const datesFound=Array.from({length:range.e.c+1},(_,c)=>c).filter(c=>/^(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/.test(headers[c]||''));
    if(titleCol<0&&datesFound.length!==7)return result;
    result.layout=titleCol>=0?'rundown':'week';
    if(!result.date){result.warnings.push('Date absente ou non reconnue. Renseignez le premier jour avant import.');result.date=iso(year,1,1);}
    const columns=titleCol>=0?[titleCol]:datesFound;
    for(const [day,column]of columns.entries()){
      let previous=-1,rollover=0;const date=addDays(result.date,day);
      for(let r=headerRow+1;r<=range.e.r;r++){
        const raw=string(value(s,r,column)?.v).trim();if(!raw||/^(NB\s*:|RESPECTEZ|SOU[ST]|VALIDATION)/i.test(raw))continue;
        const tc=value(s,r,0),clock=scheduleTime(tc?.v),issues:string[]=[];
        if(!clock)issues.push(tc?.f?'Horaire calculé sans valeur enregistrée. Ouvrez et enregistrez le fichier dans Excel.':'Horaire absent : à renseigner. Aucune heure n’est déduite de la hauteur de cellule.');
        if(clock){if(clock.seconds<previous&&clock.day===0)rollover++;clock.day=Math.max(clock.day,rollover);previous=clock.seconds;}
        if(clock&&clock.day>1)issues.push('Plusieurs passages après minuit : vérifier la date.');
        const duration=durationCol>=0?scheduleTime(value(s,r,durationCol)?.v):null;
        const row=entry(raw,name,utils.encode_cell({r,c:column}),date,clock,duration?duration.day*86400+duration.seconds:null,issues);
        if(!clock&&!/\S/.test(raw))continue;
        result.rows.push(row);
      }
    }
    if(result.rows.length>600)throw Error(`« ${name} » dépasse 600 programmes. Séparez les journées.`);
    return result;
  });
}
