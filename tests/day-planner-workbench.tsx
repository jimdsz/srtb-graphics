// Isolated UI fixture. In-memory API replacements only, never a production session.
import {createRoot} from 'react-dom/client';
import Studio from '../src/studio/Studio';
import {api} from '../src/studio/api';
import {ApiError} from '../src/studio/api';
import {derivations} from '../src/studio/derivation-api';
import {plannerAPI} from '../src/studio/day-planner-api';
import {plannerProject} from '../src/studio/day-planner-project';
import {taskKey,programmeIdentity} from '../src/studio/day-planner-model';
import type {PlannerDocument,PlannerRecord,PlannerTask} from '../src/studio/day-planner-model';
import type {Project} from '../src/studio/domain';
import {rememberFolder} from '../src/studio/day-planner-folders';
import {beginLocalFile} from '../src/studio/local-media';
import type {DirectoryHandle} from '../src/studio/day-planner-folders';
import type {Plan,PlannerRow,DirectoryIndex} from '../src/studio/day-planner-model';
import '../src/studio/studio.css';
import '../src/studio/theme.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';
const records=new Map<string,PlannerRecord>(),projects=new Map<string,Project>(),tasks=new Map<string,PlannerTask[]>();
const email='recette@example.test';
const fixtureOptions=new URLSearchParams(location.search),batchSizes:number[]=[];
let lostResponse=fixtureOptions.has('lostResponse');
const audit=document.createElement('pre');audit.id='planner-fixture-audit';audit.setAttribute('aria-label','Contrôle local des brouillons');document.body.append(audit);
function showAudit(){audit.textContent=JSON.stringify({count:projects.size,batchSizes,plans:[...records.values()].filter(r=>r.data.kind==='plan').map(r=>({revision:r.revision,weekly:r.data.kind==='plan'?r.data.weekly:undefined})),projects:[...projects.values()].map(p=>({title:p.title,template:p.template_id,format:p.data._studio_format,weeklyTitles:Object.fromEntries(Object.entries(p.data).filter(([k])=>/^programme_\d_title$/.test(k))),signature:p.data._audio_bed_enabled===true||p.data._audio_enabled===true,voice:p.data._audio_voice_enabled===true,voiceSettings:Object.fromEntries(Object.entries(p.data).filter(([k])=>k.startsWith('_audio_voice_'))),cuts:Object.fromEntries(Object.entries(p.data).filter(([k])=>/^_media_.+_(?:start|end)_seconds$/.test(k)))}))},null,2);}
derivations.origin=async()=>{throw new ApiError('Aucune provenance dans ce banc local.',404);};
derivations.list=async()=>({batches:[],next:null});
derivations.voices=async()=>({profiles:[],next:null});
api.projects=async()=>({projects:[...projects.values()],next:null});api.media=async()=>fixtureOptions.has('voices')?[{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',name:'RECETTE LOCALE — signal doux 3 s (pas une voix réelle)',mime_type:'audio/wav',bytes:288044,created_by:email,created_at:'2026-09-25T12:00:00Z',status:'ready'}]:[];api.project=async id=>structuredClone(projects.get(id)!);api.comments=async()=>[];api.revisions=async()=>[];
plannerAPI.list=async kind=>({documents:[...records.values()].filter(r=>r.data.kind===kind).map(r=>({id:r.id,revision:r.revision,name:r.data.name,kind:r.data.kind,updatedAt:r.updatedAt,archived:false})),next:null});
plannerAPI.overview=async(view,date)=>({items:[],next:null,view,date});
plannerAPI.get=async<T extends PlannerDocument>(id:string)=>structuredClone(records.get(id)) as PlannerRecord<T>;
plannerAPI.rules=async programmes=>({rules:[...records.values()].filter((r):r is PlannerRecord<import('../src/studio/day-planner-model').ProgrammeRule>=>r.data.kind==='rule'&&programmes.includes(r.data.programme))});
plannerAPI.save=async<T extends PlannerDocument>(id:string,revision:number,data:T)=>{const r:PlannerRecord<T>={id,revision:revision+1,data:structuredClone(data),updatedAt:new Date().toISOString(),archived:false,createdBy:email,updatedBy:email};records.set(id,r);return structuredClone(r);};
plannerAPI.tasks=async id=>{showAudit();return {tasks:structuredClone(tasks.get(id)||[])}};
plannerAPI.create=async(id,revision,choices,options)=>{const plan=records.get(id)!.data;if(plan.kind!=='plan')throw Error('Invalid plan');const list=tasks.get(id)||[];batchSizes.push(choices.length);if(fixtureOptions.has('slow'))await new Promise(resolve=>setTimeout(resolve,300));for(const c of choices){const key=taskKey(c);if(list.some(t=>t.key===key))continue;const p=plannerProject(plan,c),projectId=crypto.randomUUID();projects.set(projectId,{id:projectId,title:p.title,template_id:p.template.id,template_version:p.template.version,library_version:p.template.libraryVersion,data:p.data,revision:1,status:'draft',archived:0,created_by:email,updated_by:email,created_at:new Date().toISOString(),updated_at:new Date().toISOString()});list.push({key,projectId,title:p.title,status:'draft',archived:false,sourceRevision:revision});}tasks.set(id,list);showAudit();if(lostResponse){lostResponse=false;throw new ApiError('Recette : réponse perdue après enregistrement. Reprenez la préparation.',0);}return{tasks:structuredClone(options?.response==='requested'?list.filter(t=>choices.some(c=>taskKey(c)===t.key)):list)};};
async function mount(){
 if(new URLSearchParams(location.search).get('seed')==='1'){
  const blob=await(await fetch('/library/v1.7.0/BTV_Ce_Soir/lib/media/programme.jpg')).blob();
  const files=Array.from({length:7},(_,i)=>new File([blob],`Programme ${i+1} épisode ${31+i}.jpg`,{type:'image/jpeg',lastModified:100}));
  const folder={kind:'directory',name:'Recette locale',queryPermission:async()=> 'granted',requestPermission:async()=> 'granted',getFileHandle:async(name:string)=>({kind:'file',name,getFile:async()=>{const f=files.find(f=>f.name===name);if(!f)throw Error('Fichier absent');return f;}})} as unknown as DirectoryHandle;
  const directoryId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  await rememberFolder(email,directoryId,folder,false);
  await plannerAPI.save<DirectoryIndex>(directoryId,0,{kind:'directory',name:folder.name,partial:false,scannedAt:new Date().toISOString(),files:files.map(f=>({path:f.name,name:f.name,size:f.size,modified:f.lastModified}))});
  const large=fixtureOptions.has('large');
  const rows:PlannerRow[]=Array.from({length:large?32:7},(_,i)=>({id:String(i),sheet:'RECETTE',cell:'A'+i,raw:'',title:`Programme ${i+1}`,subtitle:`Épisode ${31+i}`,category:'Magazine',broadcastDate:`2026-09-${String(large?7:7+i).padStart(2,'0')}`,airDate:`2026-09-${String(large?7:7+i).padStart(2,'0')}`,time:'20:30:00',duration:1800,included:true,kinds:['ba','popup'],formats:large?['tv','portrait','vertical']:['tv'],issues:[],media:null,location:null}));
  if(fixtureOptions.has('logoReuse')){
   const programmeId='11111111-1111-4111-8111-111111111111';
   for(const row of rows.slice(0,3)){row.programmeId=programmeId;row.programmeRevision=3;}
   rows[2].logo={url:'local-media:'+'b'.repeat(64)+':200',name:'Logo manuel antérieur.png',mimeType:'image/png'};
   api.programme=async id=>({id,channel_id:'benin-tv',name:'Magazine',revision:3,archived:0,updated_at:'2026-09-29T12:00:00Z',data:{name:'Magazine',aliases:[],category:'Magazine',replayUrl:'',recurring:false,recipe:[],notes:'',directoryIds:[],voiceProfileId:null,logo:''}});
  }
  if(fixtureOptions.has('recipes'))for(const [i,row] of rows.slice(0,3).entries())await plannerAPI.save(crypto.randomUUID(),0,{kind:'rule',name:row.title,programme:programmeIdentity(row),keywords:row.title,directoryId:null,preferredPath:null,kinds:i===1?['popup']:['tds','renvoi']});
  if(fixtureOptions.has('weeklyDates')){rows[0].airDate='2026-09-08';rows[0].time='00:30:00';rows[6].airDate='2026-09-14';}
  if(fixtureOptions.has('excerpt')){const video=await(await fetch('/preview-media/v1/ba-programme.mp4')).blob(),media=await beginLocalFile(new File([video],'Programme-recette.mp4',{type:'video/mp4'}),()=>{}).verified;for(const row of rows){row.media=media;row.kinds=['ba','popup','tds','renvoi','event'];row.formats=['tv','portrait','vertical'];}}
  await plannerAPI.save<Plan>('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',0,{kind:'plan',name:'Semaine · recette locale',source:'fixture.xlsx',sourceHash:'a'.repeat(64),rows});
 }
 const root=createRoot(document.querySelector('#root')!);root.render(<Studio member={{email,name:'Poste de recette',role:'designer',active:1}}/>);
 import.meta.hot?.dispose(()=>{root.unmount();audit.remove();});
}
void mount();
