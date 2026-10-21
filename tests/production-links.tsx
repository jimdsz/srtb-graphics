// Real dossier and HTTP client. Only the browser runner supplies synthetic HTTP
// responses; no component/API replacement, account or production data is used.
import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import ProgrammeProductionDossier from '../src/studio/ProgrammeProductionDossier';
import {selectChannel} from '../src/studio/channel-context';
import {taskKey} from '../src/studio/day-planner-model';
import {getTemplate} from '../src/studio/domain';
import type {Member} from '../src/studio/domain';
import type {Plan,PlannerRow} from '../src/studio/day-planner-model';
import type {ProductionHistoricalOccurrence,ProductionLinksContext,ProductionLinksPage,ProductionLinksSection,ProductionOccurrence,ProductionProjectItem,ProductionVisibleProject} from '../src/studio/production-links-model';
import '../src/studio/studio.css';
import '../src/studio/theme.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';
import '../src/studio/day-planner.css';

const params=new URLSearchParams(location.search),mode=params.get('mode')||'normal';
const id=(number:number)=>`77777777-7777-4777-8777-${String(number).padStart(12,'0')}`;
const member:Member={email:'production-links@example.test',name:'Poste de recette',role:params.get('role')==='admin'?'admin':'designer',active:1};
const rowId='Mardi / B:20,Édition',secondRowId='Mercredi / A:19,Édition';
const occurrence:ProductionOccurrence={rowId,title:'Magazine de recette',subtitle:'Épisode 31 — édition de la nuit',airDate:'2026-09-30',broadcastDate:'2026-09-29',time:'00:30',included:true,sourceRemoved:false,programmeRevision:4};
const second:ProductionOccurrence={...occurrence,rowId:secondRowId,subtitle:'Épisode 32 — occurrence distincte',airDate:'2026-10-01',broadcastDate:'2026-09-30',time:'21:05',included:false,sourceRemoved:true};
const context:ProductionLinksContext={channelId:'benin-tv',planId:id(1),planRevision:8,planName:'Conducteur de recette',rowId,scope:mode==='line'?'line':'programme',programmeId:mode==='line'?null:id(100),title:occurrence.title,snapshot:'a'.repeat(64)};
const row=(item:ProductionOccurrence):PlannerRow=>({id:item.rowId,sheet:'Mardi',cell:'B20',raw:'Source non modifiable par le dossier',title:item.title,subtitle:item.subtitle,category:'Culture',broadcastDate:item.broadcastDate,airDate:item.airDate,time:item.time,duration:1800,included:item.included,sourceRemoved:item.sourceRemoved,issues:[],kinds:['ba','popup'],formats:['tv'],media:null,location:null,programmeId:id(100),programmeRevision:4});
const plan:Plan={kind:'plan',name:context.planName,source:'conducteur-fictif.xlsx',sourceHash:'b'.repeat(64),rows:[row(occurrence),row(second)],sourceRows:[row(occurrence),row(second)],weekly:{rowIds:[rowId],formats:['tv']}};
const project=(number:number,title:string,patch:Partial<ProductionVisibleProject>={}):ProductionVisibleProject=>({id:id(number),title,templateId:'BTV_BA_1P',templateVersion:'1.7.0',libraryVersion:'1.7.0',revision:3,status:'draft',archived:false,format:'tv',...patch});
const origin:ProductionHistoricalOccurrence={rowId,linkage:'same-programme',occurrence:structuredClone(occurrence)};
const direct=(number:number,title:string,patch:Partial<ProductionProjectItem>={}):ProductionProjectItem=>({type:'project',id:id(number),relation:'direct',taskKey:taskKey({kind:'ba',format:'tv',rowIds:[rowId]}),kind:'ba',format:'tv',sourceRevision:6,edition:null,origins:[structuredClone(origin)],linkage:'same-programme',project:project(number,title),...patch});
const weekIds=[rowId,secondRowId,'slot3','slot4','slot5','slot6','slot7'];
const weekOrigins=weekIds.map((value,index):ProductionHistoricalOccurrence=>({rowId:value,linkage:index<2?'same-programme':'different-programme',occurrence:{...occurrence,rowId:value,title:index<2?occurrence.title:`Autre émission ${index+1}`,subtitle:`Place éditoriale ${index+1}`}}));
const weekly=direct(20,'Semainier composite — un seul projet',{relation:'weekly',taskKey:taskKey({kind:'weekly',format:'tv',rowIds:weekIds}),kind:'weekly',origins:weekOrigins,project:project(20,'Semainier composite — un seul projet',{templateId:'BTV_Semainier',status:'submitted'})});
const historicalDifferent=direct(12,'Ancien brouillon — autre fiche à la création',{sourceRevision:2,linkage:'different-programme',origins:[{rowId,linkage:'different-programme',occurrence:{...occurrence,title:'Autre émission historique',subtitle:'Ancien épisode indépendant',programmeRevision:1}}]});
const missing=direct(13,'Brouillon à historique indisponible',{sourceRevision:1,linkage:'missing-history',origins:[{rowId,linkage:'missing-history',occurrence:null}],project:project(13,'Brouillon à historique indisponible',{archived:true,status:'approved'})});
const derivedWeekly=direct(30,'Semainier social — vraie composition 4:5',{relation:'derived',kind:'weekly',taskKey:weekly.taskKey,origins:weekOrigins,project:project(30,'Semainier social — vraie composition 4:5',{templateId:'BTV_Semainier',format:'portrait'}),derivation:{batchId:id(40),batchName:'Campagne semainier',sourceProject:weekly.project,sourceRevision:3,targetKey:'ba-vertical',label:'Clé historique ba-vertical',announcement:null}});
const derivedNow=direct(31,'Annonce immédiate — modèle Tout de suite',{relation:'derived',project:project(31,'Annonce immédiate — modèle Tout de suite',{templateId:'BTV_BA_TDS',format:'vertical',status:'approved'}),derivation:{batchId:id(41),batchName:'Campagne des annonces',sourceProject:project(11,'Source de la campagne'),sourceRevision:2,targetKey:'ba-now-vertical',label:'Tout de suite · 9:16',announcement:{key:'now',day:'Tout de suite',time:'',format:'vertical'}}});
const pages:Record<ProductionLinksSection,ProductionLinksPage>={
 occurrences:{context,section:'occurrences',items:[{type:'occurrence',id:rowId,occurrence,coordination:[{key:taskKey({kind:'ba',format:'tv',rowIds:[rowId]}),kind:'ba',format:'tv',ownerName:'Collègue responsable',state:'submitted'},{key:taskKey({kind:'popup',format:'tv',rowIds:[rowId]}),kind:'popup',format:'tv',ownerName:'Autre responsable',state:'unknown'}]},{type:'occurrence',id:secondRowId,occurrence:second,coordination:[]}],next:null},
 deliverables:{context,section:'deliverables',items:[direct(11,'Bande-annonce — version personnelle relue',{project:project(11,'Bande-annonce — version personnelle relue',{status:'approved'})}),historicalDifferent,missing,direct(14,'Brouillon sans fiche documentée',{linkage:'undocumented',origins:[{rowId,linkage:'undocumented',occurrence:{...occurrence,programmeRevision:null}}]})],next:null},
 weekly:{context,section:'weekly',items:[weekly],next:null},
 derivations:{context,section:'derivations',items:[derivedWeekly,derivedNow],next:null},
};
const evidence={initial:structuredClone(plan),openRows:[] as string[],openProjects:[] as string[],closed:0};
const control={channel:()=>selectChannel('autre-chaine'),unmount:()=>{},replaceContext:()=>{},loseRole:()=>{},suspend:()=>{}};
function response(section:ProductionLinksSection,cursor:string|null):ProductionLinksPage{
 const result=structuredClone(pages[section]);
 if(mode==='empty')result.items=[];
 if(mode==='line'&&section==='occurrences')result.items=result.items.slice(0,1);
 if(mode==='pagination'&&section==='deliverables'){
  result.items=cursor==='middle'?[]:cursor==='last'?[result.items[1]]:[result.items[0]];
  result.next=cursor==='last'?null:cursor==='middle'?'last':'middle';
 }
 if(mode==='snapshot-change'&&section==='deliverables'){
  if(cursor){result.context.snapshot='c'.repeat(64);result.items=[result.items[1]];result.next=null;}
  else{result.items=result.items.slice(0,1);result.next='changed';}
 }
 return result;
}
Object.assign(window,{productionLinksFixture:{context,response,pages,modelNames:{BTV_Semainier:getTemplate('BTV_Semainier').name,BTV_BA_TDS:getTemplate('BTV_BA_TDS').name}},productionLinksEvidence:evidence,productionLinksControl:control});
function Fixture(){
 const [open,setOpen]=useState(false),[revision,setRevision]=useState(context.planRevision),[currentMember,setMember]=useState(member);
 useEffect(()=>{control.unmount=()=>setOpen(false);control.replaceContext=()=>setRevision(value=>value+1);control.loseRole=()=>setMember(value=>({...value,role:'designer'}));control.suspend=()=>setMember(value=>({...value,active:0}));},[]);
 return <main className="day-planner" style={{padding:20}}><h1>Recette locale du dossier d’émission</h1><p>Données fictives · lecture seule · aucun compte réel</p><button type="button" onClick={()=>setOpen(true)}>Ouvrir le dossier de recette</button><button type="button" onClick={()=>{throw Error('Le dialogue ne doit pas activer une action de fond.');}}>Action de fond interdite</button>{open?<ProgrammeProductionDossier planId={context.planId} revision={revision} rowId={rowId} member={currentMember} hasUnsavedChanges={mode==='dirty'} onOpenRow={value=>{evidence.openRows.push(value);}} onOpenProject={value=>{evidence.openProjects.push(value);}} onClose={()=>{evidence.closed++;setOpen(false);}}/>:null}</main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
