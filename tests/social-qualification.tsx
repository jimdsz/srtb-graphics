import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {broadcastTemplates,getTemplate,templateDefaults,validateProjectData} from '../src/studio/domain';
import {resolveLocalData} from '../src/studio/local-media';
import {selectedMediaData} from '../src/studio/media-selection';
import type {ProjectData} from '../src/studio/domain';
import {prepareGraphic} from '../src/studio/video/engine';
import {exportBroadcastVideo,videoExtension} from '../src/studio/video/export';
import {simpleBaDefaults} from '../src/studio/presentation';
import Fields from '../src/studio/Fields';
import Preview from '../src/studio/Preview';
import '../src/studio/studio.css';
import {catalogueCompositions,COMPOSITION_COUNT,MODEL_COUNT,SOCIAL_FORMATS,assertCompositionCoverage} from './catalogue-matrix';
const status=document.querySelector('#status')!,results=document.querySelector('#results')!,gallery=document.querySelector('#gallery')!;
document.querySelector('#frames')!.textContent=`Contrôler les ${COMPOSITION_COUNT} compositions TV et sociales`;
document.querySelector('#exports')!.textContent=`Exporter les ${COMPOSITION_COUNT} MP4 TV et sociaux`;
document.querySelector('#alpha')!.textContent='Contrôler MOV et PNG · 3 modèles ciblés, 2 formats sociaux';
let control:AbortController|undefined;
for(const [label,method]of [[`Contrôler les fondus et fins des ${COMPOSITION_COUNT} compositions`,'fadeEndContracts'],['Exporter et contrôler les dernières images · 6 modèles ciblés','fadeEndExports']] as const){const button=document.createElement('button');button.textContent=label;document.querySelector('#stop')!.after(button);button.onclick=()=>{if(control)return;control=new AbortController();void import('./fade-end-contracts').then(m=>m[method](dataFor,save,message=>status.textContent=message,control!.signal)).then(records=>{results.textContent=JSON.stringify(records,null,2);status.textContent=`PASS · ${records.length} cas exécutés · `+label;}).catch(error=>{status.textContent='ÉCHEC · '+(error instanceof Error?error.stack:String(error));}).finally(()=>{control=undefined;});};}
const ffmpegTest=document.createElement('button');ffmpegTest.textContent='Qualifier encodage local CBR';document.querySelector('#stop')!.after(ffmpegTest);ffmpegTest.onclick=()=>{if(control)return;control=new AbortController();void import('./ffmpeg-cbr-contracts').then(m=>m.ffmpegCbrContracts(save,message=>status.textContent=message,control!.signal)).then(records=>{results.textContent=JSON.stringify(records,null,2);status.textContent='PASS · qualification FFmpeg locale';}).catch(error=>{status.textContent='ÉCHEC · '+(error instanceof Error?error.stack:String(error));}).finally(()=>{control=undefined;});};
const cbrAudioTest=document.createElement('button');cbrAudioTest.textContent='Qualifier son et annulation CBR';document.querySelector('#stop')!.after(cbrAudioTest);cbrAudioTest.onclick=()=>{if(control)return;control=new AbortController();void import('./cbr-audio-contracts').then(m=>m.cbrAudioContracts(save,message=>status.textContent=message,control!.signal)).then(record=>{results.textContent=JSON.stringify(record,null,2);status.textContent='PASS · son, segments et annulation CBR';}).catch(error=>{status.textContent='ÉCHEC · '+(error instanceof Error?error.stack:String(error));}).finally(()=>{control=undefined;});};
const popupTailTest=document.createElement('button');popupTailTest.textContent='Qualifier fin PopUp MOV et PNG';document.querySelector('#stop')!.after(popupTailTest);popupTailTest.onclick=()=>{if(control)return;control=new AbortController();void import('./popup-terminal-delivery-contracts').then(m=>m.popupTerminalDeliveryContracts(dataFor,save,message=>status.textContent=message,control!.signal)).then(record=>{results.textContent=JSON.stringify(record,null,2);status.textContent='PASS · fin PopUp MOV et PNG';}).catch(error=>{status.textContent='ÉCHEC · '+(error instanceof Error?error.stack:String(error));}).finally(()=>{control=undefined;});};
const transportTest=document.createElement('button');transportTest.textContent='Contrôler pause et reprise des aperçus';document.querySelector('#stop')!.after(transportTest);transportTest.onclick=()=>{if(control)return;control=new AbortController();void import('./preview-transport-contracts').then(m=>m.previewTransportContracts(dataFor,save,message=>status.textContent=message,control!.signal)).then(records=>{results.textContent=JSON.stringify(records,null,2);status.textContent='PASS · pause et reprise';}).catch(error=>{status.textContent='ÉCHEC · '+(error instanceof Error?error.stack:String(error));}).finally(()=>{control=undefined;});};
const portableTest=document.createElement('button');portableTest.textContent='Contrôler les textes et polices embarqués';document.querySelector('#stop')!.after(portableTest);portableTest.onclick=()=>{if(control)return;control=new AbortController();void import('./typography-contracts').then(m=>m.portableTypographyContracts(dataFor,save,message=>status.textContent=message,control!.signal)).then(records=>{results.textContent=JSON.stringify(records,null,2);status.textContent='PASS · textes et polices portables';}).catch(error=>{status.textContent='ÉCHEC · '+(error instanceof Error?error.stack:String(error));}).finally(()=>{control=undefined;});};
const cbrTest=document.createElement('button');cbrTest.textContent='Mesurer les exports CBR 50 Mb/s';document.querySelector('#stop')!.after(cbrTest);cbrTest.onclick=()=>{if(control)return;control=new AbortController();void import('./opaque-bitrate-contracts').then(m=>m.opaqueBitrateContracts(save,message=>status.textContent=message,control!.signal)).then(records=>{results.textContent=JSON.stringify(records,null,2);status.textContent='PASS · mesure encodeur CBR';}).catch(error=>{status.textContent='ÉCHEC · '+String(error);}).finally(()=>{control=undefined;});};
const typographyExports=document.createElement('button');typographyExports.textContent='Exporter les textes personnalisés MP4 MOV';document.querySelector('#stop')!.after(typographyExports);typographyExports.onclick=()=>{if(control)return;control=new AbortController();void import('./typography-contracts').then(m=>m.typographyExports(dataFor,save,message=>status.textContent=message,control!.signal)).then(records=>{results.textContent=JSON.stringify(records,null,2);status.textContent='PASS · textes personnalisés MP4 MOV';}).catch(error=>{status.textContent='ÉCHEC · '+String(error);}).finally(()=>{control=undefined;});};
const typographyTest=document.createElement('button');typographyTest.textContent=`Contrôler l’éditeur des ${COMPOSITION_COUNT} compositions`;document.querySelector('#stop')!.after(typographyTest);typographyTest.onclick=()=>{if(control)return;control=new AbortController();void import('./typography-contracts').then(m=>m.typographyContracts(dataFor,save,message=>status.textContent=message,control!.signal)).then(records=>{results.textContent=JSON.stringify(records,null,2);status.textContent=`PASS · éditeur · ${records.length} compositions`;}).catch(error=>{status.textContent='ÉCHEC · '+String(error);}).finally(()=>{control=undefined;});};
const textTest=document.createElement('button');textTest.textContent='Contrôler la liberté du texte BA';document.querySelector('#stop')!.after(textTest);textTest.onclick=()=>{if(control)return;control=new AbortController();void import('./text-editor-contracts').then(m=>m.textEditorContracts(save,message=>status.textContent=message,control!.signal)).then(records=>{results.textContent=JSON.stringify(records,null,2);status.textContent='PASS · texte, parité, MP4 et MOV';}).catch(error=>{status.textContent='ÉCHEC · '+String(error);}).finally(()=>{control=undefined;});};
const timelineTest=document.createElement('button');timelineTest.textContent='Contrôler la réglette TV';document.querySelector('#stop')!.after(timelineTest);timelineTest.onclick=()=>{if(control)return;control=new AbortController();void import('./preview-timeline-contracts').then(m=>m.timelineContracts(dataFor,save,message=>status.textContent=message,control!.signal)).then(records=>{results.textContent=JSON.stringify(records,null,2);status.textContent='PASS · réglette TV';}).catch(error=>{status.textContent='ÉCHEC · '+String(error);}).finally(()=>{control=undefined;});};
const performanceTest=document.createElement('button');performanceTest.textContent=`Mesurer la lecture des ${MODEL_COUNT} modèles · ${COMPOSITION_COUNT} compositions`;document.querySelector('#stop')!.after(performanceTest);performanceTest.onclick=()=>{if(control)return;control=new AbortController();void import('./preview-performance').then(m=>m.measurePreviews(message=>status.textContent=message,save,control!.signal,dataFor)).then(records=>{results.textContent=JSON.stringify(records,null,2);status.textContent=`PASS · mesure de lecture · ${records.length} compositions`;}).catch(error=>{status.textContent='ÉCHEC · '+String(error);}).finally(()=>{control=undefined;});};
const save=async(name:string,body:Blob|string)=>{const response=await fetch('/__social-evidence/'+name,{method:'POST',body});if(!response.ok)throw Error(await response.text());};
const mediaContracts=document.createElement('button');mediaContracts.textContent='Contrôler les séquences médias';document.querySelector('#stop')!.after(mediaContracts);mediaContracts.onclick=()=>{if(control)return;control=new AbortController();void import('./ba-media-contracts').then(m=>m.baMediaContracts(control!.signal)).then(async records=>{results.textContent=JSON.stringify(records,null,2);await save('media-contracts-'+Date.now()+'.json',JSON.stringify(records,null,2));status.textContent='PASS · séquences médias';}).catch(error=>{status.textContent='ÉCHEC · '+String(error);}).finally(()=>{control=undefined;});};
const contracts=document.createElement('button');contracts.textContent='Contrôler options, TV et parité';document.querySelector('#stop')!.after(contracts);contracts.onclick=()=>{if(control)return;control=new AbortController();void import('./social-contracts').then(m=>m.socialContracts(dataFor,save,message=>status.textContent=message,control!.signal)).then(records=>{results.textContent=JSON.stringify(records,null,2);status.textContent='PASS · contracts';}).catch(error=>{status.textContent='ÉCHEC · '+String(error);}).finally(()=>{control=undefined;});};
const options=document.createElement('button');options.textContent='Extraire les options natives';document.querySelector('#assets')!.after(options);options.onclick=()=>void import('./social-native-assets').then(m=>m.extractOptions(save)).then(()=>{status.textContent='Options natives extraites';}).catch(e=>{status.textContent=String(e);});
document.querySelector('#assets')!.addEventListener('click',()=>void(async()=>{
  let animation:any,host:HTMLDivElement|undefined;
  try{
    status.textContent='Extraction du logo BTV depuis les tracés AE…';
    const base='/library/v1.7.0/BTV_BA_1P/',data=await fetch(base+'lib/lottie-template.json').then(r=>r.json());
    const comp=data.assets.find((a:any)=>a.nm==='BA_1P_RDV_Corps');comp.layers=comp.layers.filter((l:any)=>[15,16].includes(l.ind));data.layers=data.layers.filter((l:any)=>l.ind===24);
    const lottie=(await import(/* @vite-ignore */base+'lib/lottie-web.esm.mjs')).default;
    host=document.createElement('div');host.style.cssText='width:1920px;height:1080px;position:absolute;left:-20000px';document.body.append(host);
    animation=lottie.loadAnimation({container:host,renderer:'svg',loop:false,autoplay:false,animationData:data});
    await new Promise<void>((resolve,reject)=>{animation.addEventListener('DOMLoaded',()=>resolve());animation.addEventListener('data_failed',()=>reject(Error('Logo native failed')));});
    const {installLogoCompositing}=await import(/* @vite-ignore */base+'logo-compositing.mjs');installLogoCompositing(animation);animation.goToAndStop(250,true);
    const svg=host.querySelector('svg')!.cloneNode(true) as SVGElement;svg.setAttribute('xmlns','http://www.w3.org/2000/svg');
    const img=new Image();img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(svg));await img.decode();
    const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;const ctx=canvas.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(img,0,0);
    const rgba=ctx.getImageData(0,0,1920,1080).data;let x0=1920,y0=1080,x1=0,y1=0;for(let y=0;y<1080;y++)for(let x=0;x<1920;x++)if(rgba[(y*1920+x)*4+3]>1){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
    if(x1<=x0)throw Error('Logo vide');svg.setAttribute('viewBox',`${x0-1} ${y0-1} ${x1-x0+3} ${y1-y0+3}`);svg.setAttribute('width',String(x1-x0+3));svg.setAttribute('height',String(y1-y0+3));svg.removeAttribute('style');
    await save('btv-logo-corrected.svg',new XMLSerializer().serializeToString(svg));img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(svg));gallery.append(img);status.textContent='Logo BTV extrait sans modification des tracés.';
  }catch(error){status.textContent=String(error);}finally{animation?.destroy();host?.remove();}
})());
function dataFor(id:string,format:string):ProjectData{
  let data=templateDefaults(getTemplate(id));if(id==='BTV_BA_1P')data=simpleBaDefaults(data);
  data._studio_format=format;if(id==='BTV_Passerelle_Replay')data._replay_url='https://srtb.bj';
  if(id==='BTV_BA_1P'){data._out_mode='duration';data._out_duration_seconds=10;}
  const source='/library/v1.7.0/BTV_BA_1P/lib/media/programme.mp4';
  const track=(kind:string,start:number)=>Object.assign(data,{[`_media_${kind}_url`]:source,[`_media_${kind}_start_seconds`]:start,[`_media_${kind}_end_seconds`]:start+3,[`_media_${kind}_loop`]:true,[`_media_${kind}_audio_enabled`]:true});
  if(id==='BTV_PopUp')track('popup',10);
  if(id==='BTV_BA_TDS'){data._background_visible=true;track('background',10);}
  if(id==='BTV_BA_TDS_SUIVI_DE'){data._media_mode='internal';track('programme_1',10);track('programme_2',30);}
  if(id==='BTV_Ce_Soir')track('1',20);
  // Converted models intentionally ship without yesterday's programme media.
  // Give their tracks explicit local reference clips for the qualification,
  // otherwise a 30-case run could exercise only empty media surfaces.
  if(['BTV_Renvoi','BTV_Evenement','BTV_Semainier'].includes(id))for(const key of Object.keys(data).filter(key=>/^_media_.+_url$/.test(key)))track(key.slice(7,-4),10);
  return data;
}
async function run(mode:'frames'|'exports'|'alpha'){
  if(control)return;control=new AbortController();const records:unknown[]=[],stamp=Date.now();
  try{for(const {template:t,format} of catalogueCompositions(mode==='alpha'?SOCIAL_FORMATS:undefined)){
    if(mode==='alpha'&&!['BTV_Relais_Antenne','BTV_PopUp','BTV_BA_1P'].includes(t.id))continue;
    const data=dataFor(t.id,format),stem=t.id.toLowerCase().replaceAll('_','-')+'-'+format+'-'+stamp;
    if(mode==='frames'){
      status.textContent=t.name+' · '+format;let g;
      try{g=await prepareGraphic(t,data,Number(data._out_duration_seconds||12),false,control.signal);
        for(const [label,time]of [['in',3],['hold',Math.max(5,g.timeline.outAt-.04)],['out',g.timeline.outAt+g.timeline.timing.out/2]] as const){
          const frame=await g.frame(Math.round(time*25),null),blob=await new Promise<Blob>(r=>frame.toBlob(b=>r(b!)));
          await save(stem+'-'+label+'.png',blob);const figure=document.createElement('figure'),img=new Image();img.src=URL.createObjectURL(blob);const caption=document.createElement('figcaption');caption.textContent=t.name+' · '+format+' · '+label;figure.append(img,caption);gallery.append(figure);
        }records.push({id:t.id,format,frames:'PASS',timeline:g.timeline});
      }finally{await g?.dispose();}
    }else for(const encoding of mode==='alpha'?['mov','png'] as const:['mp4'] as const){
      const start=performance.now(),result=await exportBroadcastVideo(t,data,{format:encoding,audio:true,manualOut:Number(data._out_duration_seconds||12),removeBackground:mode==='alpha',background:'#000000'},control.signal,p=>status.textContent=t.id+' '+format+' '+p.message);
      try{const record={id:t.id,presentation:format,...result.report,seconds:(performance.now()-start)/1000};records.push(record);await save(stem+videoExtension(encoding).replace('_PNG','-png'),result.blob);await save(stem+'-'+encoding+'.json',JSON.stringify(record,null,2));}finally{await result.dispose();}
    }
    results.textContent=JSON.stringify(records,null,2);
  }if(mode==='frames')assertCompositionCoverage(records as {id:string;format:string}[]);status.textContent=`PASS · ${mode} · ${records.length} cas exécutés`;await save(mode+'-'+stamp+'.json',JSON.stringify(records,null,2));
  }catch(error){status.textContent='ÉCHEC · '+String(error);results.textContent=JSON.stringify(records,null,2);}finally{control=undefined;}
}
document.querySelector('#frames')!.addEventListener('click',()=>void run('frames'));
document.querySelector('#exports')!.addEventListener('click',()=>void run('exports'));
document.querySelector('#alpha')!.addEventListener('click',()=>void run('alpha'));
document.querySelector('#stop')!.addEventListener('click',()=>control?.abort());
function Editor(){
  const [id,setId]=useState('BTV_BA_1P'),[data,setData]=useState(dataFor(id,'vertical')),t=getTemplate(id);
  async function exportCurrent(format:'mp4'|'mov'='mp4'){
    if(control)return;control=new AbortController();let result;
    try{
      const start=performance.now(),resolved=resolveLocalData(t,validateProjectData(t,selectedMediaData(t,data)));
      result=await exportBroadcastVideo(t,resolved,{format,audio:true,manualOut:12,removeBackground:format==='mov',background:'#000000'},control.signal,p=>status.textContent=p.message);
      const stem='local-network-'+Date.now();await save(stem+'.'+format,result.blob);await save(stem+'.json',JSON.stringify({...result.report,seconds:(performance.now()-start)/1000},null,2));status.textContent='PASS · média local · '+JSON.stringify(result.report);
    }catch(error){status.textContent='ÉCHEC · '+String(error);}finally{await result?.dispose();control=undefined;}
  }
  return <><label>Modèle de test<select value={id} onChange={e=>{setId(e.target.value);setData(dataFor(e.target.value,'vertical'));}}>{broadcastTemplates.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><button onClick={()=>void exportCurrent()}>Exporter ce test MP4</button><button onClick={()=>void exportCurrent('mov')}>Exporter ce test MOV alpha</button><div className="editor-grid"><Preview key={id} template={t} data={data} onChange={setData}/><Fields template={t} data={data} media={[]} onChange={setData}/></div></>;
}
createRoot(document.querySelector('#editor')!).render(<Editor/>);
