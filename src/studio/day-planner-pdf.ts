import {describeProgramme,scheduleTime} from './day-planner-import';
import type {ScheduleSheet} from './day-planner-import';
import {addDays,dateSchema,normalized} from './day-planner-model';
import type {PlannerRow} from './day-planner-model';

export type PDFScheduleText={text:string;x:number;y:number;width:number;height:number};
export type PDFSchedulePage={number:number;width:number;height:number;items:PDFScheduleText[]};
type Line={y:number;height:number;items:PDFScheduleText[]};
type Columns={timeEnd:number;durationStart:number;observationStart:number;width:number};
const months=['janvier','fevrier','mars','avril','mai','juin','juillet','aout','septembre','octobre','novembre','decembre'];
export const PDF_SCHEDULE_LIMITS={bytes:10*1024**2,pages:30,items:100000,characters:1000000,rows:600};
export const PDF_SCANNED_MESSAGE='Ce PDF ne contient pas de texte exploitable : il semble numérisé. Exportez le conducteur en PDF avec texte sélectionnable ou importez son fichier XLSX.';
const unrecognized='Aucun conducteur reconnu dans ce PDF. Il faut des colonnes « Horaire » et « Description » avec du texte sélectionnable. Pour une grille de semaine, importez le XLSX.';

function datesIn(text:string,year:number){
 const found:{date:string;explicitYear:boolean}[]=[];
 for(const match of normalized(text).matchAll(/\b(\d{1,2})\s+([a-z]+)\s*(20\d{2})?/g)){
  const month=months.indexOf(match[2])+1;if(!month)continue;
  const date=`${match[3]||year}-${String(month).padStart(2,'0')}-${match[1].padStart(2,'0')}`;
  if(dateSchema.safeParse(date).success)found.push({date,explicitYear:!!match[3]});
 }
 return found;
}
function textOf(items:PDFScheduleText[]){
 // PDF drawing order is often column-by-column, so rebuild reading order from
 // coordinates. Exact overlapping text duplicates must not duplicate programme copy.
 const ordered=[...items].sort((a,b)=>a.x-b.x),parts:string[]=[];let previous:PDFScheduleText|undefined;
 for(const item of ordered){
  if(previous&&item.text===previous.text&&Math.abs(item.x-previous.x)<1&&Math.abs(item.y-previous.y)<1)continue;
  const join=previous&&item.x-(previous.x+previous.width)<Math.max(1,Math.min(item.height,previous.height)*.12)&&!parts.at(-1)?.endsWith(' ')&&!item.text.startsWith(' ');
  if(join)parts[parts.length-1]+=item.text;else parts.push(item.text);
  previous=item;
 }
 return parts.join(' ').replace(/\s+/g,' ').trim();
}
function pageLines(page:PDFSchedulePage):Line[]{
 const items=page.items.filter(item=>item.text.trim()&&[item.x,item.y,item.width,item.height].every(Number.isFinite)).sort((a,b)=>a.y-b.y||a.x-b.x),lines:Line[]=[];
 for(const item of items){
  const previous=lines.at(-1),tolerance=Math.max(1.5,Math.min(3.5,item.height*.24));
  if(previous&&Math.abs(previous.y-item.y)<=tolerance){previous.items.push(item);previous.height=Math.max(previous.height,item.height);}
  else lines.push({y:item.y,height:item.height,items:[item]});
 }
 return lines;
}
function detectColumns(line:Line,lines:Line[],page:PDFSchedulePage):Columns|null{
 const time=line.items.find(item=>normalized(item.text)==='horaire'),description=line.items.find(item=>/^(description|programme|emission|titre)$/.test(normalized(item.text)));
 if(!time||!description||time.x>=description.x)return null;
 const duration=line.items.find(item=>normalized(item.text)==='duree'),observation=line.items.find(item=>/^observations?$/.test(normalized(item.text)));
 const clocks=lines.filter(other=>other.y>line.y).flatMap(other=>other.items).filter(item=>scheduleTime(item.text));
 const firstClock=clocks.filter(item=>item.x<description.x).sort((a,b)=>a.x-b.x)[0];
 const timeClocks=firstClock?clocks.filter(item=>Math.abs(item.x-firstClock.x)<8):[];
 const timeEnd=Math.max(time.x+time.width,...timeClocks.map(item=>item.x+item.width))+1;
 const durationClocks=duration?clocks.filter(item=>Math.abs(item.x-duration.x)<Math.max(35,duration.width)):[];
 const durationStart=duration?Math.min(duration.x,...durationClocks.map(item=>item.x))-5:page.width;
 return {timeEnd,durationStart,observationStart:observation?observation.x-8:page.width,width:page.width};
}

