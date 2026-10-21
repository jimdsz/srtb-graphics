import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import ConnectorSetup from '../src/studio/ConnectorSetup';
import {disconnectConnector} from '../src/studio/connector-client';
import '../src/studio/studio.css';
import '../src/studio/theme.css';
// UI-only qualification. Synthetic replies; never contacts a real connector.
const original=window.fetch.bind(window);let requests=0,mode='available';
window.fetch=async(input,init)=>{
 if(typeof input!=='string'||!input.startsWith('http://127.0.0.1:43871/'))return original(input,init);
 requests++;const output=document.getElementById('requests');if(output)output.textContent=String(requests);
 if(mode==='absent')throw new TypeError('Connection refused (synthetic)');
 const route=new URL(input).pathname;
 if(route==='/v1/health')return Response.json({protocol:1,version:'0.1.0-test'});
 if(route==='/v1/pair')return JSON.parse(String(init?.body)).code==='123456ABCDEF'?Response.json({token:'a'.repeat(64),expires:Date.now()+60000}):Response.json({error:'Code invalide ou expiré.'},{status:403});
 if(route==='/v1/roots')return Response.json({roots:[{id:'77777777-7777-4777-8777-777777777777',name:'Médias partagés · tous les programmes',files:15001,partial:false,state:'ready',updatedAt:new Date().toISOString()}]});
 return Response.json({ok:true});
};
function App(){const [dark,setDark]=useState(true),[narrow,setNarrow]=useState(false),[key,setKey]=useState(0),[connected,setConnected]=useState(0);useEffect(()=>{document.documentElement.dataset.theme=dark?'dark':'light';},[dark]);return <main style={{padding:24,minHeight:'100vh',background:'var(--bg)',color:'var(--ink)'}}><h1>Connecteur · recette locale simulée</h1><p>Aucun disque réel. Code fictif : 123456ABCDEF. Requêtes : <output id="requests">0</output>. Connexions confirmées : {connected}.</p><div className="row"><button onClick={()=>setDark(v=>!v)}>Clair / sombre</button><button onClick={()=>setNarrow(v=>!v)}>Large / étroit</button><button onClick={()=>{disconnectConnector();mode='absent';setKey(v=>v+1);}}>Simuler absent</button><button onClick={()=>{mode='available';setKey(v=>v+1);}}>Simuler disponible</button></div><div style={{maxWidth:narrow?330:760,marginTop:24}}><ConnectorSetup key={key} onConnected={()=>setConnected(v=>v+1)}/></div></main>;}
createRoot(document.getElementById('root')!).render(<App/>);
