// Browser transport replaces only export-queue.ts with window.exportQueuePanelStore.
// The real panel, controls, accessibility semantics and styles remain unchanged.
import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import type {VideoReport} from '../src/studio/video/export';
import '../src/studio/studio.css';
import '../src/studio/theme.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';

type Status='pending'|'checking'|'rendering'|'completed'|'failed'|'cancelled';
type Action='cancel'|'remove'|'retry';
type Job={id:string;title:string;channelId:string;projectId:string;revision:number;composition:string;format:'mp4'|'alpha'|'png'|'mov';status:Status;progress:{percent:number;message:string};error?:string;result?:{url:string;filename:string;blob:Blob;report:VideoReport};unsaved:boolean};
type Snapshot={items:readonly Job[];running:boolean};
const callbacks=new Set<()=>void>(),urls:string[]=[];
let value:Snapshot={items:[],running:false},fail:Action|null=null,heldRemoval:Promise<void>|null=null,releaseRemoval:(()=>void)|null=null;
const evidence={calls:[] as {action:Action;id:string}[],subscriptions:0,unsubscriptions:0,opens:0,downloads:[] as string[],reviewMounts:0,reviewDisposals:0};
function publish(next:Snapshot){value=next;for(const callback of callbacks)callback();}
function update(id:string,patch:Partial<Job>){publish({...value,items:value.items.map(job=>job.id===id?{...job,...patch}:job)});}
function action(action:Action,id:string){evidence.calls.push({action,id});if(fail===action){fail=null;throw Error('Action fictive refusée. Aucun fichier réel concerné.');}}
const store={
 snapshot:()=>value,
 subscribe:(callback:()=>void)=>{callbacks.add(callback);evidence.subscriptions++;return()=>{callbacks.delete(callback);evidence.unsubscriptions++;};},
 cancel:(id:string)=>{action('cancel',id);update(id,{status:'cancelled',progress:{percent:0,message:'Annulé dans la recette locale.'}});},
 remove:async(id:string)=>{action('remove',id);if(heldRemoval)await heldRemoval;publish({...value,items:value.items.filter(job=>job.id!==id)});},
 retry:(id:string)=>{action('retry',id);update(id,{status:'pending',error:undefined,progress:{percent:0,message:'Nouvelle demande explicite de la recette.'}});},
 openPanel:()=>{evidence.opens++;window.dispatchEvent(new Event('srtb-export-queue-open'));},
};
const report:VideoReport={format:'mp4',width:1920,height:1080,fps:25,frames:250,duration:10,audio:true,audioPeak:.6,alpha:false,bytes:4096,checkedFrames:[0,125,249]};
function job(status:Status,index:number,format:Job['format']='mp4'):Job{
 const id=`job-${status}-${index}`,title=`${index===0?'Magazine de recette — titre long pour vérifier le retour à la ligne et la lecture complète':status==='completed'?'Fichier fictif terminé':status==='failed'?'Export fictif interrompu':status==='cancelled'?'Demande fictive annulée':'Émission de recette'} ${index+1}`;
 let result:Job['result'];if(status==='completed'){
  const blob=new Blob(['Données synthétiques, aucune piste vidéo ou audio.'],{type:'application/octet-stream'}),url=URL.createObjectURL(blob);urls.push(url);
  result={url,filename:`fichier-fictif-${index+1}.${format==='png'?'zip':format==='alpha'?'webm':format}`,blob,report:{...report,format,alpha:format==='alpha',audio:format!=='png'}};
 }
 return {id,title,channelId:'benin-tv',projectId:`77777777-7777-4777-8777-${String(index+1).padStart(12,'0')}`,revision:index+1,composition:index%2?'semainier':'ba',format,status,progress:{percent:status==='rendering'?46:status==='completed'?100:0,message:status==='rendering'?'Calcul local fictif : image 115 sur 250.':status==='checking'?'Vérification fictive des sources.':status==='pending'?'En attente du calcul local.':status==='completed'?'Fichier fictif calculé et contrôlé.':status==='failed'?'Échec fictif, action manuelle nécessaire.':'Demande annulée.'},...(status==='failed'?{error:'La source fictive n’est plus accessible. Reconnectez-la avant de réessayer.'}:{}),...(result?{result}:{}),unsaved:index===0};
}
const control={
 seed:(mode='mixed')=>{const statuses:Status[]=mode==='empty'?[]:mode==='completed'?['completed']:mode==='terminal'?['completed','failed','cancelled']:mode==='pending'?['pending']:['pending','checking','rendering','completed','failed','cancelled'];publish({items:statuses.map((status,index)=>job(status,index,status==='completed'?'mov':index===1?'alpha':index===2?'png':'mp4')),running:mode==='mixed'});},
 setRunning:(running:boolean)=>publish({...value,running}),
 status:(id:string,status:Status)=>update(id,{status}),
 progress:(id:string,percent:number)=>update(id,{progress:{percent,message:`Progression fictive ${percent} %.`}}),
 failNext:(kind:Action)=>{fail=kind;},
 holdRemoval:()=>{heldRemoval=new Promise<void>(resolve=>{releaseRemoval=resolve;});},
 releaseRemoval:()=>{releaseRemoval?.();releaseRemoval=null;heldRemoval=null;},
 open:store.openPanel,
 unmount:():void=>{},
 mount:():void=>{},
 snapshot:()=>({items:value.items.map(({result,...rest})=>({...rest,...(result?{result:{filename:result.filename,url:result.url}}:{})})),running:value.running}),
};
function SyntheticReview({blob,duration}:{blob:Blob;duration:number}){
 useEffect(()=>{evidence.reviewMounts++;return()=>{evidence.reviewDisposals++;};},[]);
 return <section aria-label="Contrôle synthétique sans décodage"><p>Durée reçue : {duration} s · {blob.size} octets fictifs.</p></section>;
}
Object.assign(window,{exportQueuePanelStore:store,exportQueuePanelControl:control,exportQueuePanelEvidence:evidence,exportQueuePanelReview:SyntheticReview});
document.addEventListener('click',event=>{const link=event.target instanceof Element?event.target.closest<HTMLAnchorElement>('a[download]'):null;if(link)evidence.downloads.push(link.download);},true);
window.addEventListener('pagehide',()=>{for(const url of urls)URL.revokeObjectURL(url);});

// Deliberately deferred until the synthetic store exists. The runner intercepts
// the store module; without that interception the fixture refuses to load it.
if(!(window as unknown as {exportQueuePanelTransportReady?:boolean}).exportQueuePanelTransportReady)throw Error('Cette fixture exige son transport de recette isolé.');
const {default:ExportQueuePanel}=await import('../src/studio/ExportQueuePanel');
function Fixture(){
 const [mounted,setMounted]=useState(true),[text,setText]=useState('Texte de travail conservé');
 control.unmount=()=>setMounted(false);control.mount=()=>setMounted(true);
 return <><main style={{padding:24,maxWidth:760}}><h1>Recette locale — file d’exports</h1><p>Données fictives uniquement. Aucun moteur de rendu, compte ou média réel.</p><label htmlFor="outside-title">Titre de travail<input id="outside-title" value={text} onChange={event=>setText(event.target.value)}/></label><button type="button" onClick={store.openPanel}>Ouvrir depuis l’éditeur</button><button type="button">Action extérieure suivante</button><p role="status">Saisie conservée : {text}</p></main>{mounted?<ExportQueuePanel/>:null}</>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
