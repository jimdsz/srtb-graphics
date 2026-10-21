import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaProposals,proposeWeek,proposeWeeklySchedule} from '../src/studio/day-planner-assistant';
import {programmeIdentity} from '../src/studio/day-planner-model';
import type {PlannerRow,PlannerRecord,DirectoryIndex,ProgrammeRule} from '../src/studio/day-planner-model';
const row=(patch:Partial<PlannerRow>={}):PlannerRow=>({id:'a',sheet:'LUNDI',cell:'A1',raw:'',title:'Bonjour le Bénin',subtitle:'',category:'Magazine',broadcastDate:'2026-09-07',airDate:'2026-09-07',time:'06:30:00',duration:1800,included:true,kinds:['ba','popup'],formats:['tv'],issues:[],media:null,location:null,...patch});
function record<T extends DirectoryIndex|ProgrammeRule>(data:T):PlannerRecord<T>{return {id:'11111111-1111-4111-8111-111111111111',revision:1,data,createdBy:'a',updatedBy:'a',updatedAt:'2026-09-24T00:00:00Z',archived:false};}
function directory(...names:string[]){return record<DirectoryIndex>({kind:'directory',name:'Émissions',partial:false,scannedAt:'2026-09-24T00:00:00Z',files:names.map(name=>({name,path:name,size:100,modified:1}))});}
test('a distinct filename is offered but never assigned; ambiguous takes and wrong episodes remain manual',()=>{
 const r=row(),before=structuredClone(r);
 assert.equal(mediaProposals([r],directory('Bonjour le Bénin.mp4'),[])[0].suggested,'Bonjour le Bénin.mp4');
 assert.deepEqual(r,before);
 assert.equal(mediaProposals([r],directory('Bonjour le Bénin V1.mp4','Bonjour le Bénin V2.mp4'),[])[0].suggested,'');
 assert.equal(mediaProposals([row({subtitle:'Épisode 31'})],directory('Bonjour le Bénin 30.mp4'),[])[0].suggested,'');
 assert.equal(mediaProposals([r],directory('Autre émission.mp4'),[])[0].matches.length,0);
 assert.equal(mediaProposals([row({included:false}),row({media:{url:'local-media:'+'a'.repeat(64)+':100',name:'ok.mp4',mimeType:'video/mp4'}})],directory('Bonjour le Bénin.mp4'),[]).length,0);
});
test('team association is limited to the programme, episode and indexed directory',()=>{
 const r=row({subtitle:'Épisode 31'}),d=directory('programme-validé.mp4');
 const rule=record<ProgrammeRule>({kind:'rule',name:r.title,programme:programmeIdentity(r),keywords:r.title,directoryId:d.id,preferredPath:'programme-validé.mp4',kinds:['ba']});
 assert.equal(mediaProposals([r],d,[rule])[0].suggested,'programme-validé.mp4');
 assert.equal(mediaProposals([row({subtitle:'Épisode 32'})],d,[rule])[0].suggested,'');
 assert.equal(mediaProposals([r],{...d,id:'another'},[rule])[0].suggested,'');
});

test('a remembered previous-day file does not override the current air date',()=>{
 const r=row(),old='Bonjour le Bénin 06-09-2026.mp4',today='Bonjour le Bénin 07-09-2026.mp4';
 const d=directory(old,today);
 const rule=record<ProgrammeRule>({kind:'rule',name:r.title,programme:programmeIdentity(r),keywords:r.title,directoryId:d.id,preferredPath:old,kinds:['ba']});
 const p=mediaProposals([r],d,[rule])[0];
 assert.equal(p.suggested,today);assert.equal(p.matches.length,2);
 assert.match(p.matches.find(m=>m.file.path===old)!.reason,/06\/09\/2026.*07\/09\/2026.*vérifier/);
 assert.equal(mediaProposals([r],directory(old),[rule])[0].suggested,'');
});

