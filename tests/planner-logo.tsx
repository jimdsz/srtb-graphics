// Isolated real logo dialog. Synthetic metadata, no account or backend writes.
import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import PlannerLogoDialog from '../src/studio/PlannerLogoDialog';
import {api} from '../src/studio/api';
import {plannerAPI} from '../src/studio/day-planner-api';
import type {Programme} from '../src/studio/channel-model';
import type {MediaAsset} from '../src/studio/domain';
import type {PlannerRow} from '../src/studio/day-planner-model';
import type {ProfileAsset} from '../src/studio/preparation-profile-model';
import '../src/studio/studio.css';
import '../src/studio/theme.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';
import '../src/studio/day-planner.css';

const query=new URLSearchParams(location.search),mode=query.get('mode')||'normal';
const id=(number:number)=>`44444444-4444-4444-8444-${String(number).padStart(12,'0')}`;
const url=(number:number)=>`/api/graphics/media/${id(number)}/content`;
const stamp='2026-09-29T12:00:00Z',email='logo@example.test';
const asset=(number:number,name:string,mime_type:string,status:MediaAsset['status']='ready'):MediaAsset=>({id:id(number),name,mime_type,status,bytes:256,created_by:email,created_at:stamp});
const assets=[asset(1,'Logo proposé.webp','image/webp'),asset(2,'Logo manuel partagé.png','image/png'),asset(3,'Logo JPEG partagé.jpg','image/jpeg'),asset(4,'Autre logo WebP.webp','image/webp'),asset(5,'Vidéo interdite.mp4','video/mp4'),asset(6,'Audio interdit.wav','audio/wav'),asset(7,'Image en transfert.png','image/png','uploading'),asset(8,'Image en échec.png','image/png','failed'),asset(9,'Logo enregistré.png','image/png'),asset(10,'SVG non pris en charge.svg','image/svg+xml'),{...asset(99,'Identifiant invalide.png','image/png'),id:'not-a-uuid'}];
const evidence={mode,programmeCalls:[] as {id:string;aborted:boolean;settled:boolean}[],metadataCalls:[] as {id:string;aborted:boolean;settled:boolean}[],catalogueCalls:0,changes:[] as (ProfileAsset|null)[],writes:[] as string[],closed:0};
const held=new Set((query.get('hold')||'').split(',').filter(Boolean)),pending=new Map<string,()=>void>();let recovered=false;
const control={release:(kind:string)=>{const release=pending.get(kind);if(!release)throw Error(`Aucune réponse ${kind} retenue`);pending.delete(kind);release();},recover:()=>{recovered=true;},changeLink:(_number:number,_revision:number):void=>{throw Error('Fixture pas encore montée');}};
Object.assign(window,{plannerLogoEvidence:evidence,plannerLogoControl:control});
async function gate(kind:string){if(!held.has(kind))return;held.delete(kind);await new Promise<void>(resolve=>pending.set(kind,resolve));}
const existing:ProfileAsset={url:url(9),name:'Logo enregistré.png',mimeType:'image/png'};
const row:PlannerRow={id:'logo-row',sheet:'Mardi',cell:'A4',raw:'Magazine de recette',title:'Magazine de recette',subtitle:'Épisode 1',category:'Magazine',broadcastDate:'2026-09-29',airDate:'2026-09-29',time:'20:30',duration:1800,included:true,kinds:['ba'],formats:['tv'],issues:[],media:null,location:null,...(mode==='unlinked'?{}:{programmeId:id(11),programmeRevision:4}),logo:mode==='existing'?existing:null};
api.programme=async(programmeId,signal)=>{
  const entry={id:programmeId,aborted:!!signal?.aborted,settled:false};evidence.programmeCalls.push(entry);signal?.addEventListener('abort',()=>{entry.aborted=true;},{once:true});
  const error=mode==='programme-error'&&!recovered;
  const p:Programme={id:programmeId,channel_id:'benin-tv',name:'Magazine de recette',revision:programmeId===id(12)?6:mode==='mismatch'?5:4,archived:0,updated_at:stamp,data:{name:'Magazine de recette',aliases:[],category:'Magazine',replayUrl:'',recurring:false,recipe:['ba'],notes:'',directoryIds:[],voiceProfileId:null,logo:mode==='empty'?'':url(programmeId===id(12)?4:1)}};
  await gate('programme');entry.settled=true;if(error)throw Error('Fiche de recette indisponible');return p;
};
api.media=async()=>{evidence.catalogueCalls++;if(mode==='catalogue-error'&&!recovered)throw Error('Catalogue d’images de recette indisponible');return structuredClone(assets);};
api.mediaAsset=async(assetId,signal)=>{
  const entry={id:assetId,aborted:!!signal?.aborted,settled:false};evidence.metadataCalls.push(entry);signal?.addEventListener('abort',()=>{entry.aborted=true;},{once:true});
  let found=structuredClone(assets.find(item=>item.id===assetId));
  const error=mode==='metadata-error'&&!recovered&&assetId===id(1)||mode==='shared-metadata-error'&&!recovered&&assetId===id(2);
  if(!recovered&&assetId===id(1)&&found){
    if(mode==='wrong-id')found.id=id(98);
    if(mode==='not-ready')found.status='uploading';
    if(mode==='nonimage')found.mime_type='video/mp4';
    if(mode==='unsupported')found.mime_type='image/svg+xml';
  }
  await gate('metadata');entry.settled=true;if(error)throw Error('Métadonnées du logo indisponibles');if(!found)throw Error('Média absent');return found;
};
api.save=async()=>{evidence.writes.push('project');throw Error('Écriture de projet interdite dans cette recette');};
plannerAPI.save=async()=>{evidence.writes.push('preparation');throw Error('Écriture de préparation interdite dans cette recette');};
api.saveProgramme=async()=>{evidence.writes.push('programme');throw Error('Écriture de fiche interdite dans cette recette');};
function Fixture(){
  const [current,setCurrent]=useState(row),[open,setOpen]=useState(false);
  useEffect(()=>{control.changeLink=(number,revision)=>setCurrent(previous=>({...previous,programmeId:id(number),programmeRevision:revision}));},[]);
  return <main className="day-planner" style={{padding:24}}><h1>Logos de préparation — recette isolée</h1><p>Métadonnées fictives ; aucun projet existant ni semainier manipulé.</p><button type="button" onClick={()=>setOpen(true)}>Ouvrir le choix du logo</button><output aria-label="Logo conservé dans la fixture">{current.logo?.name||'Aucun logo enregistré'}</output>{open?<PlannerLogoDialog row={current} onChange={logo=>{evidence.changes.push(structuredClone(logo));setCurrent(previous=>({...previous,logo}));}} onClose={()=>{evidence.closed++;setOpen(false);}}/>:null}</main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
