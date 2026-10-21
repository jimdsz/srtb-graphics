import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import AppUpdateNotice from '../src/studio/AppUpdateNotice';
import '../src/studio/studio.css';
import '../src/studio/workbench.css';
let latest='test0001';
const original=window.fetch.bind(window);
window.fetch=async(input,options)=>String(input)==='/graphics'?new Response(`<script src="/assets/studio-${latest}.js"></script>`,{headers:{'content-type':'text/html'}}):original(input,options);
function Bench(){const [revision,setRevision]=useState(0);return <main><h1>Un onglet conserve son brouillon</h1><label>Texte non enregistré<input defaultValue="Mon programme"/></label><button onClick={()=>{latest='test0002';setRevision(value=>value+1);}}>Simuler une publication</button><AppUpdateNotice key={revision}/></main>;}
createRoot(document.getElementById('root')!).render(<Bench/>);
