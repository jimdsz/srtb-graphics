import {getTemplate} from '../src/studio/domain';
import type {Project} from '../src/studio/domain';
import {bindLocalFile,resolveLocalData} from '../src/studio/local-media';
import {plannerAPI} from '../src/studio/day-planner-api';
import {createPlannerQueue} from '../src/studio/day-planner-queue';
import type {Plan} from '../src/studio/day-planner-model';
import {weeklyChoices} from '../src/studio/planner-weekly';
import {prepareGraphic} from '../src/studio/video/engine';

const run=document.querySelector<HTMLButtonElement>('#run')!,cancel=document.querySelector<HTMLButtonElement>('#cancel')!,status=document.querySelector('#status')!,result=document.querySelector('#result')!,frames=document.querySelector('#frames')!;
const colours=[[187,41,51],[24,128,66],[36,100,187],[153,46,175],[188,112,29],[22,126,148],[150,155,35]];
const starts=[2.96,5.4,7.8,10.2,12.6,15,17.4],centres=[4.96,7.36,9.76,12.16,14.56,16.96,19.36];
let controller:AbortController|undefined;
function ensure(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
async function get<T>(path:string):Promise<T>{const response=await fetch('/api/graphics'+path);ensure(response.ok,`HTTP ${response.status}: ${path}`);return response.json();}
function imagePixels(frame:CanvasImageSource){const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;const context=canvas.getContext('2d',{willReadFrequently:true})!;context.drawImage(frame,0,0,160,90);return context.getImageData(0,0,160,90).data;}
function colourCounts(pixels:Uint8ClampedArray){
  const counts=colours.map(()=>0);
  for(let p=0;p<pixels.length;p+=4){if(pixels[p+3]<240)continue;const rgb=[pixels[p],pixels[p+1],pixels[p+2]],energy=rgb.reduce((n,v)=>n+v*v,0);if(energy<400)continue;
    let best=-1,error=Infinity;for(const [index,colour]of colours.entries()){
      const gain=rgb.reduce((n,v,i)=>n+v*colour[i],0)/colour.reduce((n,v)=>n+v*v,0);
      if(gain<.55||gain>1.15)continue;const delta=Math.sqrt(rgb.reduce((n,v,i)=>n+(v-colour[i]*gain)**2,0));if(delta<error){error=delta;best=index;}
    // Untagged H.264 witnesses can be decoded with different YUV matrices by
    // FFmpeg and WebCodecs. The seven hues remain distinct with this tolerance.
    }if(best>=0&&error<22)counts[best]++;
  }return counts;
}
const difference=(a:Uint8ClampedArray,b:Uint8ClampedArray)=>a.reduce((n,v,i)=>n+Math.abs(v-b[i]),0)/a.length;
cancel.onclick=()=>controller?.abort(new DOMException('Recette arrêtée','AbortError'));
run.onclick=async()=>{
  run.disabled=true;cancel.disabled=false;controller=new AbortController();const signal=controller.signal,records:unknown[]=[],stamp=Date.now(),timer=setTimeout(()=>controller?.abort(),300000);frames.replaceChildren();
  const originalFetch=window.fetch,apiWrites:{path:string;method:string}[]=[];
  try{
    ensure(location.origin==='http://127.0.0.1:5192','Base locale uniquement.');
    window.fetch=(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input),location.href),method=String(init?.method||(input instanceof Request?input.method:'GET')).toUpperCase();if(url.pathname.startsWith('/api/graphics/')&&!['GET','HEAD'].includes(method))apiWrites.push({path:url.pathname,method});return originalFetch.call(window,input,init);};
    const media=[];for(let i=1;i<=7;i++){
      signal.throwIfAborted();status.textContent=`Lecture du média témoin ${i}/7…`;
      const response=await fetch(`/tests/fixtures/weekly-witnesses-v2/media-${i}.mp4`,{signal});ensure(response.ok,'Source témoin absente');
      media.push(await bindLocalFile(new File([await response.blob()],`media-${i}.mp4`,{type:'video/mp4'}),()=>{},undefined,undefined,signal));
    }
    ensure(new Set(media.map(m=>m.url)).size===7,'Les sept témoins doivent être distincts.');
    const plan:Plan={kind:'plan',name:`Recette semainier sept médias ${stamp}`,source:'Sept témoins synthétiques',sourceHash:'7'.repeat(64),rows:media.map((source,i)=>({id:`witness-${i}`,sheet:'SEMAINE',cell:'A'+(i+1),raw:'',title:`PROGRAMME ${i+1}`,subtitle:`ÉPISODE ${i+1}`,category:'MAGAZINE',broadcastDate:`2026-09-${String(7+i).padStart(2,'0')}`,airDate:`2026-09-${String(7+i).padStart(2,'0')}`,time:`${19+i%3}:30`,duration:1800,included:true,kinds:['ba'],formats:['tv'],issues:[],media:source,location:null,excerpt:{source:source.url,start:1,end:5,duration:8}}))};
    plan.weekly={rowIds:plan.rows.map(r=>r.id),formats:['tv','portrait','vertical']};
    const beforeMedia=await get('/media'),saved=await plannerAPI.save(crypto.randomUUID(),0,plan,signal);
    const queue=await createPlannerQueue({record:saved,choices:weeklyChoices(plan),api:plannerAPI,signal,onProgress:p=>status.textContent=`Préparation : ${p.completed}/${p.total}`});
    ensure(queue.tasks.length===3,'Trois semainiers attendus.');
    ensure(new Set(queue.tasks.map(task=>task.projectId)).size===3,'Trois projets distincts attendus.');
    const formats=new Set<string>();
    for(const task of queue.tasks){
      const project=await get<Project>(`/projects/${task.projectId}`),template=getTemplate(project.template_id),format=String(project.data._studio_format);
      ensure(project.visibility==='private'&&template.id==='BTV_Semainier','Semainier privé attendu.');
      ensure(['tv','portrait','vertical'].includes(format)&&!formats.has(format),'Format répété ou inconnu.');formats.add(format);
      for(let i=0;i<7;i++)ensure((project.data[`_media_programme_${i+1}_url`] as {url:string}).url===media[i].url&&project.data[`programme_${i+1}_title`]===`PROGRAMME ${i+1}`,'Média ou titre réordonné.');
      const prepared=await prepareGraphic(template,resolveLocalData(template,project.data),23.32,false,signal);
      try{for(let slot=0;slot<7;slot++){
        let previous:Uint8ClampedArray|undefined;
        for(const seconds of [centres[slot]-.2,centres[slot]+.2]){
          signal.throwIfAborted();status.textContent=`${format} · programme ${slot+1}/7 · ${seconds.toFixed(2)} s`;
          const frame=await prepared.frame(Math.round(seconds*25),null),pixels=imagePixels(frame),counts=colourCounts(pixels),dominant=counts.indexOf(Math.max(...counts)),change=previous?difference(previous,pixels):null;
          const fig=document.createElement('figure'),image=document.createElement('img'),caption=document.createElement('figcaption'),thumb=document.createElement('canvas');
          thumb.width=240;thumb.height=Math.round(240*frame.height/frame.width);thumb.getContext('2d')!.drawImage(frame,0,0,thumb.width,thumb.height);image.src=thumb.toDataURL();image.alt=`${format} · programme ${slot+1} · ${seconds.toFixed(2)} s`;caption.textContent=image.alt;fig.append(image,caption);frames.append(fig);
          ensure(dominant===slot&&counts[slot]>160*90*.2,`Mauvais média visible ${format} P${slot+1}: ${counts}`);
          ensure(change===null||change>.05,`Image immobile ${format} P${slot+1}: ${change}`);
          const sourceSeconds=1+seconds-starts[slot],track=prepared.tracks[`programme_${slot+1}`],node=track.clips[0].node as HTMLVideoElement;
          if(format==='tv')ensure(Math.abs(node.currentTime-sourceSeconds)<.002,`Mauvais extrait P${slot+1}: ${node.currentTime} vs ${sourceSeconds}`);
          records.push({format,slot:slot+1,seconds,expectedSourceSeconds:sourceSeconds,actualSourceSeconds:format==='tv'?node.currentTime:null,counts,change});previous=pixels;
        }
      }}finally{await prepared.dispose();}
      const after=await get<Project>(`/projects/${project.id}`);ensure(after.revision===project.revision&&JSON.stringify(after.data)===JSON.stringify(project.data),'Rendu a modifié le projet.');
    }
    const again=await createPlannerQueue({record:saved,choices:weeklyChoices(plan),api:plannerAPI,signal,onProgress:()=>{}});
    ensure(again.tasks.length===3&&again.confirmedNew===0&&again.existing===3&&again.tasks.every(t=>queue.tasks.some(old=>old.key===t.key&&old.projectId===t.projectId)),'Reprise dupliquée.');
    ensure(JSON.stringify(await get('/media'))===JSON.stringify(beforeMedia),'Média envoyé au serveur.');
    ensure(apiWrites.every(write=>write.path===`/api/graphics/planner/${saved.id}`||write.path===`/api/graphics/planner/${saved.id}/tasks`),'Écriture API extérieure à la préparation.');
    const contact=document.createElement('canvas');contact.width=7*252;contact.height=2000;const brush=contact.getContext('2d')!;brush.fillStyle='#171b1d';brush.fillRect(0,0,contact.width,contact.height);brush.font='14px sans-serif';brush.fillStyle='white';
    const pictures=[...frames.querySelectorAll('img')];for(const [index,picture]of pictures.entries()){await picture.decode();const formatIndex=Math.floor(index/14),slot=Math.floor(index%14/2),sample=index%2,base=[0,330,980][formatIndex],height=[165,325,455][formatIndex],x=slot*252,y=base+sample*height;brush.drawImage(picture,x,y);brush.fillText(picture.alt,x,y+picture.naturalHeight+19);}
    const contactName=`planner-weekly-witnesses-${stamp}-contact.png`,contactBlob=await new Promise<Blob>(resolve=>contact.toBlob(blob=>resolve(blob!)));
    ensure((await fetch(`/__video-evidence/${contactName}`,{method:'POST',body:contactBlob})).ok,'Planche non enregistrée.');
    const report={status:'PASS',planId:saved.id,projects:queue.tasks.map(t=>t.projectId),scope:'API et D1 locaux, sept sources vidéo distinctes, images finales avant encodage, pas de Mac ni de temps réel',apiWrites,recovery:{existing:again.existing,confirmedNew:again.confirmedNew},contactName,records};result.textContent=JSON.stringify(report,null,2);
    const response=await fetch(`/__video-evidence/planner-weekly-witnesses-${stamp}.json`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report,null,2)});ensure(response.ok,'Rapport non enregistré.');status.textContent='PASS — 42 images, sept médias dans trois formats.';
  }catch(error){status.textContent='FAIL — '+String(error);result.textContent=JSON.stringify({status:'FAIL',records,error:String(error)},null,2);}
  finally{window.fetch=originalFetch;clearTimeout(timer);controller=undefined;run.disabled=false;cancel.disabled=true;}
};
