import {useEffect,useMemo,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import DerivationArchiveDownload from '../src/studio/DerivationArchiveDownload';
import {createDerivationArchiveTask,initialDerivationArchiveState,planDerivationArchive} from '../src/studio/derivation-archive';
import type {DerivationArchiveTask,DerivationArchiveState,DerivationArchiveDestination,DerivationArchiveDownloadLink} from '../src/studio/derivation-archive';
import {hasDerivationArchivePicker,openDerivationArchive} from '../src/studio/derivation-archive-save';
import type {DerivationExportItem,DerivationExportState} from '../src/studio/derivation-export-queue';
import type {Project} from '../src/studio/domain';
import type {VideoReport} from '../src/studio/video/export';
import '../src/studio/studio.css';

// Test-only entry: no router, authentication, project API, encoder or upload.
// Synthetic payloads are deterministic bytes, NOT playable media.
function entry(index:number,blob:Blob,filename:string,status:DerivationExportItem['status']='completed'):DerivationExportItem{
  return {key:`fixture-${index}`,project:{id:`fixture-project-${index}`,revision:1} as Project,
    options:{format:filename.endsWith('.mov')?'mov':'mp4',manualOut:12,audio:true,removeBackground:false,background:'#ffffff'},revisionSource:'initial',status,
    progress:{percent:status==='completed'?100:0,message:'Données du banc uniquement.'},
    result:status==='completed'?{blob,filename,report:{} as VideoReport,dispose:async()=>{throw Error('Le banc ne doit jamais disposer un résultat pendant la copie.');}}:undefined};
}
function fixture(mode:string):DerivationExportState{
  const items=Array.from({length:8},(_,index)=>{
    const bytes=new Uint8Array(512*1024);for(let offset=0;offset<bytes.length;offset++)bytes[offset]=(offset+index*29)%256;
    const filename=mode==='collisions'?(index%2?'SYNTHETIQUE.mp4':'synthetique.mp4'):`SYNTHETIQUE_${index+1}${index===7?'.mov':'.mp4'}`;
    const status=mode==='partial'&&index>2?(['failed','cancelled','pending'] as const)[index%3]:'completed';
    return entry(index,new Blob([bytes]),filename,status);
  });
  return {items,selectedKeys:items.map(item=>item.key),running:false,phase:'idle',currentKey:null};
}
function Fixture(){
  const [sources,setSources]=useState(()=>fixture('full')),[scenario,setScenario]=useState('full'),[state,setState]=useState<DerivationArchiveState>(initialDerivationArchiveState);
  const [direct,setDirect]=useState(false),[pause,setPause]=useState(false),[paused,setPaused]=useState(false),[error,setError]=useState(''),[changing,setChanging]=useState(false);
  const [links,setLinks]=useState<{key:string;url:string;filename:string}[]>([]),[download,setDownload]=useState<DerivationArchiveDownloadLink|null>(null);
  const task=useRef<DerivationArchiveTask|null>(null),mounted=useRef(true),archiveUrl=useRef<string|null>(null),gate=useRef<(()=>void)|null>(null),sessionAbort=useRef<(()=>void)|null>(null),locked=useRef(false);
  const offer=useMemo(()=>{try{return {plan:planDerivationArchive(sources),reason:''};}catch(cause){return {plan:null,reason:String(cause)};}},[sources]);
  useEffect(()=>{
    const owned=sources.items.flatMap(item=>item.result?[{key:item.key,url:URL.createObjectURL(item.result.blob),filename:item.result.filename}]:[]);
    setLinks(owned);
    return()=>{const active=task.current;void Promise.resolve(active?.dispose()).finally(()=>{for(const item of owned)URL.revokeObjectURL(item.url);});};
  },[sources]);
  useEffect(()=>()=>{
    mounted.current=false;const oldTask=task.current,oldArchive=archiveUrl.current;
    // As in production, disposal settles before any owned URL is revoked.
    void oldTask?.dispose().finally(()=>{if(oldArchive)URL.revokeObjectURL(oldArchive);});
  },[]);
  async function replace(next:DerivationExportState,label:string){
    if(task.current?.running()||locked.current)return;locked.current=true;setChanging(true);
    try{await task.current?.dispose();task.current=null;if(archiveUrl.current)URL.revokeObjectURL(archiveUrl.current);archiveUrl.current=null;setDownload(null);setState(initialDerivationArchiveState);setError('');setScenario(label);setSources(next);}
    finally{locked.current=false;setChanging(false);}
  }
  async function completeSynthetic(){
    if(scenario!=='partial'||task.current?.running()||locked.current)return;locked.current=true;setChanging(true);
    try{
      await task.current?.dispose();task.current=null;
      const next=fixture('full');next.items=next.items.map((item,index)=>sources.items[index].result?sources.items[index]:item);
      // Model a successful retry without clearing the already prepared ZIP.
      setScenario('completed-after-partial');setSources(next);
    }finally{locked.current=false;setChanging(false);}
  }
  function pauseOneWrite(destination:DerivationArchiveDestination,signal:AbortSignal):DerivationArchiveDestination{
    let writes=0;
    return {...destination,sink:{...destination.sink,async write(bytes){
      // An explicit gate, not a timer: CUA can observe progress then cancel.
      if(++writes===2){
        setPaused(true);
        try{await new Promise<void>((resolve,reject)=>{
          const abort=()=>{cleanup();reject(signal.reason);},resume=()=>{cleanup();resolve();};
          const cleanup=()=>{signal.removeEventListener('abort',abort);if(gate.current===resume)gate.current=null;};
          signal.throwIfAborted();gate.current=resume;signal.addEventListener('abort',abort,{once:true});
        });}finally{if(mounted.current)setPaused(false);}
      }
      signal.throwIfAborted();await destination.sink.write(bytes);
    }}};
  }
  async function start(){
    if(locked.current||task.current?.running()||!offer.plan)return;setError('');
    if(!task.current){
      const own=createDerivationArchiveTask({onChange:value=>{if(mounted.current&&task.current===own)setState(value);},bindSession:controller=>{
        const abort=()=>controller.abort(new DOMException('Suspension simulée, banc local seulement.','AbortError'));sessionAbort.current=abort;
        return()=>{if(sessionAbort.current===abort)sessionAbort.current=null;};
      }});task.current=own;
    }
    const own=task.current,filename=`RECETTE_TECHNIQUE_NE_PAS_DIFFUSER_${offer.plan.files.length}sur${offer.plan.requestedCount}.zip`;
    const result=await own.run(offer.plan,signal=>{
      const opening=direct?openDerivationArchive(offer.plan!,filename,signal):openDerivationArchive(offer.plan!,filename,signal,{});
      return opening.then(destination=>pause?pauseOneWrite(destination,signal):destination);
    });
    if(result?.blob&&mounted.current&&task.current===own){
      const previous=archiveUrl.current,url=URL.createObjectURL(result.blob);archiveUrl.current=url;setDownload({url,filename,count:result.count,requestedCount:result.requestedCount,complete:result.complete});
      const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;anchor.click();if(previous)URL.revokeObjectURL(previous);
    }
  }
  const busy=state.running||changing;
  return <main style={{maxWidth:950,margin:'32px auto',padding:24}}>
    <h1>Banc local — récupération groupée</h1>
    <p className="notice warning">Aucun rendu, aucun téléversement, aucune fiche modifiée. Les fichiers synthétiques ne sont pas des vidéos lisibles. Les boutons ci-dessous ne sont présents que dans ce banc.</p>
    <section className="panel"><h2>Jeu local</h2>
      <label>Scénario <select aria-label="Scénario du banc" value={scenario==='local'?'local':scenario} disabled={busy} onChange={event=>void replace(fixture(event.target.value),event.target.value)}>
        <option value="full">Complet — 8/8 synthétiques</option><option value="partial">Partiel — 3/8 synthétiques</option><option value="collisions">Collisions — 8 noms identiques, casse différente</option>{scenario==='local'?<option value="local">Fichiers choisis explicitement sur ce poste</option>:null}{scenario==='completed-after-partial'?<option value="completed-after-partial">Complet après reprise — ancien ZIP conservé</option>:null}
      </select></label>
      <p><label>Ou choisir 1 à 8 fichiers déjà calculés sur ce poste <input type="file" multiple disabled={busy} onChange={event=>{
        const files=Array.from(event.currentTarget.files??[]);event.currentTarget.value='';
        if(!files.length)return;if(files.length>8){setError('Le banc accepte au maximum huit fichiers. Les sources précédentes sont conservées.');return;}
        const items=files.map((file,index)=>entry(index,file,file.name));void replace({items,running:false,phase:'idle',selectedKeys:items.map(item=>item.key),currentKey:null},'local');
      }}/></label></p>
      <p className="small">Leur nom et leur empreinte figurent uniquement dans le ZIP local. Aucun accès automatique au dossier Téléchargements.</p>
      {scenario==='partial'?<p><button type="button" disabled={busy} onClick={()=>void completeSynthetic()}>Simuler la réussite des cinq fichiers manquants — conserver l’ancien ZIP</button></p>:null}
      <label><input type="checkbox" checked={direct} disabled={busy||!hasDerivationArchivePicker()} onChange={event=>setDirect(event.target.checked)}/> Utiliser le sélecteur disque réel (sinon fallback mémoire de 128 Mio)</label><br/>
      <label><input type="checkbox" checked={pause} disabled={busy} onChange={event=>setPause(event.target.checked)}/> Suspendre explicitement la deuxième écriture, pour tester l’annulation</label>
      {paused?<p role="status">Copie suspendue par le banc. <button type="button" onClick={()=>gate.current?.()}>Continuer la copie</button></p>:null}
      {state.running?<button type="button" onClick={()=>sessionAbort.current?.()}>Simuler une suspension de session (banc)</button>:null}
      {error?<p role="alert">{error}</p>:null}
    </section>
    <DerivationArchiveDownload plan={offer.plan} reason={offer.reason} state={state} directSave={direct} disabled={changing} onDownload={()=>void start()} onCancel={()=>task.current?.cancel()} download={download}/>
    <section className="panel"><h2>Liens individuels conservés</h2><ul>{links.map(link=><li key={link.key}><a href={link.url} download={link.filename}>{link.filename}</a></li>)}</ul></section>
    <pre id="archive-evidence" aria-label="État mesuré du banc">{JSON.stringify({scenario,requested:sources.items.length,included:offer.plan?.files.length??0,individualLinks:links.length,phase:state.phase,progress:state.progress,paused,archiveAvailable:!!download},null,2)}</pre>
  </main>;
}
if(!['localhost','127.0.0.1','[::1]'].includes(location.hostname))throw Error('Ce banc est strictement local.');
createRoot(document.getElementById('root')!).render(<Fixture/>);
