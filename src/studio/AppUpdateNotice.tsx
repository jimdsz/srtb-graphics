import {useEffect,useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {loadedStudioEntry,studioEntry} from './app-version';

/** Never reload an editor automatically: local edits and file permissions must
 * remain under the operator's control. This is not a session refresh. */
export default function AppUpdateNotice(){
  const [available,setAvailable]=useState(false);
  useEffect(()=>{
    const current=loadedStudioEntry();if(!current)return;
    let stopped=false,pending=false,last=0;const lifetime=new AbortController();
    async function check(){
      if(stopped||pending||document.hidden||Date.now()-last<60000)return;
      pending=true;last=Date.now();const abort=new AbortController(),cancel=()=>abort.abort();
      lifetime.signal.addEventListener('abort',cancel,{once:true});const timeout=setTimeout(cancel,10000);
      try{
        const response=await fetch('/graphics',{cache:'no-store',credentials:'same-origin',signal:abort.signal});
        if(!response.ok||!response.headers.get('content-type')?.includes('text/html'))return;
        const html=await response.text(),next=html.length<100000?studioEntry(html):null;
        if(!stopped&&next)setAvailable(next!==current);
      }catch{/* Offline/login failures are handled by the session, not an update banner. */}
      finally{pending=false;clearTimeout(timeout);lifetime.signal.removeEventListener('abort',cancel);}
    }
    void check();const timer=setInterval(()=>void check(),300000),visible=()=>void check();
    document.addEventListener('visibilitychange',visible);
    return()=>{stopped=true;lifetime.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
  },[]);
  if(!available)return null;
  return <aside className="app-update-notice" aria-label="Mise à jour disponible"><RefreshCw size={18} aria-hidden="true"/><div><strong>Une mise à jour de Graphics est disponible.</strong><span>Enregistrez votre projet avant d’actualiser cet onglet.</span></div><button onClick={()=>{if(window.confirm('Avez-vous enregistré vos modifications ? Actualiser ferme l’aperçu et recharge Graphics.'))window.location.reload();}}>Actualiser Graphics</button></aside>;
}
