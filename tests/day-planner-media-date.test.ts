import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaDateHint} from '../src/studio/day-planner-media-date';
const file=(path:string)=>({path,name:path.split('/').at(-1)!,size:100,modified:Date.parse('2026-09-07')});

test('full filename dates and French dates are hints, including folders and leap days',()=>{
 for(const name of ['Bonjour le Bénin 07 09 2026.mp4','BLB 2026-09-07 V2.mp4','2026/09/07/BLB.mp4','BLB 20260907.mp4','BLB 7 septembre 2026.mp4','7 septembre 2026/BLB 07.09.2026.mp4']){
  assert.equal(mediaDateHint(file(name),'2026-09-07').status,'matching',name);
 }
 assert.equal(mediaDateHint(file('BLB 1er août 2026.mp4'),'2026-08-01').status,'matching');
 assert.equal(mediaDateHint(file('BLB 29-02-2024.mp4'),'2024-02-29').status,'matching');
});
test('wrong, invalid, conflicting and abbreviated dates require a manual choice',()=>{
 assert.equal(mediaDateHint(file('BLB 06-09-2026.mp4'),'2026-09-07').status,'different');
 for(const path of ['BLB 31-09-2026.mp4','BLB 29-02-2026.mp4','BLB 07-09-26.mp4','BLB 07 au 13 septembre 2026.mp4','2026-09-06/BLB 2026-09-07.mp4','BLB 2026-09-07 et 2026-09-08.mp4']){
  assert.equal(mediaDateHint(file(path),'2026-09-07').manual,true,path);
 }
});
test('versions, durations, metadata modification time and episode numbers are not broadcast dates',()=>{
 for(const path of ['BLB épisode 31 V2.mp4','BLB 2026.mp4','BLB 01h30.mp4','12320260907123.mp4','BLB S07E09.mp4'])assert.equal(mediaDateHint(file(path),'2026-09-07').status,'unknown',path);
});
test('cached filename evidence is compared with each air date and invalidated if the path changes',()=>{
 const f=file('BLB 2026-09-07.mp4');
 assert.equal(mediaDateHint(f,'2026-09-07').status,'matching');
 assert.equal(mediaDateHint(f,'2026-09-08').status,'different');
 f.path='BLB 2026-09-08.mp4';assert.equal(mediaDateHint(f,'2026-09-08').status,'matching');
});
