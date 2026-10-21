// Isolated fixture: metadata and navigation callbacks only, no account or media.
import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import ProductionOverview from '../src/studio/ProductionOverview';
import Studio from '../src/studio/Studio';
import {api} from '../src/studio/api';
import {plannerAPI} from '../src/studio/day-planner-api';
import type {Plan,PlannerDocument,PlannerRecord} from '../src/studio/day-planner-model';
import type {ProductionOverviewItem,ProductionOverviewPage,ProductionOverviewView} from '../src/studio/production-overview-model';
import '../src/studio/studio.css';
import '../src/studio/theme.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';
const options=new URLSearchParams(location.search),mode=options.get('mode')||'populated';
const evidence={calls:[] as {view:string;date:string;cursor?:string}[],items:[] as ProductionOverviewItem[],projects:[] as string[],planner:0,aborts:0};
const held=new Map<string,()=>void>();
let failures=0;
const states=['assigned','draft','submitted','approved','rejected','archived'] as const;
function items(view:ProductionOverviewView,date:string):ProductionOverviewItem[]{
 return Array.from({length:6},(_,index)=>({id:`${view}-${index}`,planId:`plan-${index%2}`,planName:index%2?'Soirée · Équipe fiction':'Journée · Équipe actualités',planRevision:4,rowId:`row-${index}`,
  title:index===0?'Journal du soir':index===1?'Le grand rendez-vous des régions et de la culture':index===5?'Semainier':`Émission ${index+1}`,
  date:index===4?'2026-09-30':date,broadcastDate:date,time:index===4?'00:30:00':`${18+index%4}:30:00`,kind:view==='missing-media'?null:index===5?'weekly':'ba',format:view==='missing-media'?null:'tv',
  ownerName:index===3?null:'Membre de recette',state:view==='missing-media'?'missing-media':view==='review'?'submitted':states[index],...(index%2?{projectId:`visible-project-${index}`}:{})}));
}
plannerAPI.overview=async(view,date,cursor,signal)=>{
 evidence.calls.push({view,date,...(cursor?{cursor}:{})});signal?.addEventListener('abort',()=>evidence.aborts++,{once:true});
 const page:ProductionOverviewPage={view,date,items:items(view,date),next:cursor?null:'page-2'};
 if(mode==='late'&&view==='mine'&&!cursor)await new Promise<void>(resolve=>held.set(`${view}:${date}`,resolve));
 if(mode==='error'&&failures++===0)throw Error('Lecture refusée — recette locale');
 if(mode==='page-error'&&cursor&&failures++===0)throw Error('Suite indisponible — recette locale');
 if(mode==='refresh-error'&&evidence.calls.length===2)throw Error('Actualisation indisponible — recette locale');
 if(mode==='mismatch')return {...page,date:'2024-01-01'};
 if(mode==='empty')return {...page,items:[],next:null};
 if(mode==='empty-page'&&!cursor)return {...page,items:[],next:'page-2'};
 if(cursor)page.items=[...page.items.slice(5),{...page.items[0],id:`${view}-extra`,title:'Émission supplémentaire'}];
 return page;
};
function Fixture(){const [channel,setChannel]=useState('premiere');return <div className="studio-body" style={{maxWidth:1200,margin:'auto'}}><main><p className="notice">Banc local isolé — données fictives, aucun compte ni accès à un partage réel.</p><button onClick={()=>setChannel('seconde')}>Changer de chaîne de recette</button><h1>Aujourd’hui</h1><ProductionOverview key={channel} busy={mode==='busy'} onOpenPlanner={()=>evidence.planner++} onOpenItem={item=>evidence.items.push(structuredClone(item))} onOpenProject={id=>evidence.projects.push(id)}/></main></div>;}
Object.assign(window,{productionOverviewFixture:{evidence,release:(key?:string)=>{if(key){held.get(key)?.();held.delete(key);}else{for(const release of held.values())release();held.clear();}}}});
const shell=options.has('shell');
if(shell){
 api.channels=async()=>[{id:'benin-tv',name:'Bénin TV',logo:'',accent:'#efbd32',timezone:'Africa/Porto-Novo',revision:1,archived:0,canManage:true}];
 api.projects=async()=>({projects:[],next:null});api.media=async()=>[];
 const data:Plan={kind:'plan',name:'Journée · Équipe actualités',source:'Fixture locale',sourceHash:'a'.repeat(64),rows:[{id:'row-0',title:'Journal du soir',subtitle:'Cible issue de l’accueil',category:'Information',sheet:'Fixture',cell:'A1',raw:'',broadcastDate:'2026-09-29',airDate:'2026-09-30',time:'00:30:00',duration:1800,included:true,kinds:['ba'],formats:['tv'],issues:[],media:null,location:null}]};
 const record:PlannerRecord<Plan>={id:'plan-0',revision:4,data,createdBy:'recette@example.test',updatedBy:'recette@example.test',updatedAt:'2026-09-29T12:00:00Z',archived:false};
 plannerAPI.list=async()=>({documents:[{id:record.id,revision:4,kind:'plan',name:data.name,updatedAt:record.updatedAt,archived:false}],next:null});
 plannerAPI.get=async<T extends PlannerDocument>()=>structuredClone(record) as unknown as PlannerRecord<T>;
 plannerAPI.tasks=async()=>({tasks:[]});
 plannerAPI.rules=async()=>({rules:[]});
}
createRoot(document.getElementById('root')!).render(shell?<Studio member={{email:'recette@example.test',name:'Poste de recette',role:'designer',active:1}}/>:<Fixture/>);
