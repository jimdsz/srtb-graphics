import {getTemplate,templateDefaults} from '../src/studio/domain';
import type {ProjectData} from '../src/studio/domain';
import {prepareGraphic} from '../src/studio/video/engine';
import {FrameRaster} from '../src/studio/video/raster';

if(location.origin!=='http://127.0.0.1:5192')throw Error('Qualification locale uniquement.');
const button=document.querySelector<HTMLButtonElement>('#run')!,status=document.querySelector('#status')!,result=document.querySelector('#result')!,gallery=document.querySelector('#gallery')!;
const contract=new URL(location.href).searchParams.get('contract')==='before'?'before':'after';status.textContent=`Prêt — ${contract==='before'?'AVANT, configuration figée':'APRÈS, queue native complète'}.`;
const cases=[{id:'BTV_Evenement',fadeStart:443,hold:450,out:451,last:525,names:['TITRE 2 LIGNES HAUT','JOUR','Anim_TV_Roll','LOGO BENIN TV']},{id:'BTV_Semainier',fadeStart:581,hold:582,out:583,last:657,names:['7 JOURS','7 GENRES','BTV_to_BENINTV_Gauche']}];
function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
async function save(name:string,body:Blob|string){const response=await fetch('/__catalogue-visual-evidence/'+name,{method:'POST',headers:{'Content-Type':typeof body==='string'?'application/json':'image/png'},body});assert(response.ok,'Preuve non enregistrée : '+name);}
function copy(source:HTMLCanvasElement){const canvas=document.createElement('canvas');canvas.width=source.width;canvas.height=source.height;canvas.getContext('2d')!.drawImage(source,0,0);return canvas;}
async function capture(name:string,canvas:HTMLCanvasElement){
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('PNG indisponible.')),'image/png'));
  const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join('');await save(name,blob);
  const pixels=canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data;let visiblePixels=0,alphaSum=0;for(let i=3;i<pixels.length;i+=4){alphaSum+=pixels[i];if(pixels[i])visiblePixels++;}
  return {name,sha256,bytes:blob.size,visiblePixels,alphaSum};
}
function layers(animation:any,names:string[]){const found:any[]=[];const walk=(container:any)=>{for(const item of container.elements||[]){if(!item)continue;if(names.includes(item.data?.nm))found.push(item);walk(item);}};walk(animation.renderer);return found;}

