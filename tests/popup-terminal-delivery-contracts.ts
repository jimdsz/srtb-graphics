import {ALL_FORMATS,BlobSource,CanvasSink,Input} from 'mediabunny';
import {unzipSync,strFromU8} from 'fflate';
import {getTemplate} from '../src/studio/domain';
import type {ProjectData} from '../src/studio/domain';
import {exportBroadcastVideo} from '../src/studio/video/export';
import {frameFilename} from '../src/studio/video/sequence-format';

type Save=(name:string,body:Blob|string)=>Promise<void>;
type Factory=(id:string,format:string)=>ProjectData;
interface Box {x:number;y:number;width:number;height:number;alphaMax:number}

// Independent composite expectation, frames 246..266. The moving foreground
// comes from the frozen AE sequence. At 246–247 the required HTML popup-media
// window (manifest: x=1408, y=300, 392×220) is still open above the AE panel,
// hence their 392×440 union. This expectation does not call prepareGraphic.
const COMPOSITE_OUT_BOXES:(Omit<Box,'alphaMax'>|null)[]=[
  {x:1408,y:300,width:392,height:440},{x:1408,y:300,width:392,height:440},
  {x:1408,y:301,width:392,height:438},{x:1408,y:302,width:392,height:436},
  {x:1408,y:304,width:392,height:432},{x:1408,y:306,width:392,height:428},
  {x:1408,y:310,width:392,height:420},{x:1408,y:314,width:392,height:412},
  {x:1408,y:319,width:392,height:402},{x:1408,y:326,width:392,height:388},
  {x:1408,y:333,width:392,height:374},{x:1408,y:343,width:392,height:354},
  {x:1408,y:353,width:392,height:334},{x:1408,y:367,width:392,height:306},
  {x:1408,y:382,width:392,height:276},{x:1408,y:401,width:392,height:238},
  {x:1408,y:423,width:392,height:194},{x:1408,y:449,width:392,height:142},
  {x:1408,y:478,width:392,height:84},{x:1408,y:503,width:392,height:34},null,
];
// Empty SVG avoids depending on private/user media. The production `.btv-media`
// black fallback still makes the open HTML media window opaque by design; the
// independent composite expectation above includes that documented window.
const TRANSPARENT_MEDIA='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22392%22 height=%22220%22 viewBox=%220 0 392 220%22%3E%3C/svg%3E';

function box(canvas:CanvasImageSource):Box|null{
  const copy=document.createElement('canvas');copy.width=1920;copy.height=1080;const c=copy.getContext('2d',{willReadFrequently:true})!;c.drawImage(canvas,0,0);
  const rgba=c.getImageData(0,0,1920,1080).data;let x0=1920,y0=1080,x1=-1,y1=-1,alphaMax=0;
  for(let y=0;y<1080;y++)for(let x=0;x<1920;x++){const alpha=rgba[(y*1920+x)*4+3];alphaMax=Math.max(alphaMax,alpha);if(alpha>0){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}}
  copy.width=copy.height=0;return x1<0?null:{x:x0,y:y0,width:x1-x0+1,height:y1-y0+1,alphaMax};
}
function assertTail(kind:string,boxes:(Box|null)[]){
  if(boxes.length!==26)throw Error(`${kind} : 26 images OUT + tenue attendues, reçu ${boxes.length}.`);
  for(let i=0;i<COMPOSITE_OUT_BOXES.length;i++){
    const expected=COMPOSITE_OUT_BOXES[i],actual=boxes[i];
    if(!expected){if(actual)throw Error(`${kind} : l'image native 266 n'est pas transparente (${JSON.stringify(actual)}).`);continue;}
    if(!actual||actual.x!==expected.x||actual.width!==expected.width||Math.abs(actual.y-expected.y)>2||Math.abs(actual.height-expected.height)>2)throw Error(`${kind} : trajectoire différente à l'image native ${246+i} (${JSON.stringify(actual)} au lieu de ${JSON.stringify(expected)}).`);
  }
  for(let i=21;i<26;i++)if(boxes[i])throw Error(`${kind} : le post-roll ${i-20}/5 contient encore un élément visible.`);
}
async function pngBox(bytes:Uint8Array){const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));try{return box(bitmap);}finally{bitmap.close();}}

