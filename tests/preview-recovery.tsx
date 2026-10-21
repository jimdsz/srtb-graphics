// Isolated UI fixture. No production APIs, uploads or project mutations.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import Preview from '../src/studio/Preview';
import {getTemplate,templateDefaults} from '../src/studio/domain';
import '../src/studio/studio.css';
import '../src/studio/theme.css';
const original=window.fetch.bind(window);let stall=false,reads=0,aborted=0;
window.fetch=async(input,init)=>{
  const url=String(input instanceof Request?input.url:input);
  if(/\.(wav|mp3|mpeg)(\?|$)/i.test(url)){
    reads++;
    if(stall)return new Promise<Response>((_,reject)=>{
      const signal=init?.signal,stop=()=>{aborted++;reject(new DOMException('Lecture de test annulée','AbortError'));};
      if(signal?.aborted)stop();else signal?.addEventListener('abort',stop,{once:true});
    });
  }
  return original(input,init);
};
function Bench(){
  const template=getTemplate('BTV_BA_1P');
  const [data,setData]=useState(()=>({...templateDefaults(template),_audio_bed_enabled:true,_audio_voice_enabled:true}));
  const [blocked,setBlocked]=useState(false),[result,setResult]=useState('');
  return <main style={{padding:24,maxWidth:1100,margin:'auto'}}><h1>Annulation et réutilisation du son</h1>
    <label><input type="checkbox" checked={blocked} onChange={e=>{stall=e.target.checked;setBlocked(stall);}}/>Simuler un serveur audio qui ne répond pas</label>
    <button onClick={()=>setData(d=>({...d,_audio_bed_gain:Number(d._audio_bed_gain)===.5?.6:.5}))}>Modifier le volume de la musique</button>
    <button onClick={()=>setResult(JSON.stringify({reads,aborted,draftBedGain:data._audio_bed_gain}))}>Bilan des lectures</button><output>{result}</output>
    <Preview template={template} data={data}/></main>;
}
createRoot(document.getElementById('root')!).render(<Bench/>);
