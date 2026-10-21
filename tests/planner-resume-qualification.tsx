// Isolated browser fixture. No accounts, production writes or user media.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import DayPlanner from '../src/studio/DayPlanner';
import {plannerAPI} from '../src/studio/day-planner-api';
import {beginLocalFile,bindLocalFile} from '../src/studio/local-media';
import type {Plan,PlannerDocument,PlannerRecord,PlannerRow} from '../src/studio/day-planner-model';
import '../src/studio/studio.css';
import '../src/studio/theme.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';
const member={email:'recette@example.test',name:'Recette',role:'designer' as const,active:1};
const blob=await(await fetch('/library/v1.7.0/BTV_Ce_Soir/lib/media/programme.jpg')).blob();
const file=new File([blob],'Programme.jpg',{type:'image/jpeg'}),reference=await beginLocalFile(file,()=>{}).verified;
window.dispatchEvent(new Event('srtb-local-media-clear'));
const connected=await beginLocalFile(new File([blob,' '],'Autre-programme.jpg',{type:'image/jpeg'}),()=>{}).verified;
const rows:PlannerRow[]=Array.from({length:7},(_,i)=>({id:String(i),sheet:'RECETTE',cell:`A${i+1}`,raw:'',title:`Programme ${i+1}`,subtitle:'',category:'Magazine',broadcastDate:'2026-09-07',airDate:`2026-09-${String(i+7).padStart(2,'0')}`,time:'20:30:00',duration:1800,included:true,kinds:['ba','popup'],formats:['tv'],issues:[],media:i===0?reference:i===1?{url:'/api/graphics/media/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/content',name:'Partagé.jpg',mimeType:'image/jpeg'}:i===3?connected:null,location:null}));
const record:PlannerRecord<Plan>={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',revision:3,archived:false,createdBy:member.email,updatedBy:member.email,updatedAt:'2026-09-25T00:00:00Z',data:{kind:'plan',name:'Préparation à reprendre',source:'recette.xlsx',sourceHash:'a'.repeat(64),rows,weekly:{rowIds:rows.map(r=>r.id),formats:['tv']}}};
let stalled=false,releases:Array<()=>void>=[],aborts=0,writes=0;
async function gate(signal?:AbortSignal){if(!stalled)return;signal?.addEventListener('abort',()=>aborts++,{once:true});await new Promise<void>(resolve=>releases.push(resolve));}
plannerAPI.list=async kind=>({documents:kind==='plan'?[{id:record.id,kind:'plan',revision:3,name:record.data.name,updatedAt:record.updatedAt,archived:false}]:[],next:null});
plannerAPI.rules=async()=>({rules:[]});
plannerAPI.get=async<T extends PlannerDocument>(_id:string,signal?:AbortSignal)=>{await gate(signal);return structuredClone(record) as unknown as PlannerRecord<T>;};
plannerAPI.tasks=async(_id,signal)=>{await gate(signal);return {tasks:[]};};
plannerAPI.save=async()=>{writes++;throw Error('Aucune écriture autorisée dans cette recette');};
function Fixture(){const [hold,setHold]=useState(false),[message,setMessage]=useState('');return <main style={{padding:16,maxWidth:1200,margin:'auto'}}>
  <h1>Reprise · recette locale</h1><p>Aucune écriture ni transmission de fichiers.</p>
  <div className="row" style={{flexWrap:'wrap',marginBottom:20}}>
    <label className="check"><input type="checkbox" checked={hold} onChange={e=>{stalled=e.target.checked;setHold(stalled);}}/>Simuler une lecture bloquée</label>
    <button onClick={()=>{for(const release of releases)release();releases=[];setMessage(`Réponses libérées · ${aborts} requêtes annulées · ${writes} écritures`);}}>Libérer les réponses tardives</button>
    <button onClick={()=>void bindLocalFile(file,()=>{},undefined,reference.url).then(()=>setMessage('Fichier test reconnecté, sans modifier la préparation.'))}>Reconnecter le fichier test</button>
    <button onClick={()=>{window.dispatchEvent(new Event('srtb-local-media-clear'));setMessage('Accès du banc oubliés.');}}>Oublier les accès du banc</button>
  </div><output style={{display:'block',overflowWrap:'anywhere'}}>{message}</output>
  <DayPlanner member={member} onOpenProject={()=>{throw Error('Aucun projet à ouvrir');}}/>
 </main>;}
const root=createRoot(document.getElementById('root')!);root.render(<Fixture/>);
import.meta.hot?.dispose(()=>root.unmount());
