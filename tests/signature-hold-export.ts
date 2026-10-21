import {ALL_FORMATS,CanvasSink,Input,UrlSource} from 'mediabunny';
import {getTemplate,templateDefaults} from '../src/studio/domain';
import {prepareGraphic} from '../src/studio/video/engine';

const run=document.querySelector<HTMLButtonElement>('#run')!,status=document.querySelector('#status')!,result=document.querySelector('#result')!;
function pixels(source:CanvasImageSource){const c=document.createElement('canvas');c.width=96;c.height=54;const ctx=c.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(source,0,0,96,54);return ctx.getImageData(0,0,96,54).data;}
const mae=(a:Uint8ClampedArray,b:Uint8ClampedArray)=>a.reduce((sum,value,i)=>sum+Math.abs(value-b[i]),0)/a.length;
run.onclick=async()=>{
  run.disabled=true;const controller=new AbortController(),signal=controller.signal,timer=setTimeout(()=>controller.abort(),180000),records:unknown[]=[];
  const url=new URL('/preview-media/v1/ba-programme.mp4',location.href).href,input=new Input({formats:ALL_FORMATS,source:new UrlSource(url)});
  try{
    if(location.origin!=='http://127.0.0.1:5192')throw Error('Recette locale uniquement.');
    const video=await input.getPrimaryVideoTrack();if(!video)throw Error('Vidéo absente.');const sink=new CanvasSink(video,{poolSize:1});
    for(const id of ['BTV_Semainier','BTV_Evenement']){
      const template=getTemplate(id),kind=id==='BTV_Semainier'?'final':'event',offset=id==='BTV_Semainier'?19.8:0;
      status.textContent=`${id} — préparation`;const prepared=await prepareGraphic(template,{...templateDefaults(template),_studio_format:'tv',_audio_enabled:false,_audio_voice_enabled:false,_out_mode:'duration',_out_duration_seconds:30,[`_media_${kind}_url`]:url},30,false,signal);
      try{
        let previous:Uint8ClampedArray|undefined;
        for(const seconds of [25.04,25.44,30.04,30.44]){
          status.textContent=`${id} — image à ${seconds} s`;
          const frame=await prepared.frame(Math.round(seconds*25),null),track=prepared.tracks[kind],node=track.clips[0].node as HTMLVideoElement;
          const sourceTime=seconds-offset,reference=await sink.getCanvas(sourceTime);if(!reference)throw Error('Référence absente.');
          const painted=pixels((track as unknown as {previewCanvas:HTMLCanvasElement}).previewCanvas),error=mae(painted,pixels(reference.canvas)),change=previous?mae(painted,previous):null;
          if(Math.abs(node.currentTime-sourceTime)>.002||error>2||(change!==null&&change<.01))throw Error(`Média non actualisé : ${id}, ${seconds}, source ${node.currentTime}, écart ${error}, mouvement ${change}`);
          records.push({id,seconds,sourceTime:node.currentTime,referenceError:error,change});previous=painted;
          const fig=document.createElement('figure'),img=document.createElement('img'),caption=document.createElement('figcaption'),thumb=document.createElement('canvas');thumb.width=240;thumb.height=135;thumb.getContext('2d')!.drawImage(frame,0,0,240,135);img.src=thumb.toDataURL('image/png');img.alt=`${id} ${seconds} s`;caption.textContent=img.alt;fig.append(img,caption);document.querySelector('#frames')!.append(fig);
        }
      }finally{await prepared.dispose();}
    }
    const report={status:'PASS',scope:'Images déterministes avant encodage, vrais médias, comparaison source indépendante ; pas une qualification Mac ni une lecture temps réel.',records};result.textContent=JSON.stringify(report,null,2);
    const saved=await fetch(`/__video-evidence/signature-hold-${Date.now()}.json`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report,null,2)});if(!saved.ok)throw Error('Rapport non enregistré.');status.textContent='PASS — les deux vidéos continuent pendant le maintien et la sortie.';
  }catch(error){status.textContent='FAIL — '+String(error);result.textContent=JSON.stringify({status:'FAIL',records,error:String(error)},null,2);}
  finally{clearTimeout(timer);input.dispose();run.disabled=false;}
};