/** Real local MOV + PNG exports. No private media, upload, production write or
 * same-renderer reference: motion geometry is checked against the frozen AE data. */
export async function popupTerminalDeliveryContracts(dataFor:Factory,save:Save,status:(message:string)=>void,signal:AbortSignal){
  const template=getTemplate('BTV_PopUp'),data:ProjectData={...dataFor('BTV_PopUp','tv'),_studio_format:'tv',_out_mode:'duration',_out_duration_seconds:3.2,_background_visible:false,_media_background_url:'',_media_background_sequence:'[]',_media_popup_url:TRANSPARENT_MEDIA,_media_popup_sequence:'[]',_media_popup_audio_enabled:false};
  const stamp=Date.now(),records:any[]=[];
  for(const format of ['mov','png'] as const){
    signal.throwIfAborted();status(`Post-roll PopUp réel · ${format.toUpperCase()} · export local…`);let result:Awaited<ReturnType<typeof exportBroadcastVideo>>|undefined;
    const record:any={format,issues:[]};
    try{
      result=await exportBroadcastVideo(template,data,{format,manualOut:3.2,removeBackground:true,audio:false,background:'#000000'},signal,p=>status(`Post-roll PopUp ${format.toUpperCase()} · ${p.message}`));
      const filename=`popup-terminal-tail-${stamp}.${format==='mov'?'mov':'zip'}`;record.file=filename;record.report=result.report;await save(filename,result.blob);
      if(result.report.frames!==106||Math.abs(result.report.duration-4.24)>.001)throw Error(`${format} : 106 images / 4,24 s attendues, reçu ${result.report.frames} / ${result.report.duration}.`);
      const boxes:(Box|null)[]=[];
      if(format==='mov'){
        const input=new Input({formats:ALL_FORMATS,source:new BlobSource(result.blob)});
        try{const video=await input.getPrimaryVideoTrack();if(!video)throw Error('MOV : piste vidéo absente.');const sink=new CanvasSink(video,{alpha:true,poolSize:1});for(let frame=80;frame<106;frame++){signal.throwIfAborted();const decoded=await sink.getCanvas(frame/25+1e-7);if(!decoded)throw Error(`MOV : image ${frame} indécodable.`);boxes.push(box(decoded.canvas));}}
        finally{input.dispose();}
      }else{
        const files=unzipSync(new Uint8Array(await result.blob.arrayBuffer())),manifest=JSON.parse(strFromU8(files['SEQUENCE.json']));
        if(manifest.frames!==106||manifest.duration!==4.24)throw Error(`PNG : manifeste incorrect ${manifest.frames} / ${manifest.duration}.`);
        for(let frame=80;frame<106;frame++){signal.throwIfAborted();const bytes=files[frameFilename(frame)];if(!bytes)throw Error(`PNG : ${frameFilename(frame)} absent.`);boxes.push(await pngBox(bytes));}
      }
      assertTail(format.toUpperCase(),boxes);
      Object.assign(record,{outFrames:{export:[80,100],native:[246,266]},terminalHold:[101,105],boxes,result:'PASS'});
    }catch(error){signal.throwIfAborted();record.issues.push(error instanceof Error?error.stack||error.message:String(error));record.result='FAIL';}
    finally{await result?.dispose();records.push(record);}
  }
  const report=`popup-terminal-tail-${stamp}.json`;await save(report,JSON.stringify(records,null,2));if(records.some(record=>record.issues.length))throw Error(`Fin PopUp à examiner : ${report} · ${records.flatMap(record=>record.issues).join(' | ')}`);return {report,records};
}
