import {useEffect,useId,useRef} from 'react';

export default function FormExitPrompt({onContinue,onDiscard}:{onContinue:()=>void;onDiscard:()=>void}){
  const button=useRef<HTMLButtonElement>(null),id=useId();
  useEffect(()=>{const before=document.activeElement;button.current?.focus();return()=>{if(before instanceof HTMLElement&&before.isConnected)before.focus();};},[]);
  return <section className="form-exit-prompt notice warning" role="alertdialog" aria-labelledby={`${id}-heading`} aria-describedby={`${id}-help`} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onContinue();}}}>
    <h3 id={`${id}-heading`}>Conserver la saisie de cette fiche ?</h3><p id={`${id}-help`}>La fiche n’est pas enregistrée. Vous pouvez continuer à la modifier, ou quitter et abandonner cette saisie.</p>
    <div className="row wrap"><button ref={button} type="button" className="primary" onClick={onContinue}>Continuer la saisie</button><button type="button" onClick={onDiscard}>Quitter sans enregistrer</button></div>
  </section>;
}
