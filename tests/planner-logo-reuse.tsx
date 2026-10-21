// Real logo dialog and batch/undo helpers; only API transports are synthetic.
// No account, shared write, file upload, generation or existing-project mutation.
import {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import PlannerLogoDialog from '../src/studio/PlannerLogoDialog';
import {applyPlannerLogoReview,undoPlannerLogoChanges} from '../src/studio/planner-logo-reuse';
import type {PlannerLogoReview} from '../src/studio/planner-logo-reuse';
import {api} from '../src/studio/api';
import {plannerAPI} from '../src/studio/day-planner-api';
import {selectChannel} from '../src/studio/channel-context';
import type {Programme} from '../src/studio/channel-model';
import type {MediaAsset} from '../src/studio/domain';
import type {Plan,PlannerRow} from '../src/studio/day-planner-model';
import type {ProfileAsset} from '../src/studio/preparation-profile-model';
import '../src/studio/studio.css';
import '../src/studio/theme.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';
import '../src/studio/day-planner.css';

const params=new URLSearchParams(location.search),mode=params.get('mode')||'normal';
const id=(number:number)=>`66666666-6666-4666-8666-${String(number).padStart(12,'0')}`;
const url=(number:number)=>`/api/graphics/media/${id(number)}/content`;
const stamp='2026-09-29T12:00:00Z',email='logo-reuse@example.test';
const asset=(number:number,name:string,mime_type:string):MediaAsset=>({id:id(number),name,mime_type,status:'ready',bytes:256,created_by:email,created_at:stamp});
const assets=[asset(1,'Logo de la fiche.webp','image/webp'),asset(2,'Logo manuel partagé.png','image/png'),asset(3,'Logo déjà renseigné.png','image/png')];
const proposed:ProfileAsset={url:url(1),name:assets[0].name,mimeType:assets[0].mime_type},existing:ProfileAsset={url:url(3),name:assets[2].name,mimeType:assets[2].mime_type};
const rows:PlannerRow[]=Array.from({length:36},(_,index)=>({
 id:`Feuille:${index+1}/Émission,ligne`,sheet:'Conducteur',cell:`B${index+4}`,raw:`Texte brut conservé ${index+1}`,title:'Magazine de recette',subtitle:`Épisode ${String(index+1).padStart(2,'0')}`,
 category:'Magazine',broadcastDate:'2026-09-29',airDate:index%2?'2026-09-30':'2026-09-29',time:`${String(8+index%12).padStart(2,'0')}:30`,duration:1800,included:index!==5,sourceRemoved:index===6,
 kinds:['ba','popup'],formats:['tv','portrait'],issues:['Observation conservée'],media:{url:`local-media:${'b'.repeat(64)}:1234`,name:'episode.mp4',mimeType:'video/mp4'},
 location:{directoryId:id(80),path:`Épisodes/episode-${index+1}.mp4`,size:1234,modified:100},excerpt:{source:`local-media:${'b'.repeat(64)}:1234`,start:2,end:10,duration:35},
 voices:{ba:{source:{url:`local-media:${'c'.repeat(64)}:456`,name:'voix.mp3',mimeType:'audio/mpeg'},sourceDuration:20,start:1,end:4,cue:'Annonce relue',confirmed:true,placement:{mode:'ba-auto'}}},
 ...(index===4||mode==='unlinked'&&index===0?{}:{programmeId:index===3?id(12):id(11),programmeRevision:index===7?2:4}),
 logo:index===1?existing:index===2?proposed:mode==='existing'&&index===0?existing:null,
}));
rows[8].title='Titre local retouché mais même fiche';
const initial:Plan={kind:'plan',name:'Conducteur conservé',source:'conducteur-fictif.xlsx',sourceHash:'a'.repeat(64),rows,sourceRows:structuredClone(rows),weekly:{startDate:'2026-09-29',rowIds:[0,1,2,3,4,7,8].map(index=>rows[index].id),formats:['tv','portrait']}};
type Outcome=ReturnType<typeof applyPlannerLogoReview>;
const evidence={initial:structuredClone(initial),unitChanges:[] as (ProfileAsset|null)[],groupCalls:[] as {review:PlannerLogoReview;selectedIds:string[];replaceIds:string[];result:Outcome}[],undos:[] as ReturnType<typeof undoPlannerLogoChanges>[],programmeCalls:[] as {id:string;aborted:boolean;settled:boolean}[],metadataCalls:[] as {id:string;aborted:boolean;settled:boolean}[],catalogueCalls:0,writes:[] as string[],closed:0};
const held=new Set((params.get('hold')||'').split(',').filter(Boolean)),pending=new Map<string,(()=>void)[]>();
async function gate(kind:string){if(held.has(kind))await new Promise<void>(resolve=>pending.set(kind,[...(pending.get(kind)||[]),resolve]));}
api.programme=async(programmeId,signal)=>{
 const entry={id:programmeId,aborted:!!signal?.aborted,settled:false};evidence.programmeCalls.push(entry);signal?.addEventListener('abort',()=>{entry.aborted=true;},{once:true});
 const result:Programme={id:programmeId,channel_id:'benin-tv',name:'Magazine de recette',revision:4,archived:0,updated_at:stamp,data:{name:'Magazine de recette',aliases:[],category:'Magazine',replayUrl:'',recurring:false,recipe:['ba'],notes:'',directoryIds:[],voiceProfileId:null,logo:url(1)}};
 await gate('programme');entry.settled=true;return result;
};
api.media=async()=>{evidence.catalogueCalls++;return structuredClone(assets);};
api.mediaAsset=async(assetId,signal)=>{
 const entry={id:assetId,aborted:!!signal?.aborted,settled:false};evidence.metadataCalls.push(entry);signal?.addEventListener('abort',()=>{entry.aborted=true;},{once:true});const result=structuredClone(assets.find(item=>item.id===assetId));
 await gate('metadata');entry.settled=true;if(!result)throw Error('Métadonnées fictives absentes');return result;
};
api.save=async()=>{evidence.writes.push('project');throw Error('Écriture projet interdite');};
plannerAPI.save=async()=>{evidence.writes.push('plan');throw Error('Écriture partagée interdite');};
plannerAPI.create=async()=>{evidence.writes.push('generation');throw Error('Génération interdite');};
api.saveProgramme=async()=>{evidence.writes.push('programme');throw Error('Écriture fiche interdite');};
const control={
 release:(kind:string)=>{held.delete(kind);for(const release of pending.get(kind)||[])release();pending.delete(kind);},
 hold:(kind:string)=>held.add(kind),channel:()=>selectChannel('autre-chaine'),
 patch:(_index:number,_patch:Partial<PlannerRow>):void=>{},context:():void=>{},reimport:():void=>{},unmount:():void=>{},current:():Plan=>structuredClone(initial),
};
Object.assign(window,{plannerLogoReuseEvidence:evidence,plannerLogoReuseControl:control,plannerLogoReuseData:{rowIds:rows.map(row=>row.id),proposed,existing}});
function Fixture(){
 const [plan,setPlan]=useState<Plan>(()=>structuredClone(initial)),[open,setOpen]=useState(false),[context,setContext]=useState('draft-id:source-a'),[canUndo,setCanUndo]=useState(false);
 const latest=useRef(plan);latest.current=plan;
 const receipt=useRef<{review:PlannerLogoReview;changes:Outcome['changes']}|null>(null);
 useEffect(()=>{control.patch=(index,patch)=>setPlan(value=>({...value,rows:value.rows.map((row,i)=>i===index?{...row,...patch}:row)}));control.context=()=>setContext('another-draft:source-b');control.reimport=()=>setPlan(value=>({...value,sourceHash:'d'.repeat(64)}));control.unmount=()=>setOpen(false);control.current=()=>structuredClone(latest.current);},[]);
 function grouped(review:PlannerLogoReview,selectedIds:string[],replaceIds:string[]){
  const result=applyPlannerLogoReview(latest.current,review,selectedIds,replaceIds);evidence.groupCalls.push(structuredClone({review,selectedIds,replaceIds,result}));setPlan(result.plan);receipt.current={review,changes:result.changes};setCanUndo(result.changes.length>0);
 }
 function undo(){if(!receipt.current)return;const result=undoPlannerLogoChanges(latest.current,receipt.current.review,receipt.current.changes);evidence.undos.push(structuredClone(result));setPlan(result.plan);setCanUndo(false);}
 return <main className="day-planner" style={{padding:20}}><h1>Recette locale — logo sur plusieurs occurrences</h1><p>Métadonnées fictives · aucun compte ni envoi</p><button type="button" onClick={()=>setOpen(true)}>Ouvrir le choix du logo</button>{canUndo?<button type="button" onClick={undo}>Annuler la dernière application groupée</button>:null}{open?<PlannerLogoDialog row={plan.rows[0]} onChange={logo=>{evidence.unitChanges.push(structuredClone(logo));setPlan(value=>({...value,rows:value.rows.map((row,index)=>index===0?{...row,logo}:row)}));}} onClose={()=>{evidence.closed++;setOpen(false);}} {...(mode==='standalone'?{}:{reuse:{plan,context,onApply:grouped}})}/>:null}</main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
