import {getTemplate,templateDefaults} from '../src/studio/domain';
import type {ProjectData} from '../src/studio/domain';
import {SocialRenderer,prepareSocialAssets,socialTrackTimes} from '../src/studio/social-renderer';
import {makeTimeline,TIMINGS} from '../src/studio/video/timeline';
import {socialSignature} from '../src/studio/social-motion';
import {studioEngineModule} from '../src/studio/text-editing';
import {engineData,locateClip} from '../src/studio/presentation';
import {installSocialScene} from '../src/studio/social-scene';
import {installBAMediaReadiness} from '../src/studio/media-readiness';
import {installPreviewMediaSurfaces} from '../src/studio/preview-media-surfaces';
import {attachSocialPreview} from '../src/studio/social-preview';
import {prepareGraphic} from '../src/studio/video/engine';
import type {LegacyGraphic} from '../src/studio/video/engine';
import {sampleProof} from '../src/studio/video/frame-proof';
import {installTypography} from '../src/studio/typography-engine';
import {stripSupplementalVoice} from '../src/studio/supplemental-voice';
import {installAEMediaTrim} from '../src/studio/ae-media-trim';
import {installPreviewTransport} from '../src/studio/preview-transport';
import {audioEvents,mixAudio} from '../src/studio/video/audio';
import {tracksOf} from '../src/studio/media-tracks';
const status=document.querySelector('#status')!,result=document.querySelector('#result')!,gallery=document.querySelector('#gallery')!,run=document.querySelector<HTMLButtonElement>('#run')!;
const ids=['BTV_BA_1P','BTV_BA_TDS','BTV_BA_TDS_SUIVI_DE','BTV_Ce_Soir','BTV_Renvoi','BTV_Evenement','BTV_Semainier'];
const check=(ok:unknown,message:string)=>{if(!ok)throw Error(message);};
const imageURL='/library/v1.7.0/BTV_Ce_Soir/lib/media/programme.jpg';
function fixture(id:string,format:string){
  const t=getTemplate(id),data:ProjectData={...templateDefaults(t),_studio_format:format,_out_mode:'manual',_out_duration_seconds:id==='BTV_BA_1P'?12:TIMINGS[id].stop};
  for(const key of Object.keys(data)){
    if(/_audio.*enabled$/.test(key))data[key]=false;
    if(/^_media_.+_sequence$/.test(key))data[key]='[]';
    if(/^_media_.+_url$/.test(key)){data[key]=imageURL;const prefix=key.slice(0,-4);data[prefix+'_start_seconds']=0;data[prefix+'_end_seconds']=30;}
  }
  if(id==='BTV_BA_1P')Object.assign(data,{_studio_ba_mode:'simple',_titre_ligne_1:'LE GRAND',_titre_ligne_2:'ENTRETIEN',_titre_ligne_3:'',_thematique:'MAGAZINE',_jour_1:'CE SOIR',_heure_1:'20H30'});
  if(id==='BTV_BA_TDS')data._background_visible=true;
  if(id==='BTV_BA_TDS_SUIVI_DE')data._media_mode='internal';
  if(['BTV_BA_1P','BTV_BA_TDS','BTV_BA_TDS_SUIVI_DE'].includes(id)){
    const kinds=id==='BTV_BA_1P'?['intro','body','pack']:id==='BTV_BA_TDS'?['background']:['programme_1','programme_2'];
    for(const kind of kinds)Object.assign(data,{[`_media_${kind}_url`]:'/library/v1.7.0/BTV_BA_1P/lib/media/programme.mp4',[`_media_${kind}_start_seconds`]:2,[`_media_${kind}_end_seconds`]:8,[`_media_${kind}_loop`]:true,[`_media_${kind}_volume`]:.15,[`_media_${kind}_audio_enabled`]:id==='BTV_BA_1P'?kind==='body':format==='vertical'});
    data._audio_bed_enabled=true;data._audio_bed_gain=.15;data._audio_bed_volume=.15;
    if(id!=='BTV_BA_TDS_SUIVI_DE')Object.assign(data,{_audio_voice_enabled:true,_audio_voice_url:'/library/v1.7.0/BTV_BA_1P/sourceassets/VOIX SEMAINE.mp3.mpeg',_audio_voice_gain:.1,_audio_voice_volume:.1,...(id==='BTV_BA_TDS'?{_audio_voice_start_seconds:3.2,_audio_voice_end_seconds:5.36,_audio_voice_delay_seconds:2.4}:{})});
    if(id!=='BTV_BA_1P')delete data._audio_bed_gain;
    if(id==='BTV_BA_1P'){delete data._audio_bed_volume;delete data._audio_voice_volume;}
    if(id==='BTV_BA_TDS')delete data._audio_voice_gain;
  }
  return data;
}
function snapshot(canvas:HTMLCanvasElement){return canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data.slice();}
function difference(a:ReturnType<typeof sampleProof>,b:ReturnType<typeof sampleProof>){let rgb=0,alpha=0;for(let i=0;i<a.alpha.length;i++){alpha+=Math.abs(a.alpha[i]-b.alpha[i]);for(let c=0;c<3;c++)rgb+=Math.abs(a.rgb[i*4+c]-b.rgb[i*4+c]);}return {rgb:rgb/(a.alpha.length*3),alpha:alpha/a.alpha.length};}
function thumb(canvas:HTMLCanvasElement,label:string){const figure=document.createElement('figure'),copy=document.createElement('canvas'),caption=document.createElement('figcaption');copy.width=270;copy.height=Math.round(270*canvas.height/canvas.width);copy.getContext('2d')!.drawImage(canvas,0,0,copy.width,copy.height);caption.textContent=label;figure.append(copy,caption);gallery.append(figure);}
run.onclick=async()=>{
  run.disabled=true;const records:unknown[]=[],signal=new AbortController().signal;
  try{
    const photo=new Image();photo.src=imageURL;await photo.decode();
    const alternate=document.createElement('canvas');alternate.width=1920;alternate.height=1080;alternate.getContext('2d')!.fillStyle='#ff00ee';alternate.getContext('2d')!.fillRect(0,0,1920,1080);
    const kinds=['intro','body','pack','background','programme_1','programme_2','renvoi','event','final','1','2','3'],pictures=Object.fromEntries(kinds.map(key=>[key,photo])),other=Object.fromEntries(kinds.map(key=>[key,alternate]));
    for(const id of ids)for(const format of ['portrait','vertical']){
      status.textContent=id+' · '+format;const t=getTemplate(id),data=fixture(id,format),before=JSON.stringify(data),timeline=makeTimeline(id,data,{},Number(data._out_duration_seconds)),assets=await prepareSocialAssets(t,data,signal),renderer=new SocialRenderer(t,data,assets);
      const samples=[0,.4,1,4.32,4.36,Math.min(8,timeline.outAt-.04),...(id==='BTV_BA_TDS_SUIVI_DE'?[13.8,14.8,16.56]:[]),timeline.outAt,timeline.outAt+.4,timeline.duration-.04],masked=[];
      try{
        for(const seconds of samples){
          if(!socialSignature(id,seconds,timeline))continue;
          const first=snapshot(renderer.frame(seconds,timeline,pictures,null)),second=snapshot(renderer.frame(seconds,timeline,other,null));
          check(first.every((value,index)=>value===second[index]),'Un média reste visible pendant la signature '+id+' '+seconds);masked.push(seconds);
        }
        if(id==='BTV_BA_1P'){
          const first=snapshot(renderer.frame(4.36,timeline,pictures,null)),second=snapshot(renderer.frame(4.36,timeline,{...pictures,intro:alternate},null));check(first.every((value,index)=>value===second[index]),'Intro BA muette encore visible après la première image du corps');
          const body=snapshot(renderer.frame(4.36,timeline,{...pictures,body:alternate},null));check(first.some((value,index)=>value!==body[index]),'Corps BA absent à son départ sonore');
        }
        if(id==='BTV_BA_TDS_SUIVI_DE'){
          renderer.frame(14.8,timeline,pictures,null);check(renderer.textBoxes.some(box=>box.field==='_p2_titre_ligne_1')&&renderer.textBoxes.some(box=>box.field==='_followup_label'),'Transition sans titre P2 / Suivi de');check(!renderer.textBoxes.some(box=>box.field.startsWith('_p1_')||box.field==='_intro_label'),'Transition réaffiche P1 / Tout de suite');
          thumb(renderer.canvas,`${t.name} · ${format} · Transition Suivi de`);
        }
        for(const [label,seconds]of [['Ouverture',1],['Extrait',Math.min(8,timeline.outAt-.04)],['Signature',timeline.outAt+.4]] as const)thumb(renderer.frame(seconds,timeline,pictures,null),`${t.name} · ${format} · ${label}`);
        const a=snapshot(renderer.frame(.12,timeline,pictures,null)),b=snapshot(renderer.frame(.6,timeline,pictures,null));
        if(socialSignature(id,.12,timeline))check(a.some((v,i)=>v!==b[i]),'Signature sans mouvement '+id);
        check(JSON.stringify(data)===before,'Réglages altérés');
      }finally{renderer.dispose();}
      // The actual native media/clock instance feeds the preview. The exported
      // reference uses prepareGraphic, not another direct renderer invocation.
      const mod=await import(/* @vite-ignore */studioEngineModule(t)),tag='motion-check-'+id.toLowerCase().replaceAll('_','-');if(!customElements.get(tag))customElements.define(tag,class extends mod.default{});
      const host=document.createElement('div');host.style.cssText='position:fixed;left:-20000px;width:432px;height:'+(format==='portrait'?540:768)+'px';document.body.append(host);const g=document.createElement(tag) as LegacyGraphic;host.append(g);let prepared,transport:ReturnType<typeof installPreviewTransport>|undefined;
      try{
        await installPreviewMediaSurfaces(g,t,true);installAEMediaTrim(g,t);installSocialScene(g,t);installTypography(g,t,data);await installBAMediaReadiness(t);
        const loaded=await g.load({renderType:'realtime',previewMuted:true,data:stripSupplementalVoice(t,engineData(data,true))});check(!(loaded?.statusCode>=400),'Chargement aperçu '+id+' '+JSON.stringify(loaded));await attachSocialPreview(g,t,data,signal);
        prepared=await prepareGraphic(t,data,timeline.outAt,false,signal);const parity=[],mediaPositions=[];
        const audio=audioEvents(prepared,id,false),audioPlan=audio.map(event=>({kind:event.buffer?event.buffer===prepared!.graphic.audio?.buffers.bed?.buffer?'signature':'voice':event.url?.includes('programme.mp4')?'rush':event.url?.includes('VOIX')?'voice':'signature',at:event.at,start:event.start,duration:event.duration,rate:event.rate,gainAtStart:event.gain(event.at),gainAfterAttack:event.gain(event.at+Math.min(.08,event.duration/2))}));
        if(['BTV_BA_1P','BTV_BA_TDS','BTV_BA_TDS_SUIVI_DE'].includes(id)){
          check(audioPlan.some(event=>event.kind==='signature'&&event.at===0),'Signature sonore activée absente du plan');
          const rush=audioPlan.filter(event=>event.kind==='rush');check((id==='BTV_BA_1P'||format==='vertical')?rush.length>0:rush.length===0,'Choix explicite du son rush modifié');
          if(id==='BTV_BA_1P')check(rush[0].at===4.36&&rush[0].start===2,'Le premier son du corps BA a été déplacé');
          if(id==='BTV_BA_TDS'&&rush.length)check(rush[0].at===0&&rush[0].start===2,'Le son TDS doit garder son départ source à IN');
          if(id!=='BTV_BA_TDS_SUIVI_DE')check(audioPlan.some(event=>event.kind==='voice'&&Math.abs(event.at-(id==='BTV_BA_1P'?1.92:2.4))<1e-7),'Voix explicitement active perdue ou déplacée');
        }
        let mixedAudio,isolatedVoice;
        if(['BTV_BA_1P','BTV_BA_TDS'].includes(id)&&format==='portrait'){
          const mixed=await mixAudio(audio,prepared.timeline.duration,signal,()=>{});check(mixed.audible,'Mix réel sans son');mixedAudio={peak:mixed.peak,audible:mixed.audible,samples:mixed.buffer.length,sampleRate:mixed.buffer.sampleRate};
          // The native BA voice ramps from −191 dB to its selected gain over
          // 40 ms. Its value exactly at IN is not a measure of audible speech.
          // Decode and mix only voice events to prove the voice contributes,
          // independently of the signature or programme soundtrack.
          const voiceEvents=audio.filter((_event,index)=>audioPlan[index].kind==='voice'),voice=await mixAudio(voiceEvents,prepared.timeline.duration,signal,()=>{});
          let energy=0,samples=0;
          for(let channel=0;channel<voice.buffer.numberOfChannels;channel++)for(const event of voiceEvents){
            const pcm=voice.buffer.getChannelData(channel),first=Math.ceil((event.at+.08)*voice.buffer.sampleRate),last=Math.min(pcm.length,Math.floor((event.at+event.duration)*voice.buffer.sampleRate));
            for(let index=first;index<last;index++){energy+=pcm[index]*pcm[index];samples++;}
          }
          const rms=Math.sqrt(energy/Math.max(1,samples));check(voice.audible&&voice.peak>1e-5&&rms>1e-6,'Voix isolée réellement muette');
          isolatedVoice={peak:voice.peak,rmsAfterAttack:rms,audible:voice.audible,measuredSamples:samples,sampleRate:voice.buffer.sampleRate,events:audioPlan.filter(event=>event.kind==='voice')};
        }
        for(const seconds of [1,4.32,4.36,Math.min(8,timeline.outAt-.04),...(id==='BTV_BA_TDS_SUIVI_DE'?[13.8,15.32,16.6]:[]),timeline.outAt+.4,timeline.duration-.04,1]){
          await g.goToTime({seconds,outAt:timeline.outAt});g.__socialPreview.refresh();const frame=Math.round(seconds*25),diff=difference(sampleProof(host.querySelector('canvas')!,frame),sampleProof(await prepared.frame(frame,null),frame));
          check(diff.rgb<12&&diff.alpha<1,'Parité '+id+' '+format+' '+seconds+' '+JSON.stringify(diff));parity.push({seconds,...diff});
          for(const [key,time]of Object.entries(socialTrackTimes(id,seconds,timeline.outAt))){const track=tracksOf(g)[key];if(!track)continue;const position=locateClip(track.clips,time,track.loop,track.rate),node=position&&track.clips[position.index].node;if(node instanceof HTMLVideoElement){const error=Math.abs(node.currentTime-position!.time);check(error<.081,'Position réelle du rush incorrecte '+id+' '+key+' '+seconds);mediaPositions.push({seconds,track:key,expected:position!.time,actual:node.currentTime,error});}}
        }
        let pausedOut;
        if(['BTV_BA_1P','BTV_Evenement','BTV_Semainier'].includes(id)){
          const errors:string[]=[],wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));transport=installPreviewTransport(g,t,()=>data,error=>errors.push(error.message));
          await transport.seek(1);await transport.resume();await wait(120);await transport.out();await wait(120);await transport.pause();
          const at=transport.snapshot(),pixels=snapshot(host.querySelector('canvas')!);await wait(140);const held=transport.snapshot(),heldPixels=snapshot(host.querySelector('canvas')!);
          check(at.phase==='paused'&&held.seconds===at.seconds,'Horloge avance pendant pause OUT');check(pixels.every((value,index)=>value===heldPixels[index]),'Signature change pendant pause OUT');
          check(at.outAt!==undefined&&at.outAt<2&&socialSignature(id,at.seconds,{outAt:at.outAt,duration:at.outAt+timeline.timing.out})?.phase==='outro','OUT manuel précoce perd sa signature');
          await transport.seek(at.seconds,at.outAt);const restored=transport.snapshot();check(restored.outAt===at.outAt&&restored.seconds===at.seconds,'Inspection perd OUT manuel');
          check(errors.length===0,errors.join('; '));pausedOut={seconds:at.seconds,outAt:at.outAt,restored:true};await transport.clear();
        }else await g.stopAction({skipAnimation:true});
        check(snapshot(host.querySelector('canvas')!).every((value,index)=>index%4!==3||value===0),'Arrêt non transparent');
        records.push({id,format,masked,parity,audioPlan,mixedAudio,isolatedVoice,mediaPositions,pausedOut,clear:true,settingsRetained:JSON.stringify(data)===before});result.textContent=JSON.stringify(records,null,2);
      }finally{transport?.dispose();await prepared?.dispose();await g.dispose();host.remove();}
    }
    status.textContent='PASS · 14 compositions, signatures opaques et parité aperçu/export';result.textContent=JSON.stringify({status:'PASS',records},null,2);
  }catch(error){status.textContent='ÉCHEC · '+String(error);result.textContent=JSON.stringify({status:'FAIL',records,error:String(error)},null,2);}finally{run.disabled=false;}
};
