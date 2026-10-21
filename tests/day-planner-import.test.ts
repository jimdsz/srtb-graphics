import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {utils,write} from 'xlsx';
import {parseSchedule,scheduleTime,describeProgramme} from '../src/studio/day-planner-import';
import {recommendedSheets} from '../src/studio/day-planner-recommendations';
import {planSchema,plannerFormats,plannerKinds} from '../src/studio/day-planner-model';
import {plannerProject} from '../src/studio/day-planner-project';
import {proposeWeek} from '../src/studio/day-planner-assistant';
import {isMediaField,isSequenceField} from '../src/studio/domain';
function workbook(rows:unknown[][],name='LUNDI 07 SEPT 2026'){const wb=utils.book_new();utils.book_append_sheet(wb,utils.aoa_to_sheet(rows),name);return write(wb,{type:'array',bookType:'xlsx'}) as ArrayBuffer;}
test('parses duration, episodes, exclusions and midnight without executing a formula',()=>{
 const sheets=parseSchedule(workbook([['PROGRAMME DU LUNDI 07 SEPTEMBRE 2026'],['HORAIRE','DESCRIPTION','DUREE'],[23/24,'MAGAZINE : FITFORME N°31',.5/24],[.5/24,'PAGE PUBLICITAIRE',.1/24],[1/24,'Journal',.5/24]]),'grille.xlsx',2026);
 assert.equal(sheets[0].rows[0].title,'FITFORME');assert.equal(sheets[0].rows[0].subtitle,'N°31');assert.equal(sheets[0].rows[0].duration,1800);assert.equal(sheets[0].rows[1].airDate,'2026-09-08');assert.equal(sheets[0].rows[1].included,false);assert.equal(sheets[0].rows[2].included,true);assert.deepEqual(sheets[0].rows[2].kinds,[]);
});
test('does not invent missing hours and rejects malformed or oversized input',()=>{
 const [sheet]=parseSchedule(workbook([['Horaire','Description'],['','Titre sans horaire']]),'test.xlsx',2026);assert.equal(sheet.rows[0].time,'');assert.ok(sheet.rows[0].issues.length);assert.throws(()=>parseSchedule(new ArrayBuffer(11*1024**2),'x.xlsx',2026));assert.throws(()=>parseSchedule(new ArrayBuffer(4),'x.xlsx',2026));assert.equal(scheduleTime('24:01'),null);assert.equal(scheduleTime('07H30')?.time,'07:30:00');assert.equal(describeProgramme('BANDES ANNONCES').included,false);
});
test('sheet suggestions never crash or invent dates from malformed filenames',()=>{
 const sheets=parseSchedule(workbook([['Horaire','Description'],['06H00','FITFORME']]),'modele.xlsx',2026);
 assert.deepEqual(recommendedSheets(sheets,'V2-GRILLE-BTV-07 AU 13 SEPTEMBRE 2026 + CONDUCTEURS.xlsx'),['LUNDI 07 SEPT 2026']);
 for(const name of ['90 AU 96 SEPTEMBRE 2026.xlsx','29 AU 35 SEPTEMBRE 2026.xlsx','07 AU 13 S 2026.xlsx','07 AU 13 JUI 2026.xlsx','31 AOUT AU 06 SEPTEMBRE 2026.xlsx','archives.xlsx'])assert.deepEqual(recommendedSheets(sheets,name),[]);
});
test('qualifies the supplied real workbook without uploading or modifying it',{skip:!process.env.SRTB_PLANNER_FIXTURE},()=>{
 const path=process.env.SRTB_PLANNER_FIXTURE!;
 const b=readFileSync(path),sheets=parseSchedule(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),path.split(/[\\/]/).at(-1)!,2026);
 assert.equal(sheets.length,29);const monday=sheets.find(s=>s.name.startsWith('LUNDI 07 SEPT'))!;assert.equal(monday.date,'2026-09-07');assert.equal(monday.rows.length,36);assert.equal(monday.rows[0].time,'06:00:00');assert.equal(monday.rows[0].title,'FITFORME');assert.equal(monday.rows[0].subtitle,'N°31');assert.ok(monday.rows.every(r=>r.time));
 assert.ok(sheets.find(s=>s.name==='GRILLE BTV-07 AU 13 SEPT 2026')!.rows.some(r=>!r.time));assert.equal(sheets.find(s=>s.name==='ALERTES PRODUCTION')!.rows.length,0);
});
test('proposes clean editorial copy without losing continuity notes or hiding ambiguous source labels',()=>{
 for(const raw of ['REDIFFUSION MAGAZINE : FOI CHRETIENNE N°5','MAGAZINE : REDIF FOI CHRETIENNE N°5','MAGAZINE : FOI CHRETIENNE N°5 (REDIF)','MAGAZINE : FOI CHRETIENNE N°5 REDIF']){
  const d=describeProgramme(raw);assert.equal(d.title,'FOI CHRETIENNE');assert.equal(d.subtitle,'N°5');assert.ok(d.issues.some(v=>v.includes('rediffusion')));
 }
 for(const ending of ['PAGE PUBLICITAIRE','METEO','MÉTÉO','PAGE PUB','JINGLE','BANDES ANNONCES']){
  const raw=`MAGAZINE : LE BENIN QUE J'AIME N°8 / DELPHIN KOKO + ${ending}`;
  const [sheet]=parseSchedule(workbook([['Horaire','Description'],['12H50',raw]]),'grille.xlsx',2026),row=sheet.rows[0];
  assert.equal(row.title,"LE BENIN QUE J'AIME");assert.equal(row.subtitle,'N°8 · DELPHIN KOKO');assert.equal(row.raw,raw);assert.equal(row.cell,'B2');assert.ok(row.issues.some(v=>v.includes(ending)));assert.equal(row.included,true);
 }
 for(const raw of ['REDIFFSUION MAGAZINE : SUCCÈS EN DIRECT','REDIFFSUSION DOCUMENTAIRE : LE BONHEUR','PAGE']){const d=describeProgramme(raw);assert.equal(d.title,raw);assert.ok(d.issues.some(v=>v.includes('ambigu')));}
 for(const raw of ['A + B','La météo des cultures','MAGAZINE : PLUS + MOINS','FILM : LA PAGE BLANCHE','MAG : TITRE / MUSIQUE + DANSE'])assert.equal(describeProgramme(raw).issues.length,0);
 assert.equal(describeProgramme('PAGE PUBLICITAIRE + METEO').included,false);
});
test('real seven-day import produces every template/format with reviewed copy, dates and no sample media',{skip:!process.env.SRTB_PLANNER_FIXTURE},()=>{
 const path=process.env.SRTB_PLANNER_FIXTURE!,bytes=readFileSync(path),digest=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex'),hash=digest(bytes),filename=path.split(/[\\/]/).at(-1)!;
 const sheets=parseSchedule(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),filename,2026),names=recommendedSheets(sheets,filename);
 const rows=sheets.filter(s=>names.includes(s.name)).flatMap(s=>s.rows),plan=planSchema.parse({kind:'plan',name:'Vérification locale',source:filename,sourceHash:hash,rows});
 assert.equal(names.length,7);assert.equal(rows.length,273);assert.equal(rows.filter(r=>r.included).length,256);
 assert.equal(rows.filter(r=>r.included&&!r.kinds.length).length,32,'26 journals/bulletins and 6 standalone weather slots stay visible with no new graphic by default');
 assert.equal(rows.reduce((count,row)=>count+(row.included?row.kinds.length:0),0),448);
 // These are explicit cells from the supplied workbook, not parser-derived expectations.
 const tuesday=rows.find(r=>r.sheet==='MARDI 08 SEPT 2026'&&r.cell==='B17')!;
 assert.equal(tuesday.title,'LE TRONE');assert.equal(tuesday.subtitle,'N°20');assert.equal(tuesday.time,'09:00:00');
 const mixed=rows.find(r=>r.sheet==='DIMANCHE 13 SEPT 2026'&&r.cell==='B22')!;
 assert.equal(mixed.title,"LE BENIN QUE J'AIME");assert.equal(mixed.subtitle,'N°8 · DELPHIN KOKO');assert.ok(mixed.raw.endsWith('+ PAGE PUBLICITAIRE'));
 const midnight=rows.find(r=>r.sheet==='LUNDI 07 SEPT '&&r.cell==='B40')!;
 assert.equal(midnight.airDate,'2026-09-08');assert.equal(midnight.time,'00:00:00');
 const mondayDraft=plannerProject(plan,{kind:'ba',format:'tv',rowIds:[midnight.id]});assert.equal(mondayDraft.data._jour_1,'mardi');assert.equal(mondayDraft.data._heure_1,'00h00');
 let count=0;
 for(const row of rows.filter(r=>r.included))for(const kind of plannerKinds)for(const format of plannerFormats){
  const draft=plannerProject(plan,{kind,format,rowIds:[row.id]}),data=draft.data;
  assert.equal(data._studio_format,format);
  const title=kind==='ba'||kind==='tds'?[data._titre_ligne_1,data._titre_ligne_2,data._titre_ligne_3].filter(Boolean).join(' '):kind==='popup'?String(data._title).replace(/\s+/g,' '):kind==='renvoi'?[data.title,data.title2].filter(Boolean).join(' '):[data.title_1,data.title_2].filter(Boolean).join(' ');
  assert.equal(title,row.title,`${row.id} ${kind} ${format}: title retained`);
  for(const [key,field] of Object.entries(draft.template.fields)){
   if(isMediaField(key,field))assert.equal(data[key],'',`${row.id} ${kind}: no sample media`);
   if(isSequenceField(key,field))assert.equal(data[key],'[]');
   if(/_audio.*_enabled$/.test(key))assert.equal(data[key],false);
  }
  count++;
 }
 assert.equal(count,3840,'every kind/format remains explicitly available, including for recurrent programmes');
 const selection=proposeWeek(rows);assert.equal(selection.length,7);
 for(const format of plannerFormats){const draft=plannerProject(plan,{kind:'weekly',format,rowIds:selection});selection.forEach((id,i)=>{const row=rows.find(r=>r.id===id)!;assert.equal(draft.data[`programme_${i+1}_title`],row.title);assert.ok(String(draft.data[`programme_${i+1}_category`]).endsWith(row.time.slice(0,5).replace(':','h').toUpperCase()));assert.equal(draft.data[`_media_programme_${i+1}_url`],'');});}
 assert.equal(digest(readFileSync(path)),hash,'Workbook stays byte-identical');
});
