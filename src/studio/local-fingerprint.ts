// One background reader per page. Foreground preview/export may pause it;
// cancelling a task terminates its worker, including an outstanding disk read.
export type FingerprintStatus='queued'|'hashing'|'paused';
export type FingerprintWorker={
  onmessage:((event:{data:{progress?:number;hash?:string;error?:string}})=>void)|null;
  onerror:((event:unknown)=>void)|null;
  postMessage:(message:unknown)=>void;
  terminate:()=>void;
};
type Task={file:File;progress:(value:number)=>void;status:(value:FingerprintStatus)=>void;signal?:AbortSignal;resolve:(hash:string)=>void;reject:(error:unknown)=>void;abort:()=>void;done:boolean;worker?:FingerprintWorker};
const aborted=()=>new DOMException('Lecture annulée.','AbortError');

export function createFingerprintQueue(createWorker:()=>FingerprintWorker){
  const queue:Task[]=[];let running:Task|undefined,foreground=0;
  function finish(task:Task,error?:unknown,hash?:string){
    if(task.done)return;task.done=true;task.worker?.terminate();task.signal?.removeEventListener('abort',task.abort);
    const index=queue.indexOf(task);if(index>=0)queue.splice(index,1);if(running===task)running=undefined;
    if(error)task.reject(error);else task.resolve(hash!);pump();
  }
  function pump(){
    if(running||foreground)return;
    const task=queue[0];if(!task)return;running=task;
    try{
      const worker=createWorker();task.worker=worker;task.status('hashing');
      worker.onmessage=({data})=>{if(task.done)return;if(data.progress!==undefined)task.progress(data.progress);if(data.error)finish(task,Error(data.error));else if(data.hash){if(!/^[a-f0-9]{64}$/.test(data.hash))finish(task,Error('Empreinte du fichier local invalide.'));else finish(task,undefined,data.hash);}};
      worker.onerror=()=>finish(task,Error('Contrôle du fichier local impossible.'));
      worker.postMessage({type:'hash',file:task.file});
    }catch(error){finish(task,error);}
  }
  return {
    hash(file:File,progress:(value:number)=>void,signal?:AbortSignal,status:(value:FingerprintStatus)=>void=()=>{}){
      return new Promise<string>((resolve,reject)=>{
        const task:Task={file,progress,status,signal,resolve,reject,done:false,abort:()=>finish(task,aborted())};
        if(signal?.aborted){reject(aborted());return;}queue.push(task);signal?.addEventListener('abort',task.abort,{once:true});status('queued');
        // Let the immediate descriptor reach React and the preview before opening
        // a network-volume reader. All following bytes stay inside the worker.
        setTimeout(pump,0);
      });
    },
    prioritize(){
      foreground++;if(foreground===1&&running){running.status('paused');running.worker?.postMessage({type:'pause'});}
      let released=false;return()=>{if(released)return;released=true;foreground--;if(!foreground){if(running){running.status('hashing');running.worker?.postMessage({type:'resume'});}else pump();}};
    },
    cancelAll(){foreground++;try{for(const task of [...queue])finish(task,aborted());}finally{foreground--;}}
  };
}
