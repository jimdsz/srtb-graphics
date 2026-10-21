import {getTemplate,validateProjectData} from '../src/studio/domain';
import type {ProjectData} from '../src/studio/domain';
import {selectedMediaData} from '../src/studio/media-selection';
import {exportBroadcastVideo} from '../src/studio/video/export';
import {resolveLocalData} from '../src/studio/local-media';
export function syntheticVoice(){
 const samples=48000*5,bytes=new ArrayBuffer(44+samples*2),view=new DataView(bytes),text=(at:number,s:string)=>{for(let n=0;n<s.length;n++)view.setUint8(at+n,s.charCodeAt(n));};
 text(0,'RIFF');view.setUint32(4,36+samples*2,true);text(8,'WAVEfmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,48000,true);view.setUint32(28,96000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,samples*2,true);
 for(let n=0;n<samples;n++)view.setInt16(44+n*2,Math.round(Math.sin(n/48000*Math.PI*600)*6000),true);
 return URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));
}
export async function qualifyBASocialExport(data:ProjectData,label:string){
 const template=getTemplate('BTV_BA_1P');
 const result=await exportBroadcastVideo(template,resolveLocalData(template,validateProjectData(template,selectedMediaData(template,data))),{format:'mp4',audio:true,manualOut:3.2,removeBackground:false,background:'#000000'},new AbortController().signal,()=>{});
 const url=URL.createObjectURL(result.blob),a=document.createElement('a');a.href=url;a.download=label+'.mp4';a.click();
 (window as any).disposeQualificationExport=async()=>{URL.revokeObjectURL(url);await result.dispose();};
 return result.report;
}
