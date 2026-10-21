import {useEffect,useRef,useState} from 'react';
import {ALL_FORMATS,BlobSource,CanvasSink,Input} from 'mediabunny';
import {registerProresDecoder} from '@mediabunny/prores';
import Activity from './Activity';
import TimeRuler from './TimeRuler';

// Inspect the encoded file itself, not the template or a cached preview image.
// A single frame in flight bounds memory; closing the view disposes the decoder.
export default function ExportReview({blob,duration}:{blob:Blob;duration:number}){
  const canvas=useRef<HTMLCanvasElement>(null),sink=useRef<CanvasSink|null>(null),generation=useRef(0);
  const [position,setPosition]=useState(Math.min(duration-.04,Math.max(.04,duration*.4))),[busy,setBusy]=useState(true),[ready,setReady]=useState(false),[error,setError]=useState('');
  const [background,setBackground]=useState('checker');
  useEffect(()=>{
    const version=++generation.current;let input:Input|undefined;
    setBusy(true);setReady(false);setError('');
    void(async()=>{
      registerProresDecoder();
      input=new Input({formats:ALL_FORMATS,source:new BlobSource(blob)});
      const track=await input.getPrimaryVideoTrack();
      if(!track||!await track.canDecode())throw Error('Le fichier ne peut pas être relu par ce navigateur.');
      if(version!==generation.current)return;
      sink.current=new CanvasSink(track,{alpha:true,poolSize:1});setReady(true);
    })().catch(e=>{if(version===generation.current){setError(e instanceof Error?e.message:String(e));setBusy(false);}});
    return()=>{generation.current++;sink.current=null;input?.dispose();};
  },[blob]);
  useEffect(()=>{
    const decoder=sink.current;if(!ready||!decoder)return;let disposed=false;
    setBusy(true);setError('');
    void decoder.getCanvas(position).then(frame=>{
      if(disposed)return;if(!frame)throw Error('Aucune image décodable à cet instant.');
      const target=canvas.current;if(!target)return;
      target.width=frame.canvas.width;target.height=frame.canvas.height;
      const ctx=target.getContext('2d')!;ctx.clearRect(0,0,target.width,target.height);ctx.drawImage(frame.canvas,0,0);
    }).catch(e=>{if(!disposed)setError(e instanceof Error?e.message:String(e));}).finally(()=>{if(!disposed)setBusy(false);});
    return()=>{disposed=true;};
  },[ready,position,blob]);
  return <section className="export-review" aria-label="Contrôle du fichier exporté">
    <h3>Contrôler le fichier exporté</h3><p>Inspection image par image du fichier calculé. Le damier représente la transparence ; il n’appartient pas au fichier. Cette inspection est silencieuse.</p>
    <canvas ref={canvas} className="export-review-canvas" aria-label="Image décodée du fichier exporté" style={background==='checker'?undefined:{backgroundImage:'none',backgroundColor:background}}/>
    {busy?<Activity label="Lecture d’une image du fichier"/>:null}
    {error?<p className="notice error" role="alert">{error}</p>:null}
    <TimeRuler label="Image du fichier exporté" value={position} duration={duration} onSeek={setPosition} disabled={busy||!ready}/>
    <label>Fond de contrôle<select value={background} onChange={e=>setBackground(e.target.value)}><option value="checker">Damier · transparence</option><option value="#ffffff">Blanc</option><option value="#000000">Noir</option></select></label>
  </section>;
}
