import {useEffect,useState,useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {LocalFileButton} from '../src/studio/LocalMedia';
import {getTemplate,templateDefaults,validateProjectData} from '../src/studio/domain';
import type {ProjectData} from '../src/studio/domain';
import {localURL,localMediaSnapshot,subscribeLocalMedia,promoteVerifiedLocalData,stableLocalData,pendingLocalReferences} from '../src/studio/local-media';

// Gate only the test worker's initial request. This makes the assertion independent
// of CPU/disk speed while keeping production worker code and real native playback.
const NativeWorker=window.Worker,workers:GatedWorker[]=[];
class GatedWorker extends NativeWorker{
  pending:unknown;released=false;
  constructor(url:string|URL,options?:WorkerOptions){super(url,options);workers.push(this);}
  postMessage(message:unknown){if(!this.released&&message&&typeof message==='object'&&'type'in message&&message.type==='hash'){this.pending=message;return;}super.postMessage(message);}
  release(){this.released=true;if(this.pending){super.postMessage(this.pending);this.pending=undefined;}}
}
window.Worker=GatedWorker;
const template=getTemplate('BTV_BA_1P');
const qa={data:templateDefaults(template),release(){workers.forEach(worker=>worker.release());},stable(){return validateProjectData(template,stableLocalData(template,this.data));}};
Object.assign(window,{fastLocalQA:qa});
function Test(){
  const [data,setData]=useState<ProjectData>(qa.data),[ready,setReady]=useState(false),[saved,setSaved]=useState(''),revision=useSyncExternalStore(subscribeLocalMedia,localMediaSnapshot);qa.data=data;
  useEffect(()=>{setData(current=>promoteVerifiedLocalData(template,current));},[revision]);
  const descriptor=data._audio_voice_url,url=typeof descriptor==='object'?localURL(descriptor.url):'';
  return <main><LocalFileButton kind="audio" onChoose={value=>{setReady(false);setData(current=>({...current,_audio_voice_url:value}));}}/>
    {url?<audio src={url} controls onLoadedMetadata={()=>setReady(true)}/>:null}
    <output data-testid="metadata">{ready?'ready':'waiting'}</output><output data-testid="verification">{pendingLocalReferences(template,data).length?'pending':'verified'}</output>
    <button onClick={()=>qa.release()}>Lancer la vérification différée</button><button onClick={()=>{try{qa.stable();setSaved('Référence stable acceptée');}catch{setSaved('Référence provisoire refusée');}}}>Contrôler la référence enregistrable</button><output data-testid="saved">{saved}</output>
  </main>;
}
createRoot(document.querySelector('#root')!).render(<Test/>);
