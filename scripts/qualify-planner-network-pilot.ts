/** Read-only qualification against an explicitly supplied directory and workbook.
 * Calls the production scanner with a metadata-only filesystem adapter. This is
 * not a substitute for a browser permission or another workstation's SMB test. */
import {strict as assert} from 'node:assert';
import {lstat,readdir,readFile,realpath} from 'node:fs/promises';
import {basename,join,relative,resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {scanFolder} from '../src/studio/day-planner-folders';
import type {DirectoryHandle} from '../src/studio/day-planner-folders';
import {parseSchedule} from '../src/studio/day-planner-import';
import {recommendedSheets} from '../src/studio/day-planner-recommendations';
import {mediaProposals} from '../src/studio/day-planner-assistant';
import {directorySchema,normalized} from '../src/studio/day-planner-model';

const [folder,workbook]=process.argv.slice(2);
assert.ok(folder&&workbook,'Usage: node --import tsx scripts/qualify-planner-network-pilot.ts <folder> <workbook.xlsx>');
const root=await realpath(resolve(folder));
let metadataReads=0,visitedDirectories=0,mediaContentReadAttempts=0;
async function confined(path:string){
 const resolved=await realpath(path),part=relative(root,resolved);
 assert.ok(part===''||!part.startsWith('..'+sep)&&part!=='..'&&!part.includes(':'),'Directory must remain inside the authorized root');
 return resolved;
}
function handle(path:string):DirectoryHandle{
 return {kind:'directory',name:basename(path),async *entries(){
  visitedDirectories++;
  for(const entry of await readdir(await confined(path),{withFileTypes:true})){
   // Never follow a junction/symlink, even within the chosen tree.
   const child=join(path,entry.name),info=await lstat(child);
   if(info.isSymbolicLink())continue;
   if(info.isDirectory()){yield [entry.name,handle(child)] as const;continue;}
   if(!info.isFile())continue;
   yield [entry.name,{kind:'file',name:entry.name,async getFile(){
    const current=await lstat(await confined(child));metadataReads++;
    return {name:entry.name,size:current.size,lastModified:Math.trunc(current.mtimeMs),
     arrayBuffer(){mediaContentReadAttempts++;throw Error('The index must not read media content');}};
   }}] as const;
  }
 }} as unknown as DirectoryHandle;
}
const started=performance.now(),index=await scanFolder(handle(root),new AbortController().signal,()=>{});
directorySchema.parse(index);assert.equal(mediaContentReadAttempts,0);
const scanMs=Math.round(performance.now()-started),input=await readFile(workbook);
const digest=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
const before=digest(input),sheets=parseSchedule(input.buffer.slice(input.byteOffset,input.byteOffset+input.byteLength),basename(workbook),2026);
const selected=recommendedSheets(sheets,basename(workbook)),rows=sheets.filter(s=>selected.includes(s.name)).flatMap(s=>s.rows);
assert.ok(selected.length&&rows.length,'No recommended programmes found');
const record={id:'11111111-1111-4111-8111-111111111111',revision:1,data:index,createdBy:'local-qualification',updatedBy:'local-qualification',updatedAt:index.scannedAt,archived:false};
const proposals=mediaProposals(rows,record,[]),bonjour=proposals.filter(p=>normalized(p.row.title).includes('bonjour le benin'));
// The schedule and folder need not cover the same programme/week. Expose that
// mismatch instead of inventing a row or silently substituting another title.
assert.equal(digest(await readFile(workbook)),before,'Source workbook was changed');
console.log(JSON.stringify({checkedAt:new Date().toISOString(),scope:'metadata-only adapter, not browser permissions',scan:{root,indexedFiles:index.files.length,visitedDirectories,metadataReads,mediaContentReadAttempts,partial:index.partial,scanMs,videoPaths:index.files.filter(f=>/\.(mp4|webm)$/i.test(f.name)).map(f=>f.path)},workbook:{sha256:before,sheets:sheets.length,recommended:selected,rows:rows.length,included:rows.filter(r=>r.included).length,firstDay:rows.filter(r=>r.sheet===selected[0]).map(r=>({cell:r.cell,time:r.time,title:r.title,subtitle:r.subtitle,included:r.included}))},bonjour:bonjour.map(p=>({sheet:p.row.sheet,cell:p.row.cell,title:p.row.title,time:p.row.time,date:p.row.airDate,suggested:p.suggested,matches:p.matches.map(m=>({path:m.file.path,score:m.score,reason:m.reason}))})),allSuggestions:proposals.filter(p=>p.suggested).map(p=>({title:p.row.title,date:p.row.airDate,path:p.suggested}))},null,2));
