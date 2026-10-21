// Real component and real Firebase SDK. The browser runner intercepts network
// responses, never authentication modules. No real account or credential.
// The HTML no-referrer policy mirrors the production /auth/action response;
// this isolated fixture does not itself qualify that server response header.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import AccountRecovery from '../src/studio/AccountRecovery';

function Fixture(){
  const[actionURL]=useState(()=>window.location.href);
  const[returned,setReturned]=useState(false);
  return returned?<main><h1>Connexion de recette</h1><p>Retour local uniquement : aucun compte n’a été connecté.</p><button onClick={()=>{history.replaceState(null,'',actionURL);setReturned(false);}}>Rouvrir le lien de recette</button></main>:<AccountRecovery actionLink onBack={()=>setReturned(true)}/>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
