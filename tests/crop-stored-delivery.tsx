import {useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ALL_FORMATS,BlobSource,CanvasSink,Input} from 'mediabunny';
import {api} from '../src/studio/api';
import {getTemplate,templateDefaults} from '../src/studio/domain';
import type {Project,ProjectData} from '../src/studio/domain';
import {bindLocalFile,resolveLocalData} from '../src/studio/local-media';
import MediaCrop from '../src/studio/MediaCrop';
import Preview from '../src/studio/Preview';
import {sampleProof} from '../src/studio/video/frame-proof';
import type {SampleProof} from '../src/studio/video/frame-proof';
import {exportBroadcastVideo} from '../src/studio/video/export';
import '../src/studio/studio.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';

// Only the actual localhost API/D1 is used. No mocks, production credentials or
// private assets. Media bytes stay in the selected File / local blob registry.
const template=getTemplate('BTV_BA_TDS');
function ensure(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
function App(){
  const [data,setData]=useState<ProjectData>(),[project,setProject]=useState<Project>(),[key,setKey]=useState(0),[busy,setBusy]=useState(false),[status,setStatus]=useState('Créer le brouillon de test local.'),[report,setReport]=useState(''),[captures,setCaptures]=useState<{seconds:number;proof:SampleProof;url:string}[]>([]);
  const host=useRef<HTMLDivElement>(null),abort=useRef<AbortController|undefined>(undefined);
  function local(){ensure(location.origin==='http://127.0.0.1:5192','Recette réservée au serveur local 5192.');}
  async function perform(action:()=>Promise<void>){setBusy(true);try{local();await action();}catch(error){setStatus('FAIL — '+String(error));}finally{setBusy(false);}}
  async function create(){
    const response=await fetch('/preview-media/v1/ba-programme.mp4');ensure(response.ok,'Source publique locale absente.');
    const media=await bindLocalFile(new File([await response.blob()],'recette-cadrage.mp4',{type:'video/mp4'}),()=>{});
    const d:ProjectData={...templateDefaults(template),_studio_format:'vertical',_out_mode:'duration',_out_duration_seconds:15.28,_background_visible:true,_media_background_url:media,_media_background_start_seconds:1.24,_media_background_end_seconds:6.24,_media_background_loop:true};
    for(const name of Object.keys(d))if(/audio.*enabled$/.test(name))d[name]=false;
    const created=await api.create(template.id,'Recette locale — cadrage sauvegardé',d);ensure(created.visibility==='private','Brouillon non privé.');
    setProject(created);setData(created.data);setStatus('Brouillon privé r1 créé localement. Déplacer les images et poser les repères.');
  }
  async function store(){
    ensure(project&&data,'Projet absent.');const stored=await api.save(project,project.title,data),reopened=await api.project(stored.id);
    for(const field of ['_studio_background_crop_motion','_studio_background_x','_studio_background_y','_media_background_url','_media_background_start_seconds','_media_background_end_seconds'])ensure(JSON.stringify(reopened.data[field])===JSON.stringify(data[field]),'Valeur perdue : '+field);
    ensure(reopened.visibility==='private'&&reopened.revision===project.revision+1,'Révision ou propriété incorrecte.');
    setProject(reopened);setData(reopened.data);setKey(k=>k+1);setCaptures([]);setStatus('PASS — enregistrement et relecture API réels. Inspecter puis mémoriser plusieurs images.');
  }
  function capture(){
    const canvas=host.current?.querySelector<HTMLCanvasElement>('.graphic-host > canvas'),g=Array.from(host.current?.querySelector('.graphic-host')?.children||[]).find(node=>'__previewTransport' in node) as HTMLElement&{__previewTransport:{snapshot:()=>{seconds:number;playing:boolean}}};
    ensure(canvas&&g,'Canvas social ou horloge absent.');const clock=g.__previewTransport.snapshot();ensure(!clock.playing,'Mettre en pause ou inspecter une image.');
    const proof=sampleProof(canvas,Math.round(clock.seconds*25)),thumb=document.createElement('canvas');thumb.width=200;thumb.height=Math.round(200*canvas.height/canvas.width);thumb.getContext('2d')!.drawImage(canvas,0,0,thumb.width,thumb.height);
    setCaptures(previous=>[...previous.filter(c=>c.proof.frame!==proof.frame),{seconds:clock.seconds,proof,url:thumb.toDataURL('image/png')}]);setStatus('Image réelle de l’aperçu mémorisée à '+clock.seconds.toFixed(2)+' s.');
  }
  async function deliver(){
    ensure(project&&data&&captures.length>=4,'Enregistrer puis inspecter au moins quatre images.');
    const persisted=await api.project(project.id);ensure(JSON.stringify(persisted.data)===JSON.stringify(data),'Enregistrer les réglages avant la livraison.');
    const beforeMedia=await api.media();abort.current=new AbortController();const controller=abort.current,timer=setTimeout(()=>controller.abort(new DOMException('Temps de recette dépassé','TimeoutError')),900000);
    let exported:Awaited<ReturnType<typeof exportBroadcastVideo>>|undefined;
    try{
      exported=await exportBroadcastVideo(template,resolveLocalData(template,persisted.data),{format:'mov',manualOut:15.28,audio:false,removeBackground:false,background:'#000000'},controller.signal,p=>setStatus(`${p.percent}% — ${p.message}`));
      const input=new Input({formats:ALL_FORMATS,source:new BlobSource(exported.blob)}),rows=[];
      try{
        const track=await input.getPrimaryVideoTrack();ensure(track,'Vidéo encodée absente.');const sink=new CanvasSink(track,{alpha:true,poolSize:1});
        for(const capture of captures){
          const decoded=await sink.getCanvas(capture.proof.frame/25);ensure(decoded,'Image encodée absente.');const actual=sampleProof(decoded.canvas,capture.proof.frame);let rgb=0,alpha=0;
          for(let i=0;i<actual.alpha.length;i++){alpha+=Math.abs(actual.alpha[i]-capture.proof.alpha[i]);for(let c=0;c<3;c++)rgb+=Math.abs(actual.rgb[i*4+c]-capture.proof.rgb[i*4+c]);}
          rgb/=actual.alpha.length*3;alpha/=actual.alpha.length;ensure(rgb<12&&alpha<3,`Aperçu différent du MOV à ${capture.seconds} : ${rgb}/${alpha}`);rows.push({seconds:capture.seconds,frame:capture.proof.frame,rgb,alpha});
        }
      }finally{input.dispose();}
      const after=await api.project(project.id);ensure(after.revision===persisted.revision&&JSON.stringify(after.data)===JSON.stringify(persisted.data),'L’export a modifié le projet.');ensure(JSON.stringify(await api.media())===JSON.stringify(beforeMedia),'Média téléversé.');
      const evidence={status:'PASS',scope:'Gestes MediaCrop → API/D1 local → réouverture → images Preview réelles → MOV décodé. Pas une validation Mac/Safari.',projectId:project.id,revision:after.revision,format:data._studio_format,settings:JSON.parse(String(data._studio_background_crop_motion)),export:exported.report,images:rows};
      setReport(JSON.stringify(evidence,null,2));const saved=await fetch(`/__video-evidence/crop-stored-delivery-${Date.now()}.json`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(evidence,null,2)});ensure(saved.ok,'Rapport local non enregistré.');setStatus('PASS — images réellement encodées conformes à l’aperçu après réouverture. Aucun média envoyé.');
    }finally{clearTimeout(timer);await exported?.dispose();abort.current=undefined;}
  }
  return <main style={{padding:24,maxWidth:1180,margin:'auto'}}><h1>Recadrage enregistré → aperçu → MOV local</h1><p>Vidéo de démonstration publique uniquement. Le brouillon de test est créé dans la base temporaire, pas sur le site.</p>
    <div className="row"><button disabled={busy||!!project} onClick={()=>void perform(create)}>Créer le brouillon local</button><button disabled={busy||!data} onClick={()=>void perform(store)}>Enregistrer puis rouvrir</button><button disabled={busy||!data} onClick={()=>{try{capture();}catch(error){setStatus('FAIL — '+String(error));}}}>Mémoriser l’image affichée</button><button disabled={busy||captures.length<4} onClick={()=>void perform(deliver)}>Encoder et comparer le MOV</button><button disabled={!busy} onClick={()=>abort.current?.abort()}>Arrêter le contrôle</button></div>
    <p role="status">{status}</p>{data?<><label>Format de contrôle<select disabled={busy} value={String(data._studio_format)} onChange={e=>{setData({...data,_studio_format:e.target.value});setCaptures([]);}}><option value="vertical">9:16</option><option value="portrait">4:5</option></select></label>
      <div style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(260px,360px)',gap:20}}><div ref={host}><Preview key={key} template={template} data={data} onChange={setData} disabled={busy}/></div><div><MediaCrop key={key} template={template} value={data._media_background_url} kind="background" data={data} start={Number(data._media_background_start_seconds)} onPatch={patch=>setData(previous=>({...previous,...patch}))}/><pre aria-label="Repères conservés" style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(JSON.parse(String(data._studio_background_crop_motion)),null,2)}</pre></div></div></>:null}
    <div style={{display:'flex',flexWrap:'wrap',gap:12}}>{captures.map(c=><figure key={c.proof.frame}><img src={c.url} width={200}/><figcaption>{c.seconds.toFixed(2)} s</figcaption></figure>)}</div><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{report}</pre></main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
