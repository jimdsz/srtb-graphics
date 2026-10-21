import {getDocument,PDFWorker} from 'pdfjs-dist';
import workerURL from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {PDF_SCHEDULE_LIMITS,parsePDFSchedule} from './day-planner-pdf';
import type {PDFSchedulePage,PDFScheduleText} from './day-planner-pdf';
import type {ScheduleSheet} from './day-planner-import';

/** Loaded only after selecting a PDF. PDF.js parses in a bundled local worker. */
export async function readPDFSchedule(buffer:ArrayBuffer,name:string,year:number,signal:AbortSignal):Promise<ScheduleSheet[]>{
 signal.throwIfAborted();
 if(buffer.byteLength>PDF_SCHEDULE_LIMITS.bytes)throw Error('Le PDF dépasse 10 Mo. Exportez uniquement les journées utiles.');
 if(!new TextDecoder('ascii').decode(buffer.slice(0,1024)).includes('%PDF-'))throw Error('Ce fichier n’est pas un PDF valide. Exportez à nouveau le conducteur en PDF ou en XLSX.');
 const port=new Worker(workerURL,{type:'module'}),worker=PDFWorker.create({port});
 // PDF.js 6 has removed dynamic font evaluation. We only request text; document
 // scripts, actions, attachments, images and external links are never evaluated.
 const loading=getDocument({data:new Uint8Array(buffer),worker,disableFontFace:true,useSystemFonts:false,useWorkerFetch:false,useWasm:false,isOffscreenCanvasSupported:false,stopAtErrors:true});
 let interrupt:(error:Error)=>void=()=>{};
 const interrupted=new Promise<never>((_resolve,reject)=>{interrupt=reject;});
 const abort=()=>interrupt(new DOMException('Import annulé.','AbortError'));
 const timeout=setTimeout(()=>interrupt(Error('Lecture du PDF trop longue. Exportez uniquement les journées utiles ou importez le XLSX.')),30000);
 const workerError=()=>interrupt(Error('La lecture locale du PDF a échoué. Réessayez ou importez le fichier XLSX.'));
 port.addEventListener('error',workerError);
 signal.addEventListener('abort',abort,{once:true});
 async function extract(){
  const document=await loading.promise;
  if(document.numPages>PDF_SCHEDULE_LIMITS.pages)throw Error('Ce PDF dépasse 30 pages. Exportez uniquement les journées utiles.');
  const pages:PDFSchedulePage[]=[];let itemsCount=0,characters=0;
  for(let number=1;number<=document.numPages;number++){
   signal.throwIfAborted();const page=await document.getPage(number),viewport=page.getViewport({scale:1}),content=await page.getTextContent();
   if(viewport.rotation%360!==0)throw Error('Ce PDF contient une page tournée. Exportez le conducteur dans son orientation de lecture avant import.');
   const items:PDFScheduleText[]=[];
   for(const item of content.items){
    if(!('str' in item))continue;
    itemsCount++;characters+=item.str.length;
    if(itemsCount>PDF_SCHEDULE_LIMITS.items||characters>PDF_SCHEDULE_LIMITS.characters)throw Error('PDF trop complexe. Exportez uniquement les journées utiles.');
    const [x,y]=viewport.convertToViewportPoint(item.transform[4],item.transform[5]);
    items.push({text:item.str,x,y,width:item.width,height:item.height});
   }
   pages.push({number,width:viewport.width,height:viewport.height,items});page.cleanup();
  }
  signal.throwIfAborted();return parsePDFSchedule(pages,name,year);
 }
 try{return await Promise.race([extract(),interrupted]);}catch(error){
  if(signal.aborted)throw new DOMException('Import annulé.','AbortError');
  if(error instanceof Error&&error.name==='PasswordException')throw Error('Ce PDF est chiffré ou protégé par un mot de passe. Exportez une copie PDF non protégée ou importez le XLSX.');
  if(error instanceof Error&&/^(InvalidPDFException|UnknownErrorException|FormatError)$/.test(error.name))throw Error('Ce PDF est endommagé ou son texte ne peut pas être lu. Exportez-le à nouveau en PDF avec texte sélectionnable ou en XLSX.');
  throw error;
 }finally{clearTimeout(timeout);signal.removeEventListener('abort',abort);port.removeEventListener('error',workerError);void loading.destroy().catch(()=>{});worker.destroy();port.terminate();}
}
