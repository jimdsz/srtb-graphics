import {parseSchedule} from './day-planner-import';
self.onmessage=(event:MessageEvent<{buffer:ArrayBuffer;name:string;year:number}>)=>{
  try{self.postMessage({sheets:parseSchedule(event.data.buffer,event.data.name,event.data.year)});}
  catch(error){self.postMessage({error:error instanceof Error?error.message:'Lecture impossible. Choisissez un fichier XLSX enregistré dans Excel.'});}
};