test('batch date hints retain ambiguous versions, abbreviated dates and repeat choices for manual selection',()=>{
 for(const names of [['Bonjour le Bénin 07-09-26.mp4'],['Bonjour le Bénin 07-09-2026 V1.mp4','Bonjour le Bénin 07-09-2026 V2.mp4'],['2026-09-06/Bonjour le Bénin 2026-09-07.mp4']]){
  const p=mediaProposals([row()],directory(...names),[])[0];assert.equal(p.suggested,'');assert.equal(p.matches.length,names.length);
 }
 assert.equal(mediaProposals([row()],directory('Autre programme 07-09-2026.mp4'),[])[0].matches.length,0);
 // The broadcast sheet can contain an after-midnight programme on the next air date.
 assert.equal(mediaProposals([row({airDate:'2026-09-08',time:'01:00:00'})],directory('Bonjour le Bénin 07-09-2026.mp4','Bonjour le Bénin 08-09-2026.mp4'),[])[0].suggested,'Bonjour le Bénin 08-09-2026.mp4');
});

test('a programme name in a graphics resource does not make it an automatic programme media',()=>{
 // Names observed in the authorized Y: pilot (metadata only, no media copied).
 const names=['BLB-01.png','FOND BLB.png','GEN FIN BLB.png','INTRO BLB 10 09 2026.mp4',"L’Invité.mp4",'LOGO BUG BLB 2026.png','SYNTHE BONJOUR LE BENIN.png'];
 const p=mediaProposals([row()],directory(...names),[])[0];
 assert.equal(p.suggested,'');assert.equal(p.matches[0].file.name,'SYNTHE BONJOUR LE BENIN.png');
 assert.match(p.matches[0].reason,/Habillage ou image de séquence/);
 for(const name of ['INTRO Bonjour le Bénin 07-09-2026.mp4','LOGO Bonjour le Bénin.png','Générique Bonjour le Bénin.mp4'])assert.equal(mediaProposals([row()],directory(name),[])[0].suggested,'');
 // A deliberate team association may reuse an explicitly chosen title card.
 const d=directory('LOGO Bonjour le Bénin.png'),r=row();
 const rule=record<ProgrammeRule>({kind:'rule',name:r.title,programme:programmeIdentity(r),keywords:r.title,directoryId:d.id,preferredPath:d.data.files[0].path,kinds:['ba']});
 assert.equal(mediaProposals([r],d,[rule])[0].suggested,d.data.files[0].path);
});
test('weekly proposal selects seven distinct dates, prioritizes confirmed media, and leaves missing days missing',()=>{
 const rows=Array.from({length:7},(_,i)=>row({id:String(i),broadcastDate:`2026-09-${String(7+i).padStart(2,'0')}`,airDate:`2026-09-${String(7+i).padStart(2,'0')}`}));
 rows.push(row({id:'journal',title:'Journal',category:'Information',time:'20:00:00'}),row({id:'evening',time:'21:00:00'}),row({id:'excluded',included:false,time:'22:00:00'}));
 assert.deepEqual(proposeWeek(rows),['evening','1','2','3','4','5','6']);
 rows[0].media={url:'local-media:'+'a'.repeat(64)+':100',name:'programme.mp4',mimeType:'video/mp4'};
 assert.deepEqual(proposeWeek(rows),['0','1','2','3','4','5','6']);
 rows[6].included=false;assert.equal(proposeWeek(rows).length,6);
});

test('weekly proposal follows moved and after-midnight air dates, not source sheet dates',()=>{
 const rows=[row({id:'night',airDate:'2026-09-08',time:'00:30:00'}),row({id:'moved',broadcastDate:'2026-09-08',airDate:'2026-09-10'}),row({id:'previous',airDate:'2026-09-06'}),row({id:'eighth',airDate:'2026-09-14'})];
 const before=structuredClone(rows),result=proposeWeeklySchedule(rows,'2026-09-07');
 assert.deepEqual(result.days.map(day=>day.rowId),[null,'night',null,'moved',null,null,null]);
 assert.deepEqual(result.rowIds,['night','moved']);assert.equal(result.endDate,'2026-09-13');
 assert.deepEqual(proposeWeek(rows),result.rowIds);assert.deepEqual(rows,before);
 assert.deepEqual(proposeWeeklySchedule(rows,'2026-09-08').rowIds,['night','moved','eighth']);
});

