export type SessionEnd = 'expired' | 'logout';
export interface SessionState { epoch: number; ended: boolean; reason: SessionEnd | null; suspended: boolean }

/** UI lifecycle only. The HttpOnly cookie and server remain the authority. */
export function createSessionState() {
  let state: SessionState = {epoch: 0, ended: false, reason: null, suspended: false};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let deadline = 0;
  let expiryCheck: ((epoch:number)=>void) | undefined;
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };
  const clear = () => { clearTimeout(timer); deadline = 0; };
  const store = {
    snapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    onDeadline: (check:(epoch:number)=>void) => { expiryCheck=check;return()=>{if(expiryCheck===check)expiryCheck=undefined;}; },
    current: (epoch: number) => !state.ended && state.epoch === epoch,
    permitted: (epoch: number) => !state.ended && !state.suspended && state.epoch === epoch,
    // An action started before a suspension must never resume after it, even
    // when the same in-memory draft is subsequently unlocked by server proof.
    permission: () => { const token=state;return()=>state===token&&!state.ended&&!state.suspended; },
    suspend: () => {if(!state.ended&&!state.suspended){state={...state,suspended:true};notify();}},
    open: () => { clear(); state = {epoch: state.epoch + 1, ended: false, reason: null, suspended: false}; notify(); },
    end: (reason: SessionEnd, epoch = state.epoch) => {
      if (state.ended || state.epoch !== epoch) return false;
      clear(); state = {epoch: state.epoch + 1, ended: true, reason, suspended: false}; notify(); return true;
    },
    // Use a server-reported remaining lifetime, independent of the workstation clock.
    lifetime: (milliseconds: number, epoch: number) => {
      if (!store.current(epoch) || !Number.isFinite(milliseconds) || milliseconds < 0) return;
      const next = Date.now() + Math.min(milliseconds, 3600000);
      if (next <= deadline) {
        // BFCache wake-up still needs positive server proof even when its
        // remaining lifetime is a few milliseconds shorter than the old one.
        if(milliseconds>0&&state.suspended){state={...state,suspended:false};notify();}
        return;
      }
      deadline = next; clearTimeout(timer);
      if(milliseconds===0){
        deadline=0;
        if(expiryCheck){if(!state.suspended){state={...state,suspended:true};notify();}expiryCheck(epoch);}
        else store.end('expired',epoch);
        return;
      }
      if(milliseconds>0&&state.suspended){state={...state,suspended:false};notify();}
      timer = setTimeout(() => {
        if(!store.current(epoch))return;
        deadline=0;
        // Another tab may have renewed the shared HttpOnly cookie meanwhile.
        // Retain only the in-memory draft while checking; no actions are allowed
        // until the server confirms a positive remaining lifetime.
        if(expiryCheck){state={...state,suspended:true};notify();expiryCheck(epoch);}
        else store.end('expired',epoch);
      }, Math.max(0, deadline - Date.now()));
    },
  };
  return store;
}

export const sessionState = createSessionState();
const channelName = 'srtb-session-lifecycle-v1';

/** Only termination crosses tabs: never broadcast credentials or automatically log in. */
export function listenForSessionEnd() {
  if (typeof window === 'undefined') return () => {};
  let channel: BroadcastChannel | undefined;
  let receiving = false;
  const seen = new Set<string>();
  const receive = (data: unknown) => {
    if (!data || typeof data !== 'object' || !('reason' in data) || !('id' in data) || typeof data.id!=='string' || !['logout', 'expired'].includes(String(data.reason))) return;
    if(seen.has(data.id))return;seen.add(data.id);if(seen.size>100)seen.delete(seen.values().next().value!);
    receiving = true;
    try { sessionState.end(data.reason as SessionEnd); } finally { receiving = false; }
  };
  try { channel = new BroadcastChannel(channelName); channel.onmessage = event => receive(event.data); } catch { /* Storage event fallback. */ }
  const storage = (event: StorageEvent) => {
    if (event.key !== channelName || !event.newValue) return;
    try { receive(JSON.parse(event.newValue)); } catch { /* Ignore unrelated/malformed storage. */ }
  };
  window.addEventListener('storage', storage);
  const unsubscribe = sessionState.subscribe(() => {
    const state = sessionState.snapshot();
    if (!state.ended) return;
    window.dispatchEvent(new Event('srtb-local-media-clear'));
    // A local expiry estimate is not proof that another tab's renewed session
    // has expired. Each tab checks the server; only explicit logout is broadcast.
    if (receiving || state.reason!=='logout') return;
    const message = {reason: state.reason, id: crypto.randomUUID()};
    channel?.postMessage(message);
    try { localStorage.setItem(channelName, JSON.stringify(message)); } catch { /* Disabled storage: channel/polling remain available. */ }
  });
  return () => { unsubscribe(); channel?.close(); window.removeEventListener('storage', storage); };
}
