import React,{useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import ConnectorSetup from '../src/studio/ConnectorSetup';
import {searchConnector,leaseConnector} from '../src/studio/connector-client';
import '../src/studio/studio.css';
function App(){
 const [status,setStatus]=useState('Associez la console synthétique. Aucun projet ou disque métier ne sera utilisé.');
 const videoRef=useRef<HTMLVideoElement>(null);
 async function search(){try{setStatus('Recherche réelle dans le connecteur…');const result=await searchConnector([{id:'test',title:'Bonjour le Bénin'}]);const match=result.results[0]?.matches[0];if(!match)throw Error('Aucune correspondance synthétique.');setStatus('Vérification du fichier choisi…');const lease=await leaseConnector(match.rootId,match.file);const response=await fetch(lease.url,{headers:{Range:'bytes=0-8'},credentials:'omit'});const bytes=await response.text();if(response.status!==206||bytes!=='synthetic')throw Error('Lecture partielle incorrecte.');setStatus(`PASS : ${result.results[0].matches.length} propositions · empreinte stable vérifiée · lecture partielle 206 correcte. Aucun upload.`);}catch(e){setStatus(e instanceof Error?e.message:String(e));}}
 async function playback(){
  const video=videoRef.current!;
  // Event listeners precede each action; bounded failures never leave a test waiting.
  const wait=(name:string,action:()=>void)=>new Promise<void>((resolve,reject)=>{
   const finish=(error?:Error)=>{clearTimeout(timer);video.removeEventListener(name,done);video.removeEventListener('error',failed);error?reject(error):resolve();};
   const done=()=>finish(),failed=()=>finish(new Error('Décodage du témoin refusé.'));
   const timer=setTimeout(()=>finish(new Error(`Délai dépassé : ${name}`)),15000);
   video.addEventListener(name,done,{once:true});video.addEventListener('error',failed,{once:true});
   try{action();}catch(error){finish(error instanceof Error?error:Error(String(error)));}
  });
  try{
   setStatus('Recherche du témoin vidéo généré…');
   const result=await searchConnector([{id:'video',title:'Témoin lecture connecteur'}]);
   const match=result.results[0]?.matches.find(item=>item.file.name==='Témoin lecture connecteur.mp4');
   if(!match)throw Error('Vidéo témoin absente.');
   const lease=await leaseConnector(match.rootId,match.file);
   await wait('loadeddata',()=>{video.crossOrigin='anonymous';video.muted=true;video.src=lease.url;video.load();});
   const duration=video.duration;
   await wait('seeked',()=>{video.currentTime=5;});
   if(Math.abs(video.currentTime-5)>.05)throw Error('Position de lecture incorrecte.');
   const canvas=document.createElement('canvas');canvas.width=64;canvas.height=36;
   const ctx=canvas.getContext('2d')!;ctx.drawImage(video,0,0,64,36);const pixels=ctx.getImageData(0,0,64,36).data;
   if(!pixels.some((value,index)=>index%4!==3&&value>80))throw Error('Image témoin vide.');
   await video.play();
   await wait('timeupdate',()=>{});
   video.pause();
   if(video.currentTime<=5)throw Error('La vidéo ne progresse pas.');
   const evidence={schema:1,scope:'synthetic connector HTTP localhost / Windows Chromium only',duration,width:video.videoWidth,height:video.videoHeight,seek:5,playedTo:video.currentTime,pixelRead:true,upload:false};
   const response=await fetch(`/__video-evidence/connector-local-playback-${Date.now()}.json`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(evidence)});
   if(!response.ok)throw Error('Enregistrement local de la preuve refusé.');
   setStatus(`PASS vidéo : ${video.videoWidth} × ${video.videoHeight} · durée ${duration.toFixed(2)} s · déplacement à 5 s · lecture et image vérifiées. Fichier généré, sans son ; aucun média de l’équipe.`);
  }catch(e){video.pause();setStatus(e instanceof Error?e.message:String(e));}
 }
 return <main style={{maxWidth:680,margin:'24px auto',padding:20}}><h1>Connecteur — recette locale réelle</h1><p>API réelle sur le poste ; dossier créé exclusivement pour ce test. Ce banc ne qualifie ni les installateurs ni Safari ni la liaison HTTPS du site public.</p><ConnectorSetup/><button onClick={()=>void search()}>Vérifier recherche et lecture du fichier fictif</button><button onClick={()=>void playback()}>Vérifier la vidéo générée et le déplacement dans le temps</button><p role="status" id="live-result">{status}</p><video ref={videoRef} controls muted playsInline style={{width:'100%'}}/></main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
