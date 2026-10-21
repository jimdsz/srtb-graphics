// Real UI / local generated image files / isolated in-memory API. Never sends a
// programme, media, rule or project to production. No authenticated account.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import PlannerBatchMedia from '../src/studio/PlannerBatchMedia';
import PlannerMediaDialog from '../src/studio/PlannerMediaDialog';
import {plannerAPI} from '../src/studio/day-planner-api';
import {rememberFolder} from '../src/studio/day-planner-folders';
import type {DirectoryHandle} from '../src/studio/day-planner-folders';
import type {DirectoryIndex,PlannerDocument,PlannerRecord,PlannerRow,ProgrammeRule} from '../src/studio/day-planner-model';
import '../src/studio/studio.css';
import '../src/studio/theme.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';
import '../src/studio/day-planner.css';

const member={email:'recette@example.test',name:'Recette locale',role:'designer' as const,active:1};
const id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const names=['Bonjour le Bénin 06-09-2026.jpg','Bonjour le Bénin 07-09-2026.jpg','Magazine santé 07-09-2026 V1.jpg','Magazine santé 07-09-2026 V2.jpg','Magazine sport 06-09-2026.jpg'];
const rows:PlannerRow[]=['Bonjour le Bénin','Magazine santé','Magazine sport'].map((title,i)=>({id:String(i),title,subtitle:'',sheet:'LUNDI',cell:'A'+i,raw:'',category:'Magazine',broadcastDate:'2026-09-07',airDate:'2026-09-07',time:`${String(6+i).padStart(2,'0')}:30:00`,duration:1800,included:true,kinds:['ba'],formats:['tv'],media:null,location:null,issues:[]}));
const docs=new Map<string,PlannerRecord>();
const stress=new URLSearchParams(location.search).has('stress');
const memoryFault=new URLSearchParams(location.search).get('memory-fault');
let memoryCalls=0,memoryAborts=0,lateWrite:(()=>void)|undefined;
if(stress)rows.splice(0,rows.length,...Array.from({length:600},(_,i)=>({...rows[0],id:String(i),title:`Émission série ${String(i).padStart(4,'0')}`})));
const audit=document.createElement('pre');audit.id='folder-audit';document.body.append(audit);
function showAudit(){audit.textContent=JSON.stringify({directories:[...docs.values()].filter(d=>d.data.kind==='directory').map(d=>({id:d.id,name:d.data.name,files:d.data.kind==='directory'?d.data.files.length:0})),rules:[...docs.values()].filter(d=>d.data.kind==='rule').length,mediaUploads:0,memoryCalls,memoryAborts},null,2);}
plannerAPI.list=async(kind,_offset,programme)=>({documents:[...docs.values()].filter(d=>d.data.kind===kind&&(!programme||(d.data.kind==='rule'&&d.data.programme===programme))).map(d=>({id:d.id,kind:d.data.kind,revision:d.revision,name:d.data.name,updatedAt:d.updatedAt,archived:false})),next:null});
plannerAPI.get=async<T extends PlannerDocument>(key:string)=>structuredClone(docs.get(key)) as PlannerRecord<T>;
plannerAPI.rules=async programmes=>({rules:[...docs.values()].filter((r):r is PlannerRecord<ProgrammeRule>=>r.data.kind==='rule'&&programmes.includes(r.data.programme))});
plannerAPI.save=async<T extends PlannerDocument>(key:string,revision:number,data:T)=>{const r:PlannerRecord<T>={id:key,revision:revision+1,data:structuredClone(data),createdBy:member.email,updatedBy:member.email,updatedAt:new Date().toISOString(),archived:false};docs.set(key,r);showAudit();return structuredClone(r);};

function Fixture(){
 const [current,setCurrent]=useState(rows),[view,setView]=useState<'batch'|'single'|null>(null);
 return <main style={{padding:24}}><h1>Recette locale : dates des médias</h1><p>API simulée. Aucun fichier envoyé. Aucune écriture en production.</p>{new URLSearchParams(location.search).has('memory-refused')?<p>Test de refus de mémorisation : dossier simulé non sérialisable. Choisir un dossier utilise uniquement les JPEG générés par ce banc.</p>:null}
  <button onClick={()=>setView('batch')}>Tester le choix groupé</button><button onClick={()=>setView('single')}>Tester la rediffusion manuelle</button>
  {memoryFault?<button onClick={()=>lateWrite?.()}>Livrer la réponse tardive du banc</button>:null}
  <ul>{current.map(r=><li key={r.id}>{r.title} — {r.location?.path||'Aucun média lié'}</li>)}</ul>
  {view==='batch'?<PlannerBatchMedia rows={current} member={member} onClose={()=>setView(null)} onApply={(key,media,location)=>setCurrent(rs=>rs.map(r=>r.id===key?{...r,media,location}:r))}/>:null}
  {view==='single'?<PlannerMediaDialog row={rows[2]} member={member} onClose={()=>setView(null)} onSelect={(media,location)=>{setCurrent(rs=>rs.map(r=>r.id==='2'?{...r,media,location}:r));setView(null);}}/>:null}
 </main>;
}

