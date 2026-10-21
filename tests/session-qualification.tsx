import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import Suite from '../src/studio/Suite';
import {sessionState} from '../src/studio/session-state';
import '../src/studio/studio.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';
function Controls(){
  async function run(action:string){
    await fetch('/__session-test/'+action,{method:'POST'});
    if(action==='login'||action==='short')sessionState.open();
    else window.dispatchEvent(new Event('focus'));
  }
  return <aside style={{padding:10,borderBottom:'2px solid orange'}}><strong>Recette locale · comptes fictifs</strong>{['login','expire','short','outage','outage-renew','recover'].map(action=><button key={action} onClick={()=>void run(action)}>{({login:'Connexion fictive',expire:'Simuler expiration serveur',short:'Session de 30 secondes',outage:'Simuler panne réseau','outage-renew':'Panne 45 s · autre onglet renouvelé',recover:'Rétablir le service'})[action]}</button>)}</aside>;
}
createRoot(document.querySelector('#controls')!).render(<Controls/>);
createRoot(document.querySelector('#root')!).render(<StrictMode><Suite/></StrictMode>);