test('weekly proposal crosses years and leap days and rejects invalid periods without inventing dates',()=>{
 for(const [start,end]of [['2026-12-29','2027-01-04'],['2028-02-27','2028-03-04'],['9999-12-25','9999-12-31']]){
  const result=proposeWeeklySchedule([],start);assert.equal(result.days.length,7);assert.equal(result.endDate,end);assert.deepEqual(result.rowIds,[]);
 }
 for(const bad of ['','2026-02-29','2026-9-7','2026-13-01','9999-12-26','not a date'])assert.throws(()=>proposeWeeklySchedule([],bad),/date de début valide/);
 assert.deepEqual(proposeWeek([]),[]);
});

test('weekly ranking is deterministic, validates times and keeps the existing editorial exclusions',()=>{
 const rows=[row({id:'z',time:'23:00'}),row({id:'a',time:'23:00:00'}),row({id:'morning'}),row({id:'blank',title:' '}),row({id:'invalid',time:'99:00:00'}),row({id:'empty',time:''}),row({id:'off',included:false}),row({id:'no-kind',kinds:[]}),row({id:'journal',title:'Journal',category:'Information'})];
 assert.deepEqual(proposeWeek(rows),['a']);assert.deepEqual(proposeWeek([...rows].reverse()),['a']);
 rows[2].media={url:'local-media:'+'a'.repeat(64)+':100',name:'programme.mp4',mimeType:'video/mp4'};
 assert.deepEqual(proposeWeek(rows),['morning']);
});

test('weekly suggestions distinguish daily news from other programme titles containing journal or information',()=>{
 for(const title of ['Journal de voyage','Le journal d’Anne Frank','La fabrique de l’information']){
  const programme=row({id:'documentary',raw:`DOCUMENTAIRE : ${title}`,title,category:'Documentaire',time:'21:00:00'});
  const daily=row({id:'daily',raw:'JOURNAL TÉLÉVISÉ DE 20H',title:'JOURNAL TÉLÉVISÉ DE 20H',category:'Programme',time:'20:00:00'});
  assert.deepEqual(proposeWeek([daily,programme]),['documentary']);
 }
});

test('reconnecting an assigned media offers its exact indexed location, never a newly ranked substitute',()=>{
 const d=directory('Bonjour le Bénin.mp4','Ancien fichier.mp4');
 const r=row({media:{url:'local-media:'+'a'.repeat(64)+':100',name:'Ancien fichier.mp4',mimeType:'video/mp4'},location:{directoryId:d.id,path:'Ancien fichier.mp4',size:100,modified:1}});
 assert.equal(mediaProposals([r],d,[],true)[0].suggested,'Ancien fichier.mp4');
 assert.equal(mediaProposals([r],{...d,id:'another'},[],true)[0].matches.length,0);
 assert.equal(mediaProposals([r],directory('Bonjour le Bénin.mp4'),[],true)[0].matches.length,0);
 assert.equal(mediaProposals([r],d,[]).length,0);
});

test('an incomplete single-folder index cannot offer a fuzzy batch preselection, even when learned',()=>{
 const d=directory('Bonjour le Bénin.mp4');d.data.partial=true;
 const r=row(),rule=record<ProgrammeRule>({kind:'rule',name:r.title,programme:programmeIdentity(r),keywords:r.title,directoryId:d.id,preferredPath:d.data.files[0].path,kinds:['ba']});
 for(const rules of [[],[rule]]){const proposal=mediaProposals([r],d,rules)[0];assert.equal(proposal.matches.length,1);assert.equal(proposal.suggested,'');}
 const saved=row({media:{url:'local-media:'+'a'.repeat(64)+':100',name:d.data.files[0].name,mimeType:'video/mp4'},location:{directoryId:d.id,path:d.data.files[0].path,size:100,modified:1}});
 assert.equal(mediaProposals([saved],d,[],true)[0].suggested,d.data.files[0].path);
});
