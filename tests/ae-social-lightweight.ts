import {getTemplate,templateDefaults} from '../src/studio/domain';
import type {ProjectData} from '../src/studio/domain';
import {studioEngineModule} from '../src/studio/text-editing';
import {installSocialScene,socialSceneData} from '../src/studio/social-scene';
import {installPreviewMediaSurfaces} from '../src/studio/preview-media-surfaces';
import {installAEMediaTrim} from '../src/studio/ae-media-trim';
import {attachSocialPreview} from '../src/studio/social-preview';
import {socialTrackTimes} from '../src/studio/social-renderer';
import {engineData,locateClip} from '../src/studio/presentation';
import {prepareGraphic,tracksOf} from '../src/studio/video/engine';
import type {LegacyGraphic,PreparedGraphic} from '../src/studio/video/engine';
import {makeTimeline} from '../src/studio/video/timeline';
import {audioEvents,mixAudio} from '../src/studio/video/audio';
import {sampleProof} from '../src/studio/video/frame-proof';

const button=document.querySelector<HTMLButtonElement>('#run')!,status=document.querySelector('#status')!,result=document.querySelector('#result')!,scene=document.querySelector('#scene')!;
const check=(ok:unknown,message:string)=>{if(!ok)throw Error(message);};
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
function tone(){
  const samples=48000*3,bytes=new ArrayBuffer(44+samples*2),v=new DataView(bytes),s=(at:number,text:string)=>{for(let i=0;i<text.length;i++)v.setUint8(at+i,text.charCodeAt(i));};
  s(0,'RIFF');v.setUint32(4,36+samples*2,true);s(8,'WAVE');s(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,48000,true);v.setUint32(28,96000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);s(36,'data');v.setUint32(40,samples*2,true);
  for(let i=0;i<samples;i++)v.setInt16(44+i*2,Math.round(Math.sin(i*2*Math.PI*440/48000)*4000),true);
  return URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));
}
function difference(a:ReturnType<typeof sampleProof>,b:ReturnType<typeof sampleProof>){
  let rgb=0,alpha=0;for(let i=0;i<a.alpha.length;i++){alpha+=Math.abs(a.alpha[i]-b.alpha[i]);for(let c=0;c<3;c++)rgb+=Math.abs(a.rgb[i*4+c]-b.rgb[i*4+c]);}
  return {rgb:rgb/(a.alpha.length*3),alpha:alpha/a.alpha.length};
}
button.onclick=async()=>{
  button.disabled=true;const records:unknown[]=[],url=tone(),signal=new AbortController().signal;
  try{
    check(location.hostname==='127.0.0.1','Banc local uniquement');
    for(const id of ['BTV_Evenement','BTV_Semainier'])for(const format of ['portrait','vertical']){
      status.textContent=id+' · '+format;const t=getTemplate(id),data:ProjectData={...templateDefaults(t),_studio_format:format,_audio_url:{url,mimeType:'audio/wav'},_audio_enabled:true,_audio_volume:.35,_audio_voice_enabled:false,_out_mode:'manual'};
      for(const key of Object.keys(data))if(/^_media_.+_url$/.test(key)){
        data[key]=key.includes('logo')?'/library/v1.7.0/BTV_Ce_Soir/lib/media/programme.jpg':{url:'/preview-media/v1/ba-programme.mp4',mimeType:'video/mp4'};
        if(!key.includes('logo')){data[key.slice(0,-4)+'_start_seconds']=1;data[key.slice(0,-4)+'_end_seconds']=3;}
      }
      const mod=await import(/* @vite-ignore */studioEngineModule(t)),tag='lightweight-'+id.toLowerCase().replaceAll('_','-');if(!customElements.get(tag))customElements.define(tag,class extends mod.default{});
      const pairs:any[]=[];let exported:PreparedGraphic|undefined;
      try{
        for(const optimized of [false,true]){
          const host=document.createElement('div'),g=document.createElement(tag) as LegacyGraphic;scene.append(host);host.append(g);
          const pair:any={g,host,optimized};pairs.push(pair);
          await installPreviewMediaSurfaces(g,t,true);installAEMediaTrim(g,t);
          if(optimized)installSocialScene(g,t);
          else{const load=g.load.bind(g);g.load=(p:any)=>load({...p,data:socialSceneData(t,p.data)});}
          const begin=performance.now();await g.load({data:engineData(data,true),previewMuted:true});pair.loadMs=performance.now()-begin;
          pair.hiddenNodes=g.shadowRoot!.querySelectorAll('*').length;pair.hiddenSVGs=g.shadowRoot!.querySelectorAll('svg').length;
          if(optimized)check(pair.hiddenSVGs===0,'La scène TV subsiste');
          await attachSocialPreview(g,t,data,signal);
          pair.prepared={graphic:g,tracks:tracksOf(g),data,timeline:makeTimeline(id,data,{},Number(data._out_duration_seconds))};
          const events=audioEvents(pair.prepared,id,false);check(events.length===1&&events[0].gain(1)===.35,'Jingle perdu');
          pair.mix=(await mixAudio(events,pair.prepared.timeline.duration,signal,()=>{})).buffer;
        }
        exported=await prepareGraphic(t,data,Number(data._out_duration_seconds),false,signal);
        const samples=[];
        for(const seconds of id==='BTV_Semainier'?[1,3.4,6,8.4,11,13,16,18,21,25.6]:[1,5,12,20]){
          const proofs=[];
          for(const {g,host}of pairs){
            await g.goToTime({seconds});g.__socialPreview.refresh();proofs.push(sampleProof(host.querySelector('canvas'),Math.round(seconds*25)));
            for(const [key,at]of Object.entries(socialTrackTimes(id,seconds,exported.timeline.outAt))){
              const track=tracksOf(g)[key];if(!track)continue;const pos=locateClip(track.clips,at,track.loop,track.rate),clip=pos&&track.clips[pos.index];
              if(clip?.node instanceof HTMLVideoElement)check(Math.abs(clip.node.currentTime-pos!.time)<.081,'Extrait incorrect '+key);
            }
          }
          const oldNew=difference(proofs[0],proofs[1]),previewExport=difference(proofs[1],sampleProof(await exported.frame(Math.round(seconds*25),null),Math.round(seconds*25)));
          check(oldNew.rgb<1&&oldNew.alpha<.1,'Image différente ancien/nouveau '+JSON.stringify(oldNew));
          check(previewExport.rgb<12&&previewExport.alpha<1,'Image différente aperçu/export '+JSON.stringify(previewExport));samples.push({seconds,oldNew,previewExport});
        }
        let pcmError=0;for(let c=0;c<2;c++){const a=pairs[0].mix.getChannelData(c),b=pairs[1].mix.getChannelData(c);for(let i=0;i<a.length;i++)pcmError=Math.max(pcmError,Math.abs(a[i]-b[i]));}check(pcmError===0,'PCM modifié');
        const g=pairs[1].g;await g.setMuted(false);check(g.audio[0].node.muted===false,'Activation son');await g.setMuted(true);
        void g.playAction({goto:1,skipAnimation:true});await wait(350);await g.pauseAction();check(g.playing===false,'Pause');
        await g.stopAction({skipAnimation:true});check(g.phase==='stopped','Arrêt');
        await g.updateAction({...data,title_1:'Nouveau titre'});await g.goToTime({seconds:5});g.__socialPreview.refresh();check(g.shadowRoot.querySelectorAll('svg').length===0,'TV reconstruite après modification');
        records.push({id,format,loads:pairs.map(({optimized,loadMs,hiddenNodes,hiddenSVGs})=>({optimized,loadMs,hiddenNodes,hiddenSVGs})),pcmError,samples});result.textContent=JSON.stringify(records,null,2);
      }finally{await exported?.dispose();for(const {g,host}of pairs){await g.dispose();host.remove();}}
    }
    status.textContent='PASS · quatre compositions, vidéos recoupées, PCM identique, lecture/pause/arrêt et modification.';
  }catch(error){status.textContent='FAIL · '+String(error);}finally{URL.revokeObjectURL(url);button.disabled=false;}
};
