/** Preview-instance-only decoded audio. Nothing is persisted or shared across
 * accounts. Old engines may be disposed while the visible draft reuses a sound. */
export function previewAudioCache<T extends {length:number;numberOfChannels:number}>(maxBytes=48*1024*1024){
  const entries=new Map<string,T>();let bytes=0,closed=false;
  const size=(value:T)=>value.length*value.numberOfChannels*4;
  return {
    async load(url:string,signal:AbortSignal,reload:boolean,read:()=>Promise<T>):Promise<T>{
      signal.throwIfAborted();if(closed)throw new DOMException('Aperçu fermé.','AbortError');
      const cached=entries.get(url);
      if(cached&&!reload){entries.delete(url);entries.set(url,cached);return cached;}
      if(cached){bytes-=size(cached);entries.delete(url);}
      const value=await read();signal.throwIfAborted();
      if(closed)throw new DOMException('Aperçu fermé.','AbortError');
      const cost=size(value);
      if(cost<=maxBytes){
        while(bytes+cost>maxBytes&&entries.size){const [key,item]=entries.entries().next().value!;entries.delete(key);bytes-=size(item);}
        // Concurrent reads are uncommon but must not double-count a buffer.
        const previous=entries.get(url);if(previous)bytes-=size(previous);
        entries.set(url,value);bytes+=cost;
      }
      return value;
    },
    dispose(){closed=true;entries.clear();bytes=0;},
    get bytes(){return bytes;},
  };
}