button.onclick=async()=>{
  button.disabled=true;gallery.replaceChildren();const stamp=Date.now(),records:any[]=[],report:any={stamp,contract,scope:'Native hold and real manual/duration OUT methods with controlled clock; explicit before/after configuration; no real-time/device claim',comparisonCompleted:false,records};
  try{
    for(const item of cases)for(const mode of ['duration','manual']){
      const original=getTemplate(item.id),template=contract==='before'?{...original,module:original.module+'?ae-hold-baseline'}:original;
      const outFrame=contract==='before'?item.out:item.fadeStart,holdFrame=outFrame-1,tailFrames=item.last+1-outFrame,finish=(28*25+tailFrames)/25;
      const data:ProjectData={...templateDefaults(template),_studio_format:'tv',_out_mode:mode,_out_duration_seconds:28,_audio_enabled:false};
      for(const key of Object.keys(data))if(key.startsWith('_media_')&&key.endsWith('_url'))data[key]='';
      status.textContent=`${item.id} · ${mode} : préparation…`;const signal=new AbortController().signal,prepared=await prepareGraphic(template,data,28,false,signal),g=prepared.graphic;
      const raster=new FrameRaster(g.shadowRoot!,new URL(template.module,location.href).href,signal);await raster.prepare();
      const originalTime=g._time,animation=g.state?.animation||g.animation,observed=layers(animation,item.names),events:any[]=[];
      let seconds=25,completion:Promise<unknown>|undefined;
      const listener=(event:Event)=>events.push({...((event as CustomEvent).detail),seconds});g.addEventListener('broadcast-out',listener);
      const section=document.createElement('section'),heading=document.createElement('h2'),frames=document.createElement('div');heading.textContent=`${item.id} · ${mode==='manual'?'OUT manuel':'OUT retardé automatique'} à28 s`;frames.className='frames';section.append(heading,frames);gallery.append(section);
      const record:any={id:item.id,mode,requestedOutAt:28,contract,outDuration:tailFrames/25,sourceBoundary:{fadeStart:item.fadeStart,configuredOut:outFrame,held:holdFrame,last:item.last},poses:[],events};records.push(record);
      async function shot(label:string){
        const canvas=copy(await raster.draw(null)),prefix=`ae-hold-boundary-${contract}-${stamp}-${item.id.toLowerCase().replaceAll('_','-')}-${mode}-${label}`;
        const image=await capture(prefix+'.png',canvas),opacity=observed.map(element=>({name:element.data.nm,index:element.data.ind,layerOpacity:Number(getComputedStyle(element.layerElement).opacity)}));
        record.poses.push({label,seconds,sourceFrame:animation.currentFrame,phase:g.phase,outAt:g.outAt,stageVisibility:g.stage.style.visibility,opacity,image});
        const figure=document.createElement('figure'),caption=document.createElement('figcaption');caption.textContent=`${label} · source${animation.currentFrame} · ${opacity.map(x=>x.name+'='+x.layerOpacity).join(' ; ')}`;figure.append(caption,canvas);frames.append(figure);return image;
      }
      try{
        g.pause();g._time=()=>seconds;g.phase='onair';g.elapsed=seconds;g.stage.style.visibility='visible';
        animation.goToAndStop(item.fadeStart,true);g.__typography?.refresh();await shot('source-fade-start');
        g._draw(seconds,false);assert(g.frame===holdFrame,'Pose de maintien native inattendue.');await shot('hold-25s');
        seconds=27.96;g.elapsed=seconds;g._draw(seconds,false);assert(g.frame===holdFrame,'Le maintien change avant OUT.');await shot('hold-before-out');
        seconds=28;g.elapsed=seconds;
        if(mode==='manual'){
          const began=new Promise<void>(resolve=>{const once=(event:Event)=>{if((event as CustomEvent).detail?.phase==='stopping'){g.removeEventListener('broadcast-out',once);resolve();}};g.addEventListener('broadcast-out',once);});
          completion=g.stopAction();await began;g.pause();
        }else{g.playing=true;g._tick();g.pause();}
        assert(g.phase==='out'&&g.outAt===28&&g.frame===outFrame,'Déclenchement OUT natif inattendu.');await shot('out-start');
        seconds=28.32;g.elapsed=seconds;g._draw(seconds,false);await shot('out-plus-8-frames');
        seconds=(28*25+tailFrames-1)/25;g.elapsed=seconds;g._draw(seconds,false);assert(g.frame===item.last,'Dernière image OUT inattendue.');await shot('last-out-frame');
        seconds=finish;g.elapsed=seconds;g.playing=true;g._tick();g.pause();await completion;
        assert(g.phase==='stopped'&&g.stage.style.visibility==='hidden','Le moteur ne disparaît pas en fin de sortie.');
        const terminal=await shot('terminal-hidden');assert(terminal.visiblePixels===0,'Pixels encore présents après disparition terminale.');
      }finally{g._time=originalTime;g.removeEventListener('broadcast-out',listener);raster.dispose();await prepared.dispose();}
    }
    report.comparisonCompleted=true;status.textContent=`Comparaison ${contract} réalisée ; maintiens/fades à examiner. Disparitions terminales exactes contrôlées.`;
  }catch(error){report.error=error instanceof Error?error.stack:String(error);status.textContent='Comparaison interrompue : '+String(error);}
  finally{const name=`ae-hold-boundary-${contract}-${stamp}.json`;try{await save(name,JSON.stringify(report,null,2));report.localEvidence={diagnosticSaved:true,comparisonCompleted:report.comparisonCompleted,json:name};}catch(error){report.localEvidence={diagnosticSaved:false,error:String(error)};}result.textContent=JSON.stringify(report,null,2);button.disabled=false;}
};
