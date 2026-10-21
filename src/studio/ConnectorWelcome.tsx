import {useEffect,useRef,useState} from 'react';
import {FolderLock,Link2,X} from 'lucide-react';
import {connectorRoots,hasConnectorSession,pairConnector} from './connector-client';
import {clearConnectorHandoff,pendingConnectorHandoff} from './connector-handoff';

export default function ConnectorWelcome({onConnected}:{onConnected:()=>void}){
 const [handoff,setHandoff]=useState(pendingConnectorHandoff),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const controller=useRef<AbortController|null>(null);
 useEffect(()=>()=>controller.current?.abort(),[]);
 if(!handoff)return null;
 function dismiss(){controller.current?.abort();controller.current=null;clearConnectorHandoff();setHandoff(null);}
 async function connect(){
  if(controller.current||!handoff)return;
  if(handoff.expires<=Date.now()){setError('La connexion a expiré. Cliquez à nouveau sur « Ouvrir Graphics » dans le connecteur.');return;}
  const current=new AbortController();controller.current=current;setBusy(true);setError('');
  try{if(!hasConnectorSession())await pairConnector(handoff.code,current.signal);await connectorRoots(current.signal);current.signal.throwIfAborted();dismiss();onConnected();}
  catch(reason){if(!current.signal.aborted)setError(reason instanceof Error?reason.message:'Connexion indisponible. Réessayez depuis le connecteur.');}
  finally{if(controller.current===current)controller.current=null;if(!current.signal.aborted)setBusy(false);}
 }
 return <section className="notice connector-welcome" aria-label="Connecter vos dossiers"><FolderLock size={24} aria-hidden="true"/><div><h2>Vos dossiers sont prêts à être connectés.</h2><p>Autorisez ce navigateur à rechercher et lire les médias des dossiers choisis. Aucun fichier envoyé ; aucune création de projet automatique.</p>{error?<p role="alert">{error}</p>:null}<div className="row wrap"><button className="primary" disabled={busy} onClick={()=>void connect()}><Link2 size={17} aria-hidden="true"/>{busy?'Connexion…':'Connecter mes dossiers et ouvrir À faire'}</button><button onClick={dismiss}><X size={16} aria-hidden="true"/>Plus tard</button></div></div></section>;
}
