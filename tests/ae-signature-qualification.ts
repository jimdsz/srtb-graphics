import {getTemplate,templateDefaults} from '../src/studio/domain';
import {studioEngineModule} from '../src/studio/text-editing';
import {installAESignatureLevel} from '../src/studio/ae-signature-audio';
import {prepareGraphic} from '../src/studio/video/engine';
import {audioEvents,mixAudio} from '../src/studio/video/audio';
import {engineData} from '../src/studio/presentation';
import type {LegacyGraphic} from '../src/studio/video/engine';

const expected=[
 {id:'BTV_Renvoi',name:'BTV_RENVOI PIQURE DE RAPPEL -23LUFS.wav',sha:'0245c777d7f4fdd55697e5ea8858a3316917a31c03e26d7049c440e66e7b0c6f',duration:10.125,end:10},
 {id:'BTV_Evenement',name:'BTV_BA EVENEMENT_-23LUFS.wav',sha:'59049839808ffefb3d47ebbf70d7d957fec4147d71aae13c2b622e01e9c61902',duration:20.0625,end:20.0625},
 {id:'BTV_Semainier',name:'BTV_BA SEMAINIER_-23LUFS.wav',sha:'dafa1f53a9afa9390ff8ae08c5c21c01b4a92b04ba47ed48e1496cc779728f71',duration:26.25,end:26.25},
];
const input=document.querySelector<HTMLInputElement>('#files')!,button=document.querySelector<HTMLButtonElement>('#run')!,status=document.querySelector('#status')!,result=document.querySelector('#result')!,scene=document.querySelector('#scene')!;
function check(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
button.onclick=async()=>{
 button.disabled=true;const records:unknown[]=[];
 try{
  check(location.hostname==='127.0.0.1','Banc local uniquement.');check(input.files?.length===3,'Choisir les trois fichiers autorisés.');
  for(const spec of expected){
   const file=Array.from(input.files).find(file=>file.name===spec.name);check(file,'Fichier manquant : '+spec.name);
   const bytes=await file.arrayBuffer(),sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');check(sha===spec.sha,'Empreinte incorrecte.');
   const decoded=await new OfflineAudioContext(2,1,48000).decodeAudioData(bytes);check(decoded.duration===spec.duration,'Durée incorrecte.');
   const template=getTemplate(spec.id),url=URL.createObjectURL(file),data={...templateDefaults(template),_audio_enabled:true,_audio_url:{url,name:file.name,mimeType:'audio/wav'},_audio_volume:.35,_audio_voice_enabled:false};
   let graphic:LegacyGraphic|undefined;
   try{
    status.textContent=template.name+' · moteur natif';const module=await import(/* @vite-ignore */studioEngineModule(template)),tag='signature-qa-'+spec.id.toLowerCase().replaceAll('_','-');if(!customElements.get(tag))customElements.define(tag,class extends module.default{});
    graphic=document.createElement(tag) as LegacyGraphic;scene.append(graphic);installAESignatureLevel(graphic,template);
    const loaded=await graphic.load({renderType:'realtime',previewMuted:true,data:engineData(data,true)});check(!(loaded?.statusCode>=400),loaded?.statusMessage);
    await graphic.goToTime({seconds:2});const node=(graphic.audio[0]?.node||graphic.audio[0]?.element) as HTMLMediaElement;check(node?.volume===.35&&node.muted,'Le niveau aperçu ne respecte pas le réglage.');
    for(const format of ['tv','portrait','vertical']){
     status.textContent=template.name+' · '+format+' · mix export';const signal=new AbortController().signal,prepared=await prepareGraphic(template,{...data,_studio_format:format},12,false,signal);
     try{
      const events=audioEvents(prepared,spec.id,false);check(events.length===1&&events[0].at===0&&events[0].duration===spec.end,'Repères incorrects.');
      const mixed=await mixAudio(events,prepared.timeline.duration,signal,()=>{});let maximum=0,squared=0;
      for(let c=0;c<2;c++){const actual=mixed.buffer.getChannelData(c),source=decoded.getChannelData(c);for(let n=0;n<actual.length;n++){const reference=n<Math.round(spec.end*48000)?(source[n]||0)*.35:0,error=actual[n]-reference;maximum=Math.max(maximum,Math.abs(error));squared+=error*error;}}
      const rmse=Math.sqrt(squared/(2*mixed.buffer.length));check(maximum<.00005&&rmse<.000005,'PCM différent du fichier d’origine : '+JSON.stringify({maximum,rmse}));check(mixed.audible,'Mix muet.');
      records.push({template:spec.id,format,sourceSHA:sha,sourceDuration:decoded.duration,jingleEnd:spec.end,previewVolume:node.volume,maximum,rmse,peak:mixed.peak,pass:true});result.textContent=JSON.stringify(records,null,2);
     }finally{await prepared.dispose();}
    }
   }finally{await graphic?.dispose();graphic?.remove();URL.revokeObjectURL(url);}
  }
  status.textContent='PASS · 9 mixages PCM, 3 niveaux aperçu. Lecture temps réel et codecs non qualifiés par ce banc.';
 }catch(error){status.textContent='FAIL · '+String(error);}finally{button.disabled=false;}
};