/** A bounded, deterministic parser for selectable-text daily conductors only. */
export function parsePDFSchedule(pages:PDFSchedulePage[],filename:string,referenceYear:number):ScheduleSheet[]{
 if(!Number.isInteger(referenceYear)||referenceYear<2000||referenceYear>2100)throw Error('Précisez une année entre 2000 et 2100.');
 if(!pages.length||pages.every(page=>!page.items.some(item=>item.text.trim())))throw Error(PDF_SCANNED_MESSAGE);
 if(pages.length>PDF_SCHEDULE_LIMITS.pages||pages.reduce((n,page)=>n+page.items.length,0)>PDF_SCHEDULE_LIMITS.items||pages.reduce((n,page)=>n+page.items.reduce((sum,item)=>sum+item.text.length,0),0)>PDF_SCHEDULE_LIMITS.characters)throw Error('PDF trop complexe. Exportez uniquement les journées utiles (30 pages maximum).');
 const prepared=pages.map(page=>({page,lines:pageLines(page)}));
 const firstHeader=prepared.flatMap(({page,lines})=>lines.map(line=>({page,line,columns:detectColumns(line,lines,page)}))).find(item=>item.columns);
 if(!firstHeader)throw Error(unrecognized);
 const headings=prepared.flatMap(({page,lines})=>lines.filter(line=>line.y<(page.number===firstHeader.page.number?firstHeader.line.y:page.height*.16)).map(line=>textOf(line.items)));
 const filenameDates=datesIn(filename,referenceYear),headingDates=headings.flatMap(heading=>datesIn(heading,referenceYear));
 const distinct=[...new Set([...filenameDates,...headingDates].map(item=>item.date))];
 const chosen=filenameDates[0]||headingDates[0],date=chosen?.date||`${referenceYear}-01-01`;
 const warnings=['Lecture du texte du PDF : vérifiez les titres, les horaires et la date avant de préparer la liste.'];
 if(!chosen)warnings.push('Date absente ou non reconnue. Renseignez la date du conducteur avant import.');
 else if(!chosen.explicitYear)warnings.push(`Année ${referenceYear} reprise du choix d’import : à confirmer.`);
 if(distinct.length>1)warnings.push(`Plusieurs dates dans le nom ou le texte du PDF (${distinct.join(', ')}). Date proposée${filenameDates.length?' d’après le nom du fichier':''} : ${date}. Vérifiez le titre visible du document.`);
 const name=`Conducteur PDF · ${date}`,sheet:ScheduleSheet={name,layout:'rundown',date,warnings,rows:[]};
 let columns:Columns|null=null,previous=-1,rollover=0,blankMarkers=0;
 for(const {page,lines} of prepared){
  let previousRow:PlannerRow|undefined,previousY=-Infinity,sourceRow=0;
  for(const line of lines){
   const detected=detectColumns(line,lines,page);if(detected){columns=detected;previousRow=undefined;continue;}
   if(!columns)continue;
   const active=columns,scale=page.width/active.width;
   const clockText=textOf(line.items.filter(item=>item.x<active.timeEnd*scale));
   const raw=textOf(line.items.filter(item=>item.x>=active.timeEnd*scale&&item.x<Math.min(active.durationStart,active.observationStart)*scale));
   const durationText=textOf(line.items.filter(item=>item.x>=active.durationStart*scale&&item.x<active.observationStart*scale));
   const clock=scheduleTime(clockText),duration=scheduleTime(durationText);
   if(!clock&&!duration&&/^(?:nb\s*:|respectez strictement\b|sous?\s*[:\-]|validation\s*[:\-]|programme du\b|benin tv\b)/i.test(raw.normalize('NFD').replace(/[\u0300-\u036f]/g,'')))continue;
   if(!raw){if(clock)blankMarkers++;previousRow=undefined;continue;}
   if(!clockText&&!durationText&&previousRow&&line.y-previousY<=Math.max(18,line.height*1.6)){
    const combined=`${previousRow.raw} ${raw}`.replace(/\s+/g,' ').trim(),description=describeProgramme(combined);
    const oldIssues=describeProgramme(previousRow.raw).issues;
    Object.assign(previousRow,{...description,kinds:[...description.kinds],raw:combined.slice(0,2000),issues:[...new Set([...previousRow.issues.filter(issue=>!oldIssues.includes(issue)),...description.issues,'Texte réparti sur plusieurs lignes dans le PDF : vérifiez le titre et l’horaire.'])]});
    previousY=line.y;continue;
   }
   // A continuation page without repeated headers uses the established columns.
   // Keep title-only rows as missing-time proposals, including the first one.
   const issues:string[]=[];
   if(!clock)issues.push(clockText?`Horaire « ${clockText.slice(0,80)} » non reconnu : à renseigner.`:'Horaire absent : à renseigner. Aucune heure n’est déduite de la position du texte.');
   if(durationText&&!duration)issues.push('Durée du programme non reconnue : vérifiez la source PDF.');
   if(clock){
    if(clock.seconds<previous){
     if(previous>=12*3600&&clock.seconds<12*3600)rollover++;
     else issues.push('Horaire en recul : vérifiez l’ordre des lignes et la date de diffusion.');
    }
    previous=clock.seconds;
   }
   if(rollover>1)issues.push('Plusieurs passages après minuit : vérifier la date.');
   const description=describeProgramme(raw);sourceRow++;
   const cell=`p.${page.number} · l.${sourceRow}`;
   const row:PlannerRow={id:`pdf!p${page.number}r${sourceRow}`,sheet:name,cell,raw:raw.slice(0,2000),broadcastDate:date,airDate:addDays(date,rollover),time:clock?.time||'',duration:duration?.seconds??null,...description,kinds:[...description.kinds],formats:['tv'],issues:[...issues,...description.issues],media:null,location:null};
   sheet.rows.push(row);previousRow=row;previousY=line.y;
   if(sheet.rows.length>PDF_SCHEDULE_LIMITS.rows)throw Error('Ce conducteur dépasse 600 programmes. Séparez les journées.');
  }
 }
 if(!sheet.rows.length)throw Error(unrecognized);
 const emptyPages=pages.filter(page=>!page.items.some(item=>item.text.trim()));
 if(emptyPages.length)warnings.push(`Page${emptyPages.length>1?'s':''} ${emptyPages.map(page=>page.number).join(', ')} sans texte exploitable : vérifiez qu’aucun programme numérisé ne manque.`);
 if(blankMarkers)warnings.push(`${blankMarkers} repère${blankMarkers>1?'s':''} horaire${blankMarkers>1?'s':''} sans description ignoré${blankMarkers>1?'s':''}.`);
 return [sheet];
}
