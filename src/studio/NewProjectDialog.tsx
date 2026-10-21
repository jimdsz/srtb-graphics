import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

export default function NewProjectDialog({ children, onClose, busy, labelledBy='create-heading' }: { children: ReactNode; onClose: () => void; busy: boolean; labelledBy?:string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current;
    const previousFocus = document.activeElement;
    if (node && !node.open) node.showModal();
    node?.querySelector<HTMLElement>('[data-dialog-autofocus]')?.focus();
    return () => {
      node?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);
  return <dialog className="modal native-dialog" ref={ref} aria-labelledby={labelledBy} aria-busy={busy} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}><button className="dialog-close icon-button" type="button" aria-label="Fermer" disabled={busy} onClick={onClose}><X size={20} /></button>{children}</dialog>;
}
