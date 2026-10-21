import catalogue from '../src/studio/catalogue.extensions.json';
import baseCatalogue from '../src/studio/catalogue.generated.json';
import type {BroadcastTemplate} from '../src/studio/domain';
import {previewEngineModule} from '../src/studio/preview-engine-module';
const output=document.querySelector<HTMLPreElement>('#status')!,host=document.querySelector<HTMLDivElement>('#preview')!,buttons=[...document.querySelectorAll('button')];
let sequence=0;
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const configure=(path='',mode='none',delayMs=0)=>fetch('/__network_fixture/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path,mode,delayMs})}).then(response=>{if(!response.ok)throw Error('Ouvrir cette page via le proxy local 5200.');});
async function instance(id:string,extra:Record<string,unknown>={}){
  const template=[...catalogue,...baseCatalogue].find(item=>item.id===id) as BroadcastTemplate;if(!template)throw Error('Modèle absent du catalogue de la fixture.');const module=await import(/* @vite-ignore */previewEngineModule(template)),tag='network-qa-'+(++sequence);customElements.define(tag,class extends module.default{});
  const graphic=document.createElement(tag) as any;graphic.style.cssText='display:block;width:100%;height:100%';host.replaceChildren(graphic);
  const data={...Object.fromEntries(Object.entries(template.fields).map(([key,field])=>[key,field.default??''])),...extra};for(const key of Object.keys(data))if(/_enabled$/.test(key)&&key.startsWith('_audio')&&!(key in extra))data[key]=false;
  return {graphic,load:()=>graphic.load({renderType:'realtime',previewMuted:true,data})};
}
async function retry(){
  buttons.forEach(button=>button.disabled=true);const rows:any[]=[];
  try{for(const id of ['BTV_Renvoi','BTV_Evenement','BTV_Semainier','BTV_Ce_Soir','BTV_Relais_Antenne','BTV_Passerelle_Replay']){
    window.dispatchEvent(new Event('srtb-local-media-clear'));const path=`/library/v1.7.0/${id}/lib/fonts/BeninSemiBold-Regular.otf`;await configure(path,'once-503');
    const first=await instance(id);let rejected='';try{await first.load();}catch(error){rejected=String(error);}await first.graphic.dispose();
    const second=await instance(id);await second.load();await second.graphic.goToTime({seconds:2});
    const logs=await fetch('/__network_fixture/log').then(response=>response.json()),resource=logs.filter((item:any)=>item.path===path);
    const row={id,firstRejected:rejected.includes('503'),retryPhase:second.graphic.phase,retried:resource.some((item:any)=>item.status===503)&&resource.some((item:any)=>item.status===200),errors:second.graphic.errors||[]};rows.push({...row,pass:row.firstRejected&&row.retried&&row.errors.length===0});
    await second.graphic.dispose();output.textContent=JSON.stringify({test:'503 puis reprise, même document',rows},null,2);
  }output.textContent=JSON.stringify({test:'503 puis reprise, même document',rows,pass:rows.every(row=>row.pass)},null,2);
  }catch(error){output.textContent=JSON.stringify({error:String(error),rows},null,2);}finally{await configure();buttons.forEach(button=>button.disabled=false);}
}
async function cancel(){
  buttons.forEach(button=>button.disabled=true);const rows:any[]=[];
  try{for(const scenario of [
    {name:'JSON',path:'/library/v1.7.0/BTV_Semainier/source/animation.json',extra:{}},
    {name:'Vidéo',path:'/preview-media/v1/ba-programme.mp4',extra:{_media_programme_1_url:{url:'/preview-media/v1/ba-programme.mp4',name:'Programme public',mimeType:'video/mp4'}}},
    {name:'Audio',path:'/library/v1.7.0/BTV_BA_TDS/lib/audio/BTV_BA TDS -23LUFS.wav',extra:{_audio_enabled:true,_audio_url:'/library/v1.7.0/BTV_BA_TDS/lib/audio/BTV_BA TDS -23LUFS.wav'}},
  ]){
    window.dispatchEvent(new Event('srtb-local-media-clear'));await configure(scenario.path,'delay',8000);const first=await instance('BTV_Semainier',scenario.extra);
    const pending=first.load().then(()=>({resolved:true}),error=>({error:String(error)}));
    let reached=false;const deadline=performance.now()+5000;while(performance.now()<deadline){const logs=await fetch('/__network_fixture/log').then(response=>response.json());if(logs.some((item:any)=>item.path===scenario.path)){reached=true;break;}await wait(30);}
    if(!reached)throw Error('Requête non atteinte : '+scenario.name);const before=performance.now();await first.graphic.dispose();const settlement=await pending,settledMs=performance.now()-before;await wait(50);
    const logs=await fetch('/__network_fixture/log').then(response=>response.json()),aborted=logs.some((item:any)=>item.path===scenario.path&&item.aborted);
    await configure();const second=await instance('BTV_Semainier',scenario.extra);await second.load();await second.graphic.goToTime({seconds:2});
    const row={resource:scenario.name,settledMs:Math.round(settledMs),aborted,settlement,oldPhase:first.graphic.phase,retryPhase:second.graphic.phase,pass:aborted&&settledMs<1000&&'error'in settlement&&first.graphic.phase==='disposed'};rows.push(row);await second.graphic.dispose();output.textContent=JSON.stringify({test:'Annulation avant réponse puis réouverture',rows},null,2);
  }output.textContent=JSON.stringify({test:'Annulation avant réponse puis réouverture',rows,pass:rows.every(row=>row.pass)},null,2);
  }catch(error){output.textContent=JSON.stringify({error:String(error),rows},null,2);}finally{await configure();buttons.forEach(button=>button.disabled=false);}
}
document.querySelector('#retry')!.addEventListener('click',()=>void retry());document.querySelector('#cancel')!.addEventListener('click',()=>void cancel());
output.textContent='Prêt — ressources publiques locales uniquement.';
