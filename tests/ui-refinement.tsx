import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MemberDeletion} from '../src/studio/MemberDeletion';
import MediaCrop from '../src/studio/MediaCrop';
import {api} from '../src/studio/api';
import {getTemplate,templateDefaults} from '../src/studio/domain';
import type {ProjectData} from '../src/studio/domain';
import '../src/studio/studio.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';

// All member operations are inert local fixtures. This page never calls an API.
const member={name:'Compte de qualification',email:'qualification.interface@example.test',role:'designer' as const,active:1};
api.deletionStatus=async()=>({job:null,configured:true});
api.deletionPreview=async()=>({token:'local-unused-token',expiresAt:Date.now()+600000,impact:{...member,projects:[{id:'project',name:'Bande-annonce de qualification',channel:'BTV'}],media:[{id:'media',name:'Extrait de démonstration.mp4',channel:'BTV'}],profiles:[],preparations:[],programmes:[],affected:[{id:'other',name:'Conducteur partagé de démonstration',channel:'BTV'}],comments:2,assignments:1}});
api.deletionConfirm=async()=>{throw Error('Fixture locale : suppression réelle interdite.');};
api.deletionContinue=async()=>{throw Error('Fixture locale : suppression réelle interdite.');};
const template=getTemplate('BTV_BA_1P');
function App(){
 const [visible,setVisible]=useState(true),[data,setData]=useState<ProjectData>({...templateDefaults(template),_studio_format:'vertical',_studio_ba_mode:'simple',_media_body_url:'/preview-media/v1/ba-programme.mp4',_media_body_start_seconds:0,_media_body_end_seconds:4});
 if(new URLSearchParams(location.search).has('deletion'))return <main style={{padding:24}}><button onClick={()=>setVisible(true)}>Ouvrir la suppression</button>{visible?<MemberDeletion target={member} onClose={()=>setVisible(false)} onDone={async()=>{}}/>:null}</main>;
 return <main style={{padding:16,maxWidth:402,margin:'0 auto'}}><h1 style={{fontSize:'1rem',marginBottom:16}}>Recette locale · cadrage</h1><div className="row" style={{marginBottom:16}}><button onClick={()=>setData(d=>({...d,_media_body_start_seconds:1}))}>Changer IN</button><button onClick={()=>setData(d=>({...d,_media_body_end_seconds:3}))}>Changer OUT</button><button onClick={()=>setData(d=>({...d,_media_body_url:'/preview-media/v1/ba-programme.mp4?alternate'}))}>Changer le média</button><button onClick={()=>setData(d=>({...d,_studio_format:d._studio_format==='vertical'?'portrait':'vertical'}))}>Changer le format</button></div><MediaCrop template={template} kind="body" value={data._media_body_url} data={data} start={Number(data._media_body_start_seconds)} onPatch={patch=>setData(d=>({...d,...patch}))}/><output id="fixture-motion" style={{display:'none'}}>{String(data._studio_body_crop_motion||'')}</output></main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
