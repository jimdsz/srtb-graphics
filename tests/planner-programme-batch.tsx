// Real review component; synthetic programme catalogue and in-memory changes.
// No server account, filesystem permission, media reads or production mutation.
import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import PlannerProgrammeReview from '../src/studio/PlannerProgrammeReview';
import {api,ApiError} from '../src/studio/api';
import {plannerAPI} from '../src/studio/day-planner-api';
import {activeChannelId,selectChannel} from '../src/studio/channel-context';
import {planSchema} from '../src/studio/day-planner-model';
import type {Plan,PlannerRow} from '../src/studio/day-planner-model';
import type {Programme} from '../src/studio/channel-model';
import '../src/studio/studio.css';
import '../src/studio/theme.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';
import '../src/studio/day-planner.css';

const query=new URLSearchParams(location.search),mode=query.get('mode')||'normal';
const uuid=(n:number)=>`55555555-5555-4555-8555-${String(n).padStart(12,'0')}`;
const local=(n:number)=>`local-media:${n.toString(16).padStart(64,'0')}:2048`;
const source=(n:number,mimeType:string,name:string)=>({url:local(n),mimeType,name});
const stamp='2026-09-29T12:00:00Z';
function programme(n:number,name:string,aliases:string[],channel='benin-tv'):Programme{
  return {id:uuid(n),channel_id:channel,name,revision:n===1?5:6,archived:0,updated_at:stamp,data:{name,aliases,category:'Catégorie officielle à ne pas imposer',recurring:n===1,recipe:n===1?[]:['event'],replayUrl:'https://example.test/replay',notes:'Fiche fictive',directoryIds:[uuid(50)],voiceProfileId:uuid(60),logo:`/api/graphics/media/${uuid(70)}/content`}};
}
// The second target and both ambiguous records are deliberately on page two.
const catalogue=[programme(1,'Magazine des régions',['Magazine terrain','Collision page suivante']),...Array.from({length:99},(_,n)=>programme(1000+n,`Fiche hors conducteur ${n+1}`,[])),programme(2000,'Culture en direct',['Culture']),programme(2001,'Table ronde A',['Table ronde']),programme(2002,'Table ronde B',['Table ronde','Collision page suivante'])];
function occurrence(index:number,title:string):PlannerRow{
  const n=index+1,date=`2026-09-${String(21+(index%7)).padStart(2,'0')}`,media=source(n,'video/mp4',`Épisode ${n}.mp4`);
  return {id:`occurrence:${n}`,sheet:`Jour ${index%7+1}`,cell:`B${n+3}`,raw:`Source originale · ${title}`,broadcastDate:date,airDate:date,time:`${String(7+(index%16)).padStart(2,'0')}:30:00`,duration:1200+n,title,subtitle:`Épisode ${String(n).padStart(2,'0')} · montage éditorial`,category:`Catégorie personnelle ${n}`,included:true,issues:[`Note opérateur ${n}`],kinds:index%2?['popup','renvoi']:['ba','tds'],formats:index%3?['tv','portrait']:['vertical','tv'],media,location:{directoryId:uuid(100+n),path:`Épisodes/édition-${n}.mp4`,size:2048,modified:1700000000000+n},logo:source(1000+n,'image/png',`Logo personnel ${n}.png`),excerpt:{source:media.url,start:n,end:n+10,duration:1200+n},voices:{ba:{source:source(2000+n,'audio/wav',`Voix ${n}.wav`),sourceDuration:10,start:1,end:4,cue:'Ce soir',confirmed:true,placement:{mode:'ba-auto'}}}};
}
const rows=[...Array.from({length:24},(_,i)=>occurrence(i,'Magazine terrain')),...Array.from({length:3},(_,i)=>occurrence(i+24,'Culture'))];
rows[0]={...rows[0],programmeId:uuid(1),programmeRevision:4,airDate:'2026-09-22',broadcastDate:'2026-09-21',time:'00:30:00'};
rows[1]={...rows[1],title:'Titre éditorial personnel',programmeId:uuid(1),programmeRevision:4};
rows[2]={...rows[2],programmeId:uuid(1),programmeRevision:5};
rows[23]={...rows[23],included:false};
rows.push(occurrence(27,'Table ronde'),occurrence(28,'Émission sans correspondance'),{...occurrence(29,'Magazine terrain'),sourceRemoved:true,included:false});
rows.push(occurrence(30,'Collision page suivante'));
const initialPlan:Plan=planSchema.parse({kind:'plan',name:'Préparation A',source:'conducteur-fixture.xlsx',sourceHash:'a'.repeat(64),rows,sourceRows:structuredClone(rows),weekly:{startDate:'2026-09-21',rowIds:rows.slice(0,7).map(row=>row.id),formats:['portrait','tv'],voice:{source:source(3000,'audio/wav','Voix du semainier.wav'),sourceDuration:8,start:1,end:6,cue:'Cette semaine',confirmed:true,placement:{mode:'single',delay:2}}}});
type Read={phase:'initial'|'review';channel:string;next:string|null;cycle:number;settled:boolean;aborted:boolean};
const evidence={mode,initialPlan:structuredClone(initialPlan),currentPlan:structuredClone(initialPlan),reads:[] as Read[],unexpectedReads:[] as string[],applied:[] as {plan:Plan;changed:number}[],writes:[] as string[],closed:0,context:0};
let recovered=false,cycle=0,largeCatalogue:Programme[]|undefined;
const held=new Set((query.get('hold')||'').split(',').filter(Boolean)),pending=new Map<string,()=>void>();
async function gate(phase:string){if(!held.has(phase))return;held.delete(phase);await new Promise<void>(resolve=>pending.set(phase,resolve));}
const control={release:(phase:string)=>{const release=pending.get(phase);if(!release)throw Error(`Pas de réponse ${phase} retenue`);pending.delete(phase);release();},recover:()=>{recovered=true;},mutateRow:(_id:string):void=>{throw Error('Fixture non montée');},changePreparation:():void=>{throw Error('Fixture non montée');},changeChannel:():void=>{throw Error('Fixture non montée');}};
Object.assign(window,{plannerProgrammeBatchEvidence:evidence,plannerProgrammeBatchControl:control});
const catalogFor=(channel:string)=>catalogue.map(item=>({...structuredClone(item),channel_id:channel,...(channel==='other-channel'?{name:`Autre chaîne · ${item.name}`,data:{...structuredClone(item.data),name:`Autre chaîne · ${item.name}`}}:{})}));
const pageCatalogue=async(next:string|null=null,signal?:AbortSignal)=>{
  if(next===null)cycle++;
  const phase=cycle===1?'initial':'review',read:Read={phase,channel:activeChannelId(),next,cycle,settled:false,aborted:!!signal?.aborted};evidence.reads.push(read);
  signal?.addEventListener('abort',()=>{read.aborted=true;},{once:true});
  let data=catalogFor(read.channel);
  if(phase==='review'){
    if(mode==='archived')data=data.filter(item=>item.id!==uuid(1));
    if(['revision-changed','data-changed','downgraded'].includes(mode))data=data.map(item=>item.id!==uuid(1)?item:{...item,revision:mode==='revision-changed'?item.revision+1:mode==='downgraded'?item.revision-1:item.revision,data:{...item.data,notes:'Modifiée pendant la relecture'}});
    if(mode==='new-ambiguity')data.push(programme(500,'Magazine concurrent',['Magazine terrain']));
  }
  if(mode==='empty')data=[];
  if(mode==='oversized')data=largeCatalogue??=Array.from({length:10100},(_,n)=>programme(10000+n,`Programme ${n}`,[]));
  data.sort((a,b)=>a.id.localeCompare(b.id));
  const offset=next?data.findIndex(item=>item.id===next)+1:0;
  await gate(phase);if(offset>0)await gate('page-two');read.settled=true;
  if((mode==='initial-error'||mode==='review-error'&&phase==='review')&&!recovered)throw Error('Catalogue fictif indisponible.');
  if(mode==='page-error'&&offset>0&&!recovered)throw new ApiError('Page suivante fictive indisponible.',503);
  if(mode==='bad-pagination'&&offset>0)return {programmes:[],next:uuid(3000)};
  return {programmes:data.slice(offset,offset+100),next:offset+100<data.length?data[offset+99].id:null};
};
Object.assign(api,{programmePage:pageCatalogue});
api.programmes=async()=>{evidence.unexpectedReads.push('legacy-catalogue');throw Error('La recette exige le catalogue paginé.');};
api.programme=async()=>{evidence.unexpectedReads.push('individual-record');throw Error('La recette exige une relecture complète du catalogue.');};
const forbidden=async(name:string):Promise<never>=>{evidence.writes.push(name);throw Error('Aucune mutation autorisée dans cette recette.');};
api.saveProgramme=()=>forbidden('programme');api.save=()=>forbidden('project');api.create=()=>forbidden('create-project');plannerAPI.save=()=>forbidden('plan');plannerAPI.create=()=>forbidden('create-tasks');
function Fixture(){
  const[current,setCurrent]=useState(initialPlan),[open,setOpen]=useState(false),[context,setContext]=useState(0),[channel,setChannel]=useState(activeChannelId());
  useEffect(()=>{
    evidence.currentPlan=structuredClone(current);evidence.context=context;
    control.mutateRow=id=>setCurrent(plan=>({...plan,rows:plan.rows.map(row=>row.id===id?{...row,subtitle:'Retouche arrivée pendant la revue',logo:source(9001,'image/webp','Logo tardif.webp')}:row)}));
    control.changePreparation=()=>{cycle=0;setContext(value=>value+1);setCurrent({...structuredClone(initialPlan),name:'Préparation B',sourceHash:'b'.repeat(64)});};
    control.changeChannel=()=>{selectChannel('other-channel');cycle=0;setChannel(activeChannelId());setContext(value=>value+1);};
  },[current,context]);
  return <main className="day-planner" style={{padding:24}}><h1>Rapprochements groupés — recette locale</h1><p>Aucune fiche, préparation ou génération n’est enregistrée sur un serveur.</p><button onClick={()=>setOpen(true)}>Ouvrir les rapprochements</button><output aria-label="Préparation courante">{current.name} · {channel}</output>{open?<PlannerProgrammeReview key={`${context}:${channel}`} plan={current} onClose={()=>{evidence.closed++;setOpen(false);}} onApply={(plan,changed)=>{evidence.applied.push({plan:structuredClone(plan),changed});setCurrent(plan);setOpen(false);}}/>:null}</main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
