import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parsePDFSchedule,PDF_SCANNED_MESSAGE,PDF_SCHEDULE_LIMITS} from '../src/studio/day-planner-pdf';
import type {PDFSchedulePage} from '../src/studio/day-planner-pdf';
import {describeProgramme} from '../src/studio/day-planner-import';
import {planSchema} from '../src/studio/day-planner-model';
import {sampleConductor,cells,header,text} from './fixtures/conducteur-pdf';

const filename='CONDUCTEUR DU LUNDI 28 SEPTEMBRE 2026.pdf';
test('positioned PDF text uses reading order, follows continuation pages and keeps exact source references',()=>{
 const pages=sampleConductor();for(const page of pages)page.items.reverse();
 const [sheet]=parsePDFSchedule(pages,filename,2026);
 assert.equal(sheet.rows.length,8);assert.equal(sheet.date,'2026-09-28');
 assert.deepEqual(sheet.rows.map(row=>row.time),['06:00:00','12:55:00','13:00:00','19:55:00','21:00:00','23:30:00','00:00:00','05:00:00']);
 assert.equal(sheet.rows[0].title,'FITFORME');assert.equal(sheet.rows[0].subtitle,'N°41');assert.equal(sheet.rows[0].duration,1800);
 assert.equal(sheet.rows[4].raw,'SERIE : LEGACY ★ ep.180-181');assert.equal(sheet.rows[4].subtitle,'ep.180-181');
 assert.equal(sheet.rows[6].time,'00:00:00');assert.equal(sheet.rows[6].broadcastDate,'2026-09-28');assert.equal(sheet.rows[6].airDate,'2026-09-29');
 assert.equal(sheet.rows[7].time,'05:00:00');assert.equal(sheet.rows[7].airDate,'2026-09-29');assert.equal(sheet.rows[7].cell,'p.2 · l.5');
 assert.equal(new Set(sheet.rows.map(row=>row.id)).size,8);assert.ok(sheet.warnings.some(w=>w.includes('repère')));
 assert.ok(planSchema.safeParse({kind:'plan',name:'PDF local',source:filename,sourceHash:'a'.repeat(64),rows:sheet.rows}).success);
});
test('a filename date wins over stale hidden headings and always exposes the conflict for confirmation',()=>{
 const [sheet]=parsePDFSchedule(sampleConductor(),filename,2026);
 assert.equal(sheet.date,'2026-09-28');assert.ok(sheet.warnings.some(w=>w.includes('2026-08-31')&&w.includes('2026-09-28')));
 const pages=sampleConductor();pages[0].items=pages[0].items.filter(item=>item.y>100);
 const [missing]=parsePDFSchedule(pages,'conducteur.pdf',2027);assert.equal(missing.date,'2027-01-01');assert.ok(missing.warnings.some(w=>w.includes('Date absente')));
 const [year]=parsePDFSchedule(pages,'conducteur 28 septembre.pdf',2027);assert.equal(year.date,'2027-09-28');assert.ok(year.warnings.some(w=>w.includes('Année 2027')));
});
test('PDF programmes use the same production classifier as Excel, including recurring editions',()=>{
 const [sheet]=parsePDFSchedule(sampleConductor(),filename,2026);
 for(const row of sheet.rows){const described=describeProgramme(row.raw);assert.equal(row.included,described.included);assert.deepEqual(row.kinds,[...described.kinds]);assert.equal(row.title,described.title);assert.equal(row.subtitle,described.subtitle);}
 assert.equal(sheet.rows[1].included,false);
 for(const i of [2,3,5]){assert.equal(sheet.rows[i].included,true);assert.deepEqual(sheet.rows[i].kinds,[]);}
});
test('midnight crosses month and year boundaries without inventing a day from an out-of-order morning row',()=>{
 const pages:PDFSchedulePage[]=[{number:1,width:842,height:595,items:[...header,...cells('23:30:00','SOIREE','00:30:00',210),...cells('00:00:00','NUIT','01:00:00',230),...cells('03:00:00','FIN','01:00:00',250),...cells('02:00:00','ORDRE A VERIFIER','01:00:00',270)]}];
 const [sheet]=parsePDFSchedule(pages,'conducteur 31 decembre 2026.pdf',2026);
 assert.deepEqual(sheet.rows.map(row=>row.airDate),['2026-12-31','2027-01-01','2027-01-01','2027-01-01']);assert.ok(sheet.rows[3].issues.some(w=>w.includes('en recul')));
});
test('wrapped titles, fragmented text and overlapping duplicates retain their text and omit observations',()=>{
 const pages:PDFSchedulePage[]=[{number:1,width:842,height:595,items:[...header,...cells('06:00:00','DOCUMENTAIRE : LONG','01:00:00',210),text('TITRE SUR DEUX LIGNES',113,224,160),text('URGENT',650,210,40),...cells('07:00:00','SERIE : ','00:30:00',246),text('LEGACY ep.180',157,245.64,110),text('LEGACY ep.180',157,245.64,110)]}];
 const [sheet]=parsePDFSchedule(pages,filename,2026);assert.equal(sheet.rows.length,2);assert.equal(sheet.rows[0].raw,'DOCUMENTAIRE : LONG TITRE SUR DEUX LIGNES');assert.equal(sheet.rows[1].title,'LEGACY');assert.equal(sheet.rows[1].subtitle,'ep.180');assert.ok(sheet.rows.every(row=>!row.raw.includes('URGENT')));
});
test('missing or invalid time and duration are explicit review issues, not inferred values',()=>{
 const pages:PDFSchedulePage[]=[{number:1,width:842,height:595,items:[...header,...cells('06:00:00','DEBUT','00:30:00',210),...cells('','SANS HEURE','00:30:00',250),...cells('25:05:00','HEURE INVALIDE','incorrect',290)]}];
 const [sheet]=parsePDFSchedule(pages,filename,2026);assert.equal(sheet.rows.length,3);assert.equal(sheet.rows[1].time,'');assert.equal(sheet.rows[2].time,'');assert.equal(sheet.rows[2].duration,null);assert.ok(sheet.rows[1].issues.some(w=>w.includes('absent')));assert.ok(sheet.rows[2].issues.some(w=>w.includes('Durée')));
});
test('programme titles are not mistaken for footer notes, and title-only first rows remain reviewable',()=>{
 const pages:PDFSchedulePage[]=[{number:1,width:842,height:595,items:[...header,text('SANS HEURE NI DUREE',113,210,200),...cells('06:30:00','SOUS LE SOLEIL','00:30:00',250),...cells('07:00:00','VALIDATION DES ACQUIS','00:30:00',290)]}];
 const [sheet]=parsePDFSchedule(pages,filename,2026);assert.equal(sheet.rows.length,3);assert.equal(sheet.rows[0].time,'');assert.ok(sheet.rows[0].issues.some(w=>w.includes('Horaire absent')));assert.equal(sheet.rows[1].title,'SOUS LE SOLEIL');assert.equal(sheet.rows[2].title,'VALIDATION DES ACQUIS');
});
test('observation columns stay out of programme copy even when the conductor has no duration column',()=>{
 const pages:PDFSchedulePage[]=[{number:1,width:842,height:595,items:[...header.filter(item=>item.text!=='DUREE'),...cells('06:00:00','LE PROGRAMME','',210),text('APPELER LA REGIE',650,210,120)]}];
 const [sheet]=parsePDFSchedule(pages,filename,2026);assert.equal(sheet.rows.length,1);assert.equal(sheet.rows[0].raw,'LE PROGRAMME');assert.equal(sheet.rows[0].duration,null);
});
test('scanned, unrecognized and oversized conductors fail with actionable messages',()=>{
 assert.throws(()=>parsePDFSchedule([{number:1,width:800,height:600,items:[]}],filename,2026),{message:PDF_SCANNED_MESSAGE});
 assert.throws(()=>parsePDFSchedule([{number:1,width:800,height:600,items:[text('Simple lettre',100,100)]}],filename,2026),/Aucun conducteur reconnu/);
 assert.throws(()=>parsePDFSchedule(Array.from({length:PDF_SCHEDULE_LIMITS.pages+1},()=>sampleConductor()[0]),filename,2026),/30 pages/);
 assert.throws(()=>parsePDFSchedule(sampleConductor(),filename,NaN),/année/);
 const pages=sampleConductor();pages.push({number:3,width:842,height:595,items:[]});assert.ok(parsePDFSchedule(pages,filename,2026)[0].warnings.some(w=>w.includes('Page 3 sans texte')));
});
test('repeated headers do not create fake programmes or reset the midnight offset',()=>{
 const pages=sampleConductor();pages[1].items=pages[1].items.map(item=>({...item,y:item.y+200}));pages[1].items.push(...header);
 const [sheet]=parsePDFSchedule(pages,filename,2026);assert.equal(sheet.rows.length,8);assert.equal(sheet.rows.at(-1)!.airDate,'2026-09-29');
});
test('the supplied real PDF yields all 38 visually checked rows without modifying its bytes',{skip:!process.env.SRTB_PLANNER_PDF_FIXTURE},async()=>{
 const path=process.env.SRTB_PLANNER_PDF_FIXTURE!,original=readFileSync(path),hash=createHash('sha256').update(original).digest('hex');
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const loading=getDocument({data:new Uint8Array(original),disableFontFace:true,useSystemFonts:false,useWorkerFetch:false,useWasm:false,stopAtErrors:true});
 try{
  const document=await loading.promise,pages:PDFSchedulePage[]=[];assert.equal(document.numPages,2);
  for(let number=1;number<=document.numPages;number++){
   const page=await document.getPage(number),viewport=page.getViewport({scale:1}),content=await page.getTextContent();
   pages.push({number,width:viewport.width,height:viewport.height,items:content.items.filter(item=>'str' in item).map(item=>{const [x,y]=viewport.convertToViewportPoint(item.transform[4],item.transform[5]);return {text:item.str,x,y,width:item.width,height:item.height};})});
  }
  const [sheet]=parsePDFSchedule(pages,filename,2026);assert.equal(sheet.rows.length,38);assert.equal(sheet.rows.filter(row=>row.included).length,34);assert.equal(sheet.rows.filter(row=>row.included&&!row.kinds.length).length,5);assert.equal(sheet.rows.filter(row=>row.airDate==='2026-09-29').length,6);
  assert.deepEqual(sheet.rows.map(row=>row.time),['06:00:00','06:30:00','07:00:00','09:00:00','09:30:00','10:00:00','11:00:00','11:30:00','12:30:00','12:55:00','13:00:00','13:30:00','13:35:00','14:00:00','14:30:00','15:00:00','16:00:00','17:00:00','18:00:00','18:25:00','18:50:00','19:15:00','19:25:00','19:55:00','20:00:00','20:30:00','20:35:00','21:00:00','22:00:00','22:30:00','23:25:00','23:30:00','00:00:00','02:00:00','03:00:00','04:00:00','04:30:00','05:00:00']);
  assert.equal(sheet.rows[5].raw,'SERIE : SECONDE CHANCE ★ep.92');assert.equal(sheet.rows[13].subtitle,'N°32');assert.equal(sheet.rows[27].subtitle,'ep.180-181');assert.equal(sheet.rows[32].title,'BONJOUR LE BENIN');assert.equal(sheet.rows[32].duration,7200);assert.equal(sheet.rows[37].subtitle,'ep.118-119');
  assert.ok(sheet.rows.every(row=>row.duration!==null&&row.media===null));assert.ok(sheet.warnings.some(w=>w.includes('2026-08-31')));
  assert.ok(planSchema.safeParse({kind:'plan',name:'Conducteur réel',source:filename,sourceHash:hash,rows:sheet.rows}).success);
 }finally{await loading.destroy();}
 assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'),hash);
});
