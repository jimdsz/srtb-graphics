/** A single encoder/HTML engine at a time, shared by all export entry points. */
export function createRenderSlot(){
  let occupied=false;
  const listeners=new Set<()=>void>();
  const waiting:{signal:AbortSignal;resolve:(release:()=>void)=>void;reject:(error:unknown)=>void;cancel:()=>void}[]=[];
  const notify=()=>{for(const listener of listeners){try{listener();}catch{/* An observer cannot strand the encoder. */}}};
  function grant(){
    if(occupied)return;
    const next=waiting.shift();if(!next)return;
    next.signal.removeEventListener('abort',next.cancel);
    if(next.signal.aborted){next.reject(next.signal.reason);grant();return;}
    occupied=true;notify();let released=false;
    next.resolve(()=>{if(released)return;released=true;occupied=false;notify();grant();});
  }
  return {
    snapshot:()=>occupied,
    subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};},
    acquire:(signal:AbortSignal):Promise<()=>void>=>new Promise((resolve,reject)=>{
      if(signal.aborted){reject(signal.reason);return;}
      const entry={signal,resolve,reject,cancel:()=>{const i=waiting.indexOf(entry);if(i>=0){waiting.splice(i,1);reject(signal.reason);}}};
      waiting.push(entry);signal.addEventListener('abort',entry.cancel,{once:true});grant();
    }),
  };
}
export const renderSlot=createRenderSlot();
export async function withRenderSlot<T>(signal:AbortSignal,render:()=>Promise<T>){
  const release=await renderSlot.acquire(signal);
  if(typeof window!=='undefined')window.dispatchEvent(new Event('srtb-render-start'));
  try{signal.throwIfAborted();return await render();}
  finally{if(typeof window!=='undefined')window.dispatchEvent(new Event('srtb-render-end'));release();}
}
