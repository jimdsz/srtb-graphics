// Isolated component fixture: synthetic authorized ledger, navigation spies only.
// This is not a real account, server permission test or full DayPlanner workflow.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import ProductionDossier from '../src/studio/ProductionDossier';
import NewProjectDialog from '../src/studio/NewProjectDialog';
import {taskKey} from '../src/studio/day-planner-model';
import type {PlannerRow,PlannerTask,PlannerTaskChoice} from '../src/studio/day-planner-model';
import '../src/studio/studio.css';
import '../src/studio/theme.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';
import '../src/studio/day-planner.css';

const query=new URLSearchParams(location.search),mode=query.get('mode')||'populated';
const row:PlannerRow={id:'Feuille / A:20,Édition',sheet:'Mardi',cell:'A20',raw:'Journal de recette',broadcastDate:'2026-09-29',airDate:'2026-09-29',time:'20:30',duration:1800,title:'Journal de recette — 20 h 30',subtitle:'Dossier local isolé',category:'Journal',included:mode!=='excluded',issues:[],kinds:mode==='no-kinds'?[]:['ba'],formats:mode==='no-formats'?[]:['tv'],media:null,location:null,...(mode==='removed'?{sourceRemoved:true}:{})};
const id=(number:number)=>`11111111-1111-4111-8111-${String(number).padStart(12,'0')}`;
function saved(number:number,kind:PlannerTaskChoice['kind'],format:PlannerTaskChoice['format'],title:string,status:string,edition?:number,archived=false):PlannerTask{
  return {key:taskKey({kind,format,rowIds:kind==='weekly'?[row.id,'b','c','d','e','f','g']:[row.id],...(edition?{edition}:{})}),projectId:id(number),title,status,archived,sourceRevision:edition||1};
}
const tasks:PlannerTask[]=mode==='empty'?[]:mode==='large-history'?Array.from({length:2000},(_,index)=>saved(index+1,'ba','tv','Journal du soir — versions homonymes','draft',index?index+1:undefined)):[
  saved(1,'ba','tv','Journal du soir — version initiale','approved'),
  saved(2,'ba','tv','Journal du soir — version actuelle','draft',4),
  saved(3,'ba','portrait','Journal du soir — portrait à valider','submitted'),
  saved(4,'ba','vertical',`PortraitVerticalAvecUnTitreTrèsLongSansEspace${'X'.repeat(65)}`,'approved'),
  saved(5,'popup','tv','Pop-up — ancien choix conservé','rejected'),
  saved(6,'tds','tv','Tout de suite — état historique','internal-private-raw-status'),
  saved(7,'renvoi','tv','Renvoi — projet archivé','approved',undefined,true),
  saved(8,'weekly','tv','Semainier exclu de ce dossier','draft'),
  {...saved(9,'ba','tv','Même titre, autre ligne privée','draft'),key:taskKey({kind:'ba',format:'tv',rowIds:['other-row']})},
  {...saved(10,'ba','tv','Référence invalide ignorée','draft'),projectId:''},
];
const evidence={mode,prepare:0,opens:[] as {projectId:string;target:'settings'|'exports'}[]};
Object.assign(window,{productionDossierEvidence:evidence});
function Fixture(){
  const [open,setOpen]=useState(false);
  return <main className="day-planner" style={{padding:24}}><h1>Recette locale du dossier</h1><p>Aucun compte réel. Le composant reçoit seulement un registre fictif et ses actions sont enregistrées sans navigation.</p><button type="button" onClick={()=>setOpen(true)}>Ouvrir le dossier de recette</button>{open?<NewProjectDialog labelledBy="planner-inspector-title" busy={false} onClose={()=>setOpen(false)}><div className="planner-inspector-heading"><h2 id="planner-inspector-title">{row.title}</h2><p className="small muted">Registre personnel fictif</p></div><ProductionDossier row={row} tasks={tasks} sourceRevision={8} hasUnsavedChanges={mode==='dirty'} disabled={mode==='disabled'} onPrepare={()=>{evidence.prepare++;}} onOpenProject={(projectId,target)=>{evidence.opens.push({projectId,target});}}/></NewProjectDialog>:null}</main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
