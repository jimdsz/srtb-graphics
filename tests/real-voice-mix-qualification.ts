import inventory from '../reports/local-voice-inventory-2026-09-23.json';
import {broadcastTemplates,templateDefaults} from '../src/studio/domain';
import type {ProjectData} from '../src/studio/domain';
import {prepareGraphic} from '../src/studio/video/engine';
import {audioEvents,mixAudio} from '../src/studio/video/audio';
import {baVoicePlacement} from '../src/studio/ba-voice-placement';

const input=document.querySelector<HTMLInputElement>('#files')!,button=document.querySelector<HTMLButtonElement>('#run')!;
const status=document.querySelector<HTMLElement>('#status')!,result=document.querySelector<HTMLElement>('#result')!;
const required=[
  {key:'day-time',name:'Mardi.mp3',template:'BTV_BA_1P'},
  {key:'tomorrow',name:'demain.mp3',template:'BTV_BA_1P'},
  {key:'today',name:"aujourdh'ui.mp3",template:'BTV_BA_1P'},
  {key:'tonight',name:'ce soir.mp3',template:'BTV_BA_1P'},
  {key:'now',name:'Tout de suite.mp3',template:'BTV_BA_TDS'},
] as const;

function ensure(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
function hex(bytes:ArrayBuffer){return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
function correlation(a:Float32Array,b:Float32Array){
  ensure(a.length===b.length&&a.length>128,'Fenêtre de comparaison audio invalide.');
  let ma=0,mb=0;for(let n=0;n<a.length;n++){ma+=a[n];mb+=b[n];}ma/=a.length;mb/=b.length;
  let dot=0,ea=0,eb=0;for(let n=0;n<a.length;n++){const x=a[n]-ma,y=b[n]-mb;dot+=x*y;ea+=x*x;eb+=y*y;}
  return dot/Math.sqrt(ea*eb);
}
function stableMatch(mixed:AudioBuffer,source:AudioBuffer,event:{at:number;start:number;duration:number;gain:(time:number)=>number}){
  const margin=Math.min(.22,event.duration*.2),duration=Math.min(.6,event.duration-margin*2),rate=48000;
  ensure(duration>.12,'Voix trop courte pour la comparaison indépendante.');
  const mixedStart=Math.round((event.at+margin)*rate),sourceStart=Math.round((event.start+margin)*source.sampleRate),frames=Math.round(duration*rate);
  const actual=mixed.getChannelData(0).slice(mixedStart,mixedStart+frames),expected=source.getChannelData(0).slice(sourceStart,sourceStart+frames);
  ensure(actual.length===frames&&expected.length===frames,'Voix incomplète dans le mixage.');
  return correlation(actual,expected);
}
function settings(id:string,url:string,duration:number):ProjectData{
  const template=broadcastTemplates.find(item=>item.id===id)!;const data=templateDefaults(template);
  for(const key of Object.keys(data)){
    if(/^_media_.+_audio_enabled$/.test(key))data[key]=false;
    if(/^_audio_.+_enabled$/.test(key))data[key]=false;
    if(/^_media_.+_sequence$/.test(key))data[key]='[]';
    if(/^_media_.+_url$/.test(key)&&data[key]){
      const prefix=key.slice(0,-4);data[key]='/library/v1.7.0/BTV_Ce_Soir/lib/media/programme.jpg';
      if(prefix+'_start_seconds' in data)data[prefix+'_start_seconds']=0;
      if(prefix+'_end_seconds' in data)data[prefix+'_end_seconds']=40;
      if(prefix+'_rate' in data)data[prefix+'_rate']=1;
    }
  }
  data._out_mode='duration';data._out_duration_seconds=id==='BTV_BA_TDS'?15.28:12;
  data._audio_voice_enabled=true;data._audio_voice_url=url;
  if(id==='BTV_BA_1P'){
    const placement=baVoicePlacement(duration,'fit-complete');
    data._studio_ba_mode='simple';data._studio_ba_voice_fit='fit-complete';
    data._audio_voice_in_seconds=0;data._audio_voice_out_seconds=duration;data._audio_voice_gain=1;
    data._audio_voice_intro_offset_seconds=placement.intro;data._audio_voice_outro_offset_seconds=placement.outro;
  }else{
    data._audio_voice_start_seconds=0;data._audio_voice_end_seconds=0;data._audio_voice_delay_seconds=.76;data._audio_voice_volume=1;
  }
  return data;
}

input.addEventListener('change',()=>{
  const names=new Set([...input.files||[]].map(file=>file.name));const missing=required.filter(item=>!names.has(item.name));
  button.disabled=missing.length>0;status.textContent=missing.length?`Fichiers manquants : ${missing.map(item=>item.name).join(', ')}`:'Cinq voix prêtes — aucun envoi.';
});

button.addEventListener('click',async()=>{
  button.disabled=true;input.disabled=true;const records:unknown[]=[],controller=new AbortController(),urls:string[]=[];let decode:AudioContext|undefined;
  try{
    ensure(location.origin==='http://127.0.0.1:5198','Recette réservée au serveur local 127.0.0.1:5198.');
    const files=new Map([...input.files!].map(file=>[file.name,file]));decode=new AudioContext({sampleRate:48000});
    for(const [index,item] of required.entries()){
      status.textContent=`${index+1}/5 · ${item.name} · vérification et mixage local`;
      const file=files.get(item.name)!;ensure(file,'Fichier manquant : '+item.name);
      const bytes=await file.arrayBuffer(),digest=hex(await crypto.subtle.digest('SHA-256',bytes));
      const expected=inventory.files.find(row=>row.name===item.name);ensure(expected&&digest===expected.sha256,'Fichier changé ou incorrect : '+item.name);
      const decoded=await decode.decodeAudioData(bytes.slice(0));ensure(decoded.sampleRate===48000,'Décodage autre que 48 kHz : '+item.name);
      const url=URL.createObjectURL(file);urls.push(url);const template=broadcastTemplates.find(value=>value.id===item.template)!;
      const prepared=await prepareGraphic(template,settings(item.template,url,decoded.duration),12,false,controller.signal);
      try{
        const events=audioEvents(prepared,item.template,false);ensure(events.length===(item.template==='BTV_BA_1P'?2:1),'Nombre inattendu de passages vocaux : '+item.name);
        ensure(events.every(event=>event.required),'Une piste non demandée participe au mixage : '+item.name);
        const mixed=await mixAudio(events,prepared.timeline.duration,controller.signal,message=>{status.textContent=`${index+1}/5 · ${item.name} · ${message}`;});
        ensure(mixed.audible,'Mixage muet : '+item.name);
        const source=events[0].buffer||decoded,correlations=events.map(event=>stableMatch(mixed.buffer,source,event));
        ensure(correlations.every(value=>value>.995),`La voix sélectionnée n’est pas retrouvée fidèlement dans le mixage : ${item.name}.`);
        records.push({key:item.key,file:item.name,sha256:digest,template:item.template,decodedSeconds:decoded.duration,events:events.map(event=>({at:event.at,start:event.start,duration:event.duration})),correlations:correlations.map(value=>Number(value.toFixed(6))),peak:Number(mixed.peak.toFixed(6)),audible:mixed.audible,status:'PASS'});
      }finally{await prepared.dispose();}
    }
    const report={status:'PASS',scope:'Cinq fichiers SRTB locaux, moteurs BA/Tout de suite, même mixeur PCM que l’export. Aucun média envoyé, aucun encodage vidéo.',records};
    result.textContent=JSON.stringify(report,null,2);const saved=await fetch(`/__social-evidence/real-voice-mix-${Date.now()}.json`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report,null,2)});
    ensure(saved.ok,'Rapport local non enregistré.');status.textContent='PASS — les cinq voix réelles sont audibles et retrouvées dans les mixages d’export.';
  }catch(error){status.textContent='FAIL — '+(error instanceof Error?error.message:String(error));result.textContent=JSON.stringify({status:'FAIL',records,error:error instanceof Error?error.message:String(error)},null,2);}
  finally{urls.forEach(URL.revokeObjectURL);await decode?.close();input.disabled=false;button.disabled=false;}
});
