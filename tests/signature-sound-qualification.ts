import {getTemplate,templateDefaults} from '../src/studio/domain';
import {deriveProjects} from '../src/studio/derivation-model';
import {prepareGraphic} from '../src/studio/video/engine';
import {audioEvents,mixAudio} from '../src/studio/video/audio';

const button=document.querySelector<HTMLButtonElement>('#run')!,status=document.querySelector<HTMLElement>('#status')!,output=document.querySelector<HTMLElement>('#result')!;
const template=getTemplate('BTV_BA_1P');
button.onclick=async()=>{
  button.disabled=true;output.textContent='';const rows:unknown[]=[];
  try{
    if(location.hostname!=='127.0.0.1')throw Error('Recette locale uniquement.');
    for(const enabled of [true,false]){
      const data={...templateDefaults(template),_audio_bed_enabled:enabled,_audio_bed_gain:.5};
      const children=deriveProjects({templateId:template.id,templateVersion:template.version,libraryVersion:template.libraryVersion,title:'Recette jingle',data},[],'',[{key:'now',formats:['tv','portrait','vertical'],voice:{mode:'none'}}]);
      for(const child of children){
        const settings={...child.data,_background_visible:false,_media_background_url:'',_media_background_sequence:'[]'},signal=new AbortController().signal;
        const prepared=await prepareGraphic(getTemplate(child.templateId),settings,15.28,false,signal);
        try{
          const events=audioEvents(prepared,child.templateId,false);
          if(enabled&&(events.length!==1||events[0].duration!==15||events[0].at!==0||events[0].gain(0)!==.5))throw Error('Repères ou niveau du jingle incorrects.');
          if(!enabled&&events.length)throw Error('Le choix silencieux a été ignoré.');
          const mixed=await mixAudio(events,prepared.timeline.duration,signal,text=>status.textContent=text);
          if(mixed.audible!==enabled)throw Error('Absence du jingle ou son non demandé.');
          const first=mixed.buffer.getChannelData(0),last=first.subarray(15*48000);
          if(last.some(value=>Math.abs(value)>1e-6))throw Error('Son au-delà de la fin prévue du jingle.');
          rows.push({format:child.data._studio_format,enabled,events:events.map(event=>({at:event.at,start:event.start,duration:event.duration})),peak:mixed.peak,audible:mixed.audible,tailSilent:true,pass:true});
          output.textContent=JSON.stringify(rows,null,2);
        }finally{await prepared.dispose();}
      }
    }
    status.textContent='PASS — 6/6 : jingle natif audible, voix absente, silence volontaire respecté.';
  }catch(error){status.textContent='FAIL — '+String(error);}finally{button.disabled=false;}
};
