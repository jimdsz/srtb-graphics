import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {api, ApiError} from './api';
import type {Member} from './domain';
import {listenForSessionEnd, sessionState} from './session-state';

export function useSession() {
  const session = useSyncExternalStore(sessionState.subscribe, sessionState.snapshot);
  const [identity, setIdentity] = useState<{member: Member; epoch: number} | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [checkingSession,setCheckingSession]=useState(false);
  const retry=useRef<()=>void>(()=>{});
  useEffect(listenForSessionEnd, []);
  useEffect(() => {
    if (session.ended) { setIdentity(null); setError(null); return; }
    let alive = true, checking = false;
    let stopSession: (() => void) | undefined;
    let requestController:AbortController|undefined;
    const current = () => alive && sessionState.current(session.epoch);
    const connected = (member: Member) => {
      if (current()) { setIdentity({member, epoch: session.epoch}); setError(null); }
    };
    const failed = (cause: unknown) => {
      if (!current()) return;
      const failure = cause instanceof ApiError ? cause : new ApiError(cause instanceof Error ? cause.message : String(cause), 0);
      if (failure.status === 401 || failure.status === 403) sessionState.end('expired', session.epoch);
      else setError(failure);
    };
    async function check() {
      if (!current() || checking) return;
      checking = true;setCheckingSession(true);requestController=new AbortController();
      const timeout=setTimeout(()=>requestController?.abort(new DOMException('Contrôle de connexion trop long. Réessayez.','TimeoutError')),12000);
      try {
        connected(await api.me(requestController.signal));
        // Never let a persisted Firebase identity resurrect a rejected server session.
        if (current() && !stopSession && !import.meta.env.VITE_STUDIO_QUALIFICATION) {
          const client = await import('./firebase-client');
          if (current()) stopSession = client.keepSession(connected, failed);
        }
      } catch (cause) { failed(cause); } finally { clearTimeout(timeout);checking = false;if(current())setCheckingSession(false); }
    }
    retry.current=()=>void check();
    const wake = () => { if (!document.hidden) void check(); };
    const hide = () => {if(current())sessionState.suspend();};
    const stopDeadline=sessionState.onDeadline(epoch=>{
      if(!current()||epoch!==session.epoch)return;
      void check();
    });
    const timer = setInterval(wake, 60000);
    window.addEventListener('focus', wake);
    window.addEventListener('pageshow', wake);
    window.addEventListener('pagehide',hide);
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);
    void check();
    return () => {
      alive = false;requestController?.abort();retry.current=()=>{};stopSession?.(); stopDeadline(); clearInterval(timer);
      window.removeEventListener('focus', wake); window.removeEventListener('pageshow', wake);
      window.removeEventListener('pagehide',hide);
      window.removeEventListener('online', wake); document.removeEventListener('visibilitychange', wake);
    };
  }, [session.epoch, session.ended]);
  return {member: !session.ended && identity?.epoch === session.epoch ? identity.member : null,
    error, signedOut: session.ended, reason: session.reason, suspended:session.suspended, checking:checkingSession, retry:()=>retry.current()};
}
