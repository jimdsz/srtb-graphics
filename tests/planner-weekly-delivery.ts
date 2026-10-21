import {ALL_FORMATS,AudioBufferSink,BlobSource,CanvasSink,Input} from 'mediabunny';
import {broadcastTemplates} from '../src/studio/domain';
import type {Project} from '../src/studio/domain';
import {bindLocalFile,resolveLocalData} from '../src/studio/local-media';
import {plannerAPI} from '../src/studio/day-planner-api';
import {createPlannerQueue} from '../src/studio/day-planner-queue';
import type {Plan} from '../src/studio/day-planner-model';
import {weeklyChoices} from '../src/studio/planner-weekly';
import {exportBroadcastVideo} from '../src/studio/video/export';

const run=document.querySelector<HTMLButtonElement>('#run')!,cancel=document.querySelector<HTMLButtonElement>('#cancel')!,status=document.querySelector<HTMLElement>('#status')!,result=document.querySelector<HTMLElement>('#result')!;
let controller:AbortController|undefined;
function ensure(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
async function get<T>(path:string):Promise<T>{const response=await fetch('/api/graphics'+path);ensure(response.ok,`HTTP ${response.status}: ${path}`);return response.json();}
cancel.onclick=()=>controller?.abort(new DOMException('Recette arrêtée','AbortError'));
run.onclick=async()=>{
  const records:unknown[]=[];let context:AudioContext|undefined,timer:ReturnType<typeof setTimeout>|undefined;
  run.disabled=true;cancel.disabled=false;controller=new AbortController();const signal=controller.signal;
  try{
    ensure(location.origin==='http://127.0.0.1:5192','Ce banc ne peut écrire que dans la base locale 5192.');
    const video=document.querySelector<HTMLInputElement>('#video')!.files?.[0],voice=document.querySelector<HTMLInputElement>('#voice')!.files?.[0];
    ensure(video&&voice,'Choisissez la vidéo et la voix.');
    status.textContent='Vérification locale des sources…';
    const source=await bindLocalFile(video,()=>{},undefined,undefined,signal),spoken=await bindLocalFile(voice,()=>{},undefined,undefined,signal);
    context=new AudioContext({sampleRate:48000});const reference=await context.decodeAudioData(await voice.arrayBuffer());
    const delay=1.2,voiceEnd=Math.floor(reference.duration*25)/25;
    const titles=['NTC','BUSINESS DES COMPLEMENTS ALIMENTAIRES','TENDANCE JEUNE','THE RIVER','THE RIVER','SERIE LITHAPO','FOOTBALL'];
    const plan:Plan={kind:'plan',name:'Recette locale — livraison du semainier',source:'Scénario issu de la grille 07–13 septembre, sans nouvel import',sourceHash:'f'.repeat(64),rows:titles.map((title,i)=>({id:'delivery-'+i,sheet:'SEMAINE',cell:'A'+(i+1),raw:'',title,subtitle:i===3?'EPS 94':i===4?'EPS 95':'',category:'Programme',broadcastDate:`2026-09-${String(i+7).padStart(2,'0')}`,airDate:`2026-09-${String(i+7).padStart(2,'0')}`,time:i===0?'09:00':'19:00',duration:1800,included:true,kinds:['ba'],formats:['tv'],issues:[],media:source,location:null,excerpt:{source:source.url,start:5+i,end:15+i,duration:66.88}}))};
    plan.weekly={rowIds:plan.rows.map(r=>r.id),formats:['tv','portrait','vertical'],voice:{source:spoken,sourceDuration:reference.duration,start:0,end:voiceEnd,cue:'Cette semaine',confirmed:true,placement:{mode:'single',delay}}};
    const beforeMedia=await get<unknown>('/media'),record=await plannerAPI.save(crypto.randomUUID(),0,plan,signal);
    const queued=await createPlannerQueue({record,choices:weeklyChoices(plan),api:plannerAPI,signal,onProgress:p=>status.textContent=`Création locale : ${p.completed}/${p.total}`});
    ensure(queued.tasks.length===3,'Trois projets attendus.');
    for(const [index,task]of queued.tasks.entries()){
      // The HD ProRes path is intentionally unchanged and may need several minutes.
      // Bound the qualification run without confusing encoding time with clip duration.
      signal.throwIfAborted();timer=setTimeout(()=>controller?.abort(new DOMException('Limite de 15 minutes par export de qualification','TimeoutError')),900000);
      const startedAt=performance.now();
      const project=await get<Project>(`/projects/${task.projectId}`),template=broadcastTemplates.find(t=>t.id===project.template_id)!;
      ensure(project.visibility==='private'&&project.revision===1&&template.id==='BTV_Semainier','Semainier privé r1 attendu.');
      const d=project.data,format=String(d._studio_format);
      ensure(d._audio_enabled===false&&d._audio_voice_enabled===true&&d._audio_voice_delay_seconds===delay,'Choix sonore incorrect.');
      for(let i=0;i<7;i++){ensure(d[`programme_${i+1}_title`]===titles[i],'Ordre des titres incorrect.');ensure(d[`_media_programme_${i+1}_start_seconds`]===5+i&&d[`_media_programme_${i+1}_end_seconds`]===15+i,'Passage modifié.');}
      const exported=await exportBroadcastVideo(template,resolveLocalData(template,d),{format:'mov',manualOut:23.32,removeBackground:false,audio:true,background:'#000000'},signal,p=>status.textContent=`${index+1}/3 · ${format} · ${p.percent}% · ${p.message}`);
      const input=new Input({formats:ALL_FORMATS,source:new BlobSource(exported.blob)});
      try{
        status.textContent=`${index+1}/3 · ${format} · Contrôle indépendant du son décodé…`;
        const audio=await input.getPrimaryAudioTrack();ensure(audio&&await audio.canDecode(),'Piste sonore indécodable.');
        const decoded=new Float32Array(Math.ceil(exported.report.duration*48000));
        for await(const item of new AudioBufferSink(audio).buffers()){
          signal.throwIfAborted();ensure(item.buffer.sampleRate===48000,'Cadence sonore inattendue.');
          const start=Math.round(item.timestamp*48000),samples=item.buffer.getChannelData(0);
          for(let n=0;n<samples.length;n++)if(start+n>=0&&start+n<decoded.length)decoded[start+n]=samples[n];
        }
        let aa=0,bb=0,ab=0,error=0,outside=0;const expected=reference.getChannelData(0),offset=Math.round(delay*48000),length=Math.round(voiceEnd*48000);
        for(let n=0;n<decoded.length;n++){const value=n>=offset&&n<offset+length?expected[n-offset]:0,difference=decoded[n]-value;aa+=decoded[n]**2;bb+=value**2;ab+=decoded[n]*value;error+=difference*difference;if(!value&&(n<offset-4800||n>offset+length+4800))outside=Math.max(outside,Math.abs(decoded[n]));}
        const correlation=ab/Math.sqrt(aa*bb),relativeError=Math.sqrt(error/bb);
        ensure(bb>1e-8&&correlation>.995&&relativeError<.02&&outside<.00001,'La voix encodée est tronquée, décalée, altérée ou accompagnée d’un son non choisi.');
        const track=await input.getPrimaryVideoTrack();ensure(track,'Piste vidéo absente.');const sink=new CanvasSink(track,{alpha:true,poolSize:1});
        for(const time of [5.16,7,20,26.28]){const frame=await sink.getCanvas(time);ensure(frame,'Image témoin absente.');const figure=document.createElement('figure'),image=document.createElement('img'),caption=document.createElement('figcaption');image.alt=`${format} à ${time} s`;const thumb=document.createElement('canvas');thumb.width=240;thumb.height=Math.round(240*frame.canvas.height/frame.canvas.width);thumb.getContext('2d')!.drawImage(frame.canvas,0,0,thumb.width,thumb.height);image.src=thumb.toDataURL('image/png');caption.textContent=image.alt;figure.append(image,caption);document.querySelector('#frames')!.append(figure);}
        const after=await get<Project>(`/projects/${project.id}`);ensure(after.revision===project.revision&&JSON.stringify(after.data)===JSON.stringify(d),'Projet modifié pendant le rendu.');
        records.push({projectId:project.id,format,elapsedMs:Math.round(performance.now()-startedAt),report:exported.report,voice:{file:voice.name,seconds:voiceEnd,delay,correlation,relativeError,outsidePeak:outside},status:'PASS'});
        result.textContent=JSON.stringify({status:'RUNNING',planId:record.id,records},null,2);
      }finally{input.dispose();await exported.dispose();clearTimeout(timer);}
    }
    ensure(JSON.stringify(await get('/media'))===JSON.stringify(beforeMedia),'Un média a été téléversé.');
    const again=await createPlannerQueue({record,choices:weeklyChoices(plan),api:plannerAPI,signal,onProgress:()=>{}});
    ensure(again.tasks.every(t=>queued.tasks.some(old=>old.projectId===t.projectId)),'La reprise a dupliqué les projets.');
    const report={status:'PASS',scope:'Plan réel/API locale/D1/projets privés/exports MOV décodés. Sources locales. Signature volontairement absente, mots non validés éditorialement, pas de qualification Mac.',planId:record.id,records};
    result.textContent=JSON.stringify(report,null,2);const saved=await fetch(`/__video-evidence/planner-weekly-delivery-${Date.now()}.json`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report,null,2)});ensure(saved.ok,'Rapport non enregistré.');
    status.textContent='PASS — trois fichiers complets, voix calée et aucun média envoyé. Les fichiers techniques ne sont pas des livrables antenne.';
  }catch(error){result.textContent=JSON.stringify({status:'FAIL',records,error:String(error)},null,2);status.textContent='FAIL — '+String(error);}
  finally{clearTimeout(timer);await context?.close();controller=undefined;run.disabled=false;cancel.disabled=true;}
};
