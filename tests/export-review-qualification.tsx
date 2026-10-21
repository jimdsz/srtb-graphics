import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Input,ALL_FORMATS,BlobSource} from 'mediabunny';
import ExportReview from '../src/studio/ExportReview';
import '../src/studio/studio.css';
import '../src/studio/responsive.css';
function Bench(){const [file,setFile]=useState<File|null>(null),[duration,setDuration]=useState(0),[error,setError]=useState('');return <main style={{maxWidth:800,margin:'32px auto',padding:24}}><h1>Contrôle local d’un export</h1><p>Fichier local uniquement. Aucun transfert cloud.</p><label>Fichier exporté<input type="file" accept=".mov,.mp4,.webm" onChange={e=>{const selected=e.target.files?.[0];if(!selected)return;setFile(null);setError('');const input=new Input({source:new BlobSource(selected),formats:ALL_FORMATS});void input.computeDuration().then(value=>{setDuration(value);setFile(selected);}).catch(e=>setError(String(e))).finally(()=>input.dispose());}}/></label>{error?<p role="alert">{error}</p>:null}{file?<ExportReview key={file.name} blob={file} duration={duration}/>:null}</main>;}
createRoot(document.getElementById('root')!).render(<Bench/>);
