/** Abort the owning preview before releasing the UI: racing a timeout alone
 * would let a late engine update start playback in an abandoned instance. */
export function previewOperation<T>(run:()=>Promise<T>,signal:AbortSignal,onTimeout:()=>void,timeoutMs=60000):Promise<T>{
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(signal.reason);return;}
    let settled=false;
    const finish=(ok:boolean,value:unknown)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);if(ok)resolve(value as T);else reject(value);};
    const abort=()=>finish(false,signal.reason||new DOMException('Action interrompue.','AbortError'));
    const timer=setTimeout(()=>{onTimeout();finish(false,new Error('L’aperçu ne répond plus. Relancez-le ; vos réglages sont conservés.'));},timeoutMs);
    signal.addEventListener('abort',abort,{once:true});
    try{Promise.resolve(run()).then(value=>finish(true,value),error=>finish(false,error));}catch(error){finish(false,error);}
  });
}
