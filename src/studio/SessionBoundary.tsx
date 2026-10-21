import {useEffect,useRef} from 'react';
import type {ReactNode} from 'react';

/** Keeps drafts mounted only while server availability is uncertain. It grants
 * no access: API/export guards remain separate and a real 401 unmounts Suite. */
export default function SessionBoundary({children,suspended,error,checking,onRetry}:{children:ReactNode;suspended:boolean;error?:string;checking:boolean;onRetry:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null);
  const content=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const element=dialog.current;if(!element)return;
    if(suspended){for(const media of content.current?.querySelectorAll<HTMLMediaElement>('audio,video')||[])media.pause();if(!element.open)element.showModal();}
    else if(element.open)element.close();
    return()=>{if(element.open)element.close();};
  },[suspended]);
  return <>
    {error&&!suspended?<aside className="notice warning session-notice" role="alert"><p>{error}</p><p className="small">Le brouillon reste dans cet onglet. Aucun enregistrement ni renouvellement n’est présumé réussi.</p><button type="button" disabled={checking} onClick={onRetry}>{checking?'Vérification…':'Vérifier la connexion'}</button></aside>:null}
    <div ref={content} hidden={suspended} inert={suspended||undefined} className="session-protected-view">{children}</div>
    <dialog ref={dialog} className="native-dialog session-verification" aria-labelledby="session-verification-title" onCancel={event=>event.preventDefault()}><h2 id="session-verification-title">Vérification de connexion nécessaire</h2><p>La durée de votre session doit être confirmée. Votre brouillon reste en mémoire dans cet onglet ; l’espace privé et les actions sont suspendus.</p>{error?<p role="alert">{error}</p>:null}<p className="small">Gardez cet onglet ouvert. Si le serveur confirme l’expiration ou une révocation, vous devrez vous reconnecter.</p><button type="button" autoFocus disabled={checking} onClick={onRetry}>{checking?'Vérification…':'Réessayer le contrôle'}</button></dialog>
  </>;
}
