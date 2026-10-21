import {useEffect,useId,useRef} from 'react';
import type {ReactNode} from 'react';

export default function CommercialDialog({title,busy=false,onClose,children}:{title:string;busy?:boolean;onClose:()=>void;children:ReactNode}){
  const ref=useRef<HTMLDialogElement>(null),id=useId();
  useEffect(()=>{
    const dialog=ref.current,previous=document.activeElement;
    dialog?.showModal();
    dialog?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return()=>{dialog?.close();if(previous instanceof HTMLElement&&previous.isConnected)previous.focus({preventScroll:true});};
  },[]);
  return <dialog ref={ref} className="commercial-dialog" aria-labelledby={id} aria-busy={busy} onCancel={event=>{event.preventDefault();if(!busy)onClose();}}>
    <h2 id={id}>{title}</h2>{children}
  </dialog>;
}