async function mount(){
 let timer:ReturnType<typeof setInterval>|undefined;
 if(stress){const meter=document.createElement('output');meter.id='responsiveness';document.body.append(meter);let previous=performance.now(),maxGap=0,ticks=0;timer=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-previous);previous=now;meter.textContent=`Réactivité interface : ${++ticks} battements · intervalle maximal ${maxGap.toFixed(0)} ms`;},50);}
 const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
 const context=canvas.getContext('2d')!;context.fillStyle='#273038';context.fillRect(0,0,320,180);context.fillStyle='#ead048';context.font='20px sans-serif';context.fillText('MÉDIA DE RECETTE',50,95);
 const blob=await new Promise<Blob>(resolve=>canvas.toBlob(b=>resolve(b!),'image/jpeg'));
 const files=names.map(name=>new File([blob],name,{type:'image/jpeg',lastModified:100}));
 const folder={kind:'directory',name:'Recette datée',queryPermission:async()=> 'granted',requestPermission:async()=> 'granted',async *entries(){for(const file of files)yield [file.name,{kind:'file',name:file.name,getFile:async()=>file}];},getFileHandle:async(name:string)=>({kind:'file',name,getFile:async()=>{const f=files.find(f=>f.name===name);if(!f)throw Error('Fichier absent');return f;}})} as unknown as DirectoryHandle;
 const params=new URLSearchParams(location.search);let picks=0;
 if(location.hostname==='127.0.0.1'&&(params.has('memory-refused')||params.has('new-folder')))Object.defineProperty(window,'showDirectoryPicker',{configurable:true,value:async()=>{
  picks++;if(params.has('stalled-folder')&&picks===1)return {...folder,entries:()=>({next:()=>new Promise(()=>{}),return:async()=>({done:true})})};
  return params.has('empty-folder')?{...folder,entries:async function*(){}}:folder;
 }});
 if(!params.has('new-folder')){
  await rememberFolder(member.email,id,folder,false);
  await plannerAPI.save<DirectoryIndex>(id,0,{kind:'directory',name:folder.name,files:files.map(f=>({path:f.name,name:f.name,size:f.size,modified:f.lastModified})),partial:params.has('partial-index'),scannedAt:new Date().toISOString()});
  await plannerAPI.save<ProgrammeRule>('cccccccc-cccc-4ccc-8ccc-cccccccccccc',0,{kind:'rule',name:rows[0].title,programme:'bonjour le benin',keywords:rows[0].title,directoryId:id,preferredPath:names[0],kinds:['ba']});
  if(params.has('conflicting-rules'))await plannerAPI.save<ProgrammeRule>('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',0,{kind:'rule',name:rows[0].title,programme:'bonjour le benin',keywords:rows[0].title,directoryId:id,preferredPath:names[1],kinds:['popup']});
  if(params.has('team-folders')){
   const extraId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
   const extraFiles=['Magazine sport 07-09-2026.jpg','Magazine santé 07-09-2026 V3.jpg'].map(name=>new File([blob],name,{type:'image/jpeg',lastModified:200}));
   const extra={...folder,name:'Sports et santé',getFileHandle:async(name:string)=>({kind:'file',name,getFile:async()=>{const f=extraFiles.find(f=>f.name===name);if(!f)throw Error('Fichier absent');return f;}})} as unknown as DirectoryHandle;
   await rememberFolder(member.email,extraId,extra,false);
   await plannerAPI.save<DirectoryIndex>(extraId,0,{kind:'directory',name:extra.name,files:extraFiles.map(f=>({path:f.name,name:f.name,size:f.size,modified:f.lastModified})),partial:false,scannedAt:new Date().toISOString()});
   if(params.has('failed-index')){const base=plannerAPI.get;plannerAPI.get=async<T extends PlannerDocument>(key:string,signal?:AbortSignal)=>{if(key===extraId)throw Error('Dossier temporairement indisponible');return base<T>(key,signal);};}
   if(params.has('stalled-index')){const base=plannerAPI.get;plannerAPI.get=async<T extends PlannerDocument>(key:string,signal?:AbortSignal)=>{if(key===extraId)return new Promise(()=>{});return base<T>(key,signal);};}
  }
  if(stress){docs.clear();for(let i=0;i<8;i++)await plannerAPI.save<DirectoryIndex>(`${String(i).padStart(8,'0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,0,{kind:'directory',name:`Dossier ${i+1}`,files:Array.from({length:1000},(_,j)=>({path:`Émission série ${String(j).padStart(4,'0')} 07-09-2026 V${i+1}.mp4`,name:`Émission série ${String(j).padStart(4,'0')} 07-09-2026 V${i+1}.mp4`,size:100,modified:1})),partial:false,scannedAt:new Date().toISOString()});}
 }
 if(memoryFault){const base=plannerAPI.save;plannerAPI.save=async<T extends PlannerDocument>(key:string,revision:number,data:T,signal?:AbortSignal)=>{
  if(data.kind!=='rule')return base(key,revision,data,signal);
  memoryCalls++;showAudit();signal?.addEventListener('abort',()=>{memoryAborts++;showAudit();},{once:true});
  if(memoryFault==='stalled')return new Promise(resolve=>{lateWrite=()=>{void base(key,revision,data).then(resolve);};});
  if(memoryFault==='offline')throw Error('Connexion indisponible (banc)');
  if(memoryFault==='403')throw Object.assign(Error('Accès suspendu (banc)'),{status:403});
  if(memoryFault==='409')throw Object.assign(Error('Association modifiée par un collègue (banc)'),{status:409});
  return base(key,revision,data,signal);
 };}
 showAudit();const root=createRoot(document.querySelector('#root')!);root.render(<Fixture/>);
 import.meta.hot?.dispose(()=>{root.unmount();audit.remove();clearInterval(timer);});
}
void mount();
