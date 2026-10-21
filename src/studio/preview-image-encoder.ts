/** One worker per publisher, opened lazily, with a single bounded request.
 * Canvas readback is explicit and measured; lossless packaging is off-thread.
 * This never imports or changes a delivery encoder. */
export class PreviewImageEncoder {
  private worker?:Worker;
  private serial=0;
  private pending?:{id:number;resolve:(blob:Blob)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>};
  private closed=false;
  encode(canvas:HTMLCanvasElement){
    if(this.closed)return Promise.reject(new Error('Aperçu fermé.'));
    if(this.pending)return Promise.reject(new Error('Une image est déjà en préparation.'));
    const pixels=canvas.getContext('2d',{willReadFrequently:true})!.getImageData(0,0,canvas.width,canvas.height);
    if(!this.worker){
      this.worker=new Worker(new URL('./preview-png.worker.ts',import.meta.url),{type:'module'});
      this.worker.onmessage=(event:MessageEvent<{id:number;png?:ArrayBuffer;error?:string}>)=>{
        const p=this.pending;if(!p||p.id!==event.data.id)return;clearTimeout(p.timer);this.pending=undefined;
        if(event.data.error||!event.data.png)p.reject(new Error(event.data.error||'Image d’aperçu manquante.'));
        else p.resolve(new Blob([event.data.png],{type:'image/png'}));
      };
      this.worker.onerror=()=>this.fail(new Error('Le traitement de l’image d’aperçu a échoué.'));
    }
    return new Promise<Blob>((resolve,reject)=>{
      const id=++this.serial,timer=setTimeout(()=>this.fail(new Error('Le traitement de l’image d’aperçu ne répond pas.')),15000);
      this.pending={id,resolve,reject,timer};
      try{this.worker!.postMessage({id,width:canvas.width,height:canvas.height,rgba:pixels.data.buffer},[pixels.data.buffer]);}
      catch(error){this.fail(error instanceof Error?error:new Error(String(error)));}
    });
  }
  private fail(error:Error){const p=this.pending;this.pending=undefined;if(p){clearTimeout(p.timer);p.reject(error);}this.worker?.terminate();this.worker=undefined;}
  dispose(){this.closed=true;this.fail(new Error('Aperçu fermé.'));}
}
