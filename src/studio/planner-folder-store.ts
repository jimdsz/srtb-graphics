/** Local permissions only. Never stores file bytes or sends a handle to the API.
 * A blocked database, failed clone or aborted transaction must settle the UI. */
export function folderStore(mode:IDBTransactionMode,action:(store:IDBObjectStore)=>IDBRequest,options:{factory?:IDBFactory;timeoutMs?:number}={}){
 return new Promise<unknown>((resolve,reject)=>{
  let settled=false,db:IDBDatabase|undefined,tx:IDBTransaction|undefined;
  const finish=(error:unknown,value?:unknown)=>{
   if(settled)return;settled=true;clearTimeout(timer);
   if(error){try{tx?.abort();}catch{/* Already completed/aborted. */}}
   db?.close();error?reject(error):resolve(value);
  };
  const timer=setTimeout(()=>finish(Error('La mémoire locale ne répond pas. Reconnectez le dossier pour cette session.')),options.timeoutMs??5000);
  try{
   const request=(options.factory??globalThis.indexedDB).open('srtb-planner-folders',1);
   request.onerror=()=>finish(request.error||Error('Mémoire locale indisponible.'));
   request.onblocked=()=>finish(Error('La mémoire locale est bloquée par un autre onglet.'));
   request.onupgradeneeded=()=>{
    if(settled){request.transaction?.abort();return;}
    try{if(!request.result.objectStoreNames.contains('handles'))request.result.createObjectStore('handles');}
    catch(error){try{request.transaction?.abort();}catch{/* Failed upgrade. */}finish(error);}
   };
   request.onsuccess=()=>{
    // IndexedDB open cannot be cancelled. Close a success arriving after timeout.
    db=request.result;if(settled){db.close();return;}
    db.onversionchange=()=>finish(Error('La mémoire locale a changé dans un autre onglet.'));
    try{
     tx=db.transaction('handles',mode);let value:unknown;
     tx.oncomplete=()=>finish(null,value);
     tx.onerror=tx.onabort=()=>finish(tx?.error||Error('Mémorisation locale interrompue.'));
     const operation=action(tx.objectStore('handles'));
     operation.onsuccess=()=>{value=operation.result;};
     operation.onerror=()=>finish(operation.error||Error('Mémorisation locale refusée.'));
    }catch(error){finish(error);}
   };
  }catch(error){finish(error);}
 });
}
