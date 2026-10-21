import {ALL_FORMATS,AudioBufferSink,Input} from 'mediabunny';
import {browserSource} from './source';
import type {PreparedGraphic,Clip,Track} from './engine';
import {clamp01} from './timeline';
import {assertSupplementalVoiceFits} from '../supplemental-voice';
import {hasAESignature,aeSignatureEnd} from '../ae-signature-audio';
import {baSocialDirect} from '../ba-social-direct';
import {aeTrimTemplate} from '../ae-media-window';
import {aeMediaFade,aeMediaWindows} from '../ae-media-timing';

export interface AudioEvent {url?:string;buffer?:AudioBuffer;at:number;start:number;duration:number;rate:number;gain:(time:number)=>number;required:boolean}
/** Merge overlapping source ranges, never the unused gap between distant cuts. */
export function audioWindows(events:AudioEvent[]){
  const sources=new Map<string,AudioEvent[]>();
  for(const event of events)if(!event.buffer&&event.url){const list=sources.get(event.url)||[];list.push(event);sources.set(event.url,list);}
  const windows:{url:string;start:number;end:number;events:AudioEvent[]}[]=[];
  for(const [url,list] of sources){
    let current:(typeof windows)[number]|undefined;
    for(const event of [...list].sort((a,b)=>a.start-b.start)){
      const end=event.start+event.duration*event.rate;
      if(current&&event.start<=current.end+1e-7){current.end=Math.max(current.end,end);current.events.push(event);}
      else{current={url,start:event.start,end,events:[event]};windows.push(current);}
    }
  }
  return windows;
}
const rawUrl=(v:unknown)=>typeof v==='object'&&v!==null&&'url'in v?String(v.url):String(v||'');
async function preservePitch(buffer:AudioBuffer,start:number,duration:number,tempo:number,signal:AbortSignal):Promise<AudioBuffer>{
  const first=Math.round(start*buffer.sampleRate),end=first+Math.round(duration*tempo*buffer.sampleRate),frames=Math.round(duration*buffer.sampleRate);
  const left=buffer.getChannelData(0).slice(first,end),right=buffer.getChannelData(Math.min(1,buffer.numberOfChannels-1)).slice(first,end);
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./stretch.worker.ts',import.meta.url),{type:'module'}),cleanup=()=>{worker.terminate();signal.removeEventListener('abort',abort);},abort=()=>{cleanup();reject(new DOMException('Rendu annulé.','AbortError'));};
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted){abort();return;}
    worker.onerror=()=>{cleanup();reject(Error('Traitement de vitesse audio indisponible.'));};
    worker.onmessage=({data}:{data:{channels?:Float32Array<ArrayBuffer>[];error?:string}})=>{cleanup();if(data.error){reject(Error(data.error));return;}const result=new AudioBuffer({numberOfChannels:2,sampleRate:buffer.sampleRate,length:frames});for(let c=0;c<2;c++)result.copyToChannel(data.channels![c],c);resolve(result);};
    worker.postMessage({left,right,sampleRate:buffer.sampleRate,tempo,frames},[left.buffer,right.buffer]);
  });
}
export function playlistEvents(track:Track,at:number,until:number,gain:(t:number)=>number,elapsed=0):AudioEvent[]{
  const result:AudioEvent[]=[],rate=track.rate||1,total=track.clips.reduce((s,c)=>s+c.length,0);
  if(!total||at>=until)return result;
  let cursor=at,position=elapsed*rate;
  if(track.loop&&Number.isFinite(total))position%=total;
  else if(position>=total)return result;
  let index=0;while(index<track.clips.length-1&&position>=track.clips[index].length)position-=track.clips[index++].length;
  while(cursor<until-1e-7){
    const clip=track.clips[index],duration=Math.min(until-cursor,(clip.length-position)/rate);
    if(!(duration>0))break;
    if(clip.type!=='image')result.push({url:clip.source||clip.url||clip.node?.src,at:cursor,start:clip.start+position,duration,rate,gain,required:clip.type==='audio'});
    cursor+=duration;position=0;index++;
    if(index===track.clips.length){if(track.loop)index=0;else break;}
    if(result.length>2000)throw Error('Trop de répétitions audio dans cet export.');
  }
  return result;
}
function simpleClip(node:HTMLMediaElement,start:number,end:number):Clip{return {type:'audio',source:node.src,node,start,end:end||node.duration,length:(end||node.duration)-start};}
export function audioEvents(prepared:PreparedGraphic,id:string,removeBackground:boolean):AudioEvent[]{
  const {graphic:g,tracks,data:d,timeline:tl}=prepared,{outAt}=tl,events:AudioEvent[]=[];
  // A visual terminal hold adds silence, not extra source audio or a slower OUT.
  const duration=(tl.frames-tl.terminalHoldFrames)/25;
  const direct=baSocialDirect(id,d);
  if(prepared.supplementalVoice){
    const {plan,buffer}=prepared.supplementalVoice;assertSupplementalVoiceFits(plan,duration);
    events.push({buffer,at:plan.delay,start:plan.start,duration:plan.duration,rate:1,gain:()=>plan.volume,required:true});
  }
  if(prepared.supplementalSignature){
    const {plan,buffer}=prepared.supplementalSignature;
    events.push({buffer,at:0,start:plan.start,duration:Math.min(plan.duration,duration),rate:1,gain:()=>plan.volume,required:true});
  }
  const fade=(t:number)=>1-clamp01((t-outAt)/tl.timing.out);
  for(const [kind,track]of Object.entries(tracks)){
    if(direct&&kind!=='body')continue;
    const prefix=kind==='audio'?'_audio':`_media_${kind}`;
    const enabled=kind==='audio'?d._audio_enabled:d[prefix+'_audio_enabled'];
    if(!enabled)continue;
    if(removeBackground&&(kind==='background'||id==='BTV_BA_1P'||id==='BTV_BA_TDS_SUIVI_DE'))continue;
    if(kind==='background'&&'_background_visible'in d&&!d._background_visible)continue;
    if(id==='BTV_BA_TDS_SUIVI_DE'&&d._media_mode!=='internal')continue;
    const volume=Number(d[prefix+'_volume']??1);let at=0,until=duration,gain=(_t:number)=>volume;
    if(kind!=='audio'&&aeTrimTemplate(id)){
      for(const window of aeMediaWindows(id,kind,track,outAt,duration,!!d._studio_format&&d._studio_format!=='tv'))
        events.push(...playlistEvents(track,window.at,window.until,t=>volume*aeMediaFade(t,outAt,tl.timing.out),window.elapsed));
      continue;
    }
    if(id==='BTV_BA_1P'&&!direct){
      at=kind==='body'?4.36:kind==='pack'?outAt:0;until=Math.min(duration,kind==='body'?outAt+1.36:kind==='pack'?outAt+6.44:5.6);
    }else if(id==='BTV_PopUp'&&kind==='popup'){at=.64;until=Math.min(duration,outAt+.8);}
    else if(id==='BTV_BA_TDS_SUIVI_DE'){
      at=kind==='programme_2'?13.8:0;until=kind==='programme_1'?15.32:duration;
      gain=t=>volume*(kind==='programme_1'?1-clamp01((t-13.8)/1.52):clamp01((t-13.8)/1.52));
    }else if(tl.timing.kind==='signature'){
      if(kind==='audio'&&hasAESignature(id))until=aeSignatureEnd(id,duration);
      else gain=t=>volume*fade(t);
    }
    events.push(...playlistEvents(track,at,until,gain));
  }
  if(id==='BTV_BA_1P'){
    for(const kind of ['bed','voice']){
      if(direct&&kind==='bed')continue;
      if(!d[`_audio_${kind}_enabled`])continue;
      const buffer=g.audio.buffers[kind]?.buffer as AudioBuffer|undefined;if(!buffer)throw Error('Une piste audio BA active n’est pas prête.');
      for(const insertion of g.audio.plan[kind]){
        if(direct&&insertion.id.endsWith('outro'))continue;
        const shift=insertion.id.endsWith('outro')?outAt-64.8:0,at=insertion.mainIn+shift;
        const voiceEnd=insertion.id.endsWith('outro')?duration:outAt;
        const length=kind==='voice'?insertion.mainOut-insertion.mainIn:Math.min(insertion.mainOut+shift,voiceEnd)-at;
        if(kind==='voice')assertSupplementalVoiceFits({url:'',start:insertion.sourceIn,end:insertion.sourceOut,duration:length,delay:at,volume:1},voiceEnd);
        if(length<=0)continue;
        const envelope=insertion.envelope as [number,number][];
        const gain=(t:number)=>{
          const time=t-shift;let db=envelope[0][1];
          for(let j=1;j<envelope.length;j++){const a=envelope[j-1],b=envelope[j];if(time<=a[0])break;db=time>=b[0]?b[1]:a[1]+(b[1]-a[1])*(time-a[0])/(b[0]-a[0]);if(time<b[0])break;}
          return Number(d[`_audio_${kind}_gain`])*10**(db/20);
        };
        events.push({buffer,at,start:insertion.sourceIn,duration:length,rate:1,gain,required:true});
      }
    }
  }else if(id==='BTV_BA_TDS'){
    for(const kind of ['bed','voice'])if(d[`_audio_${kind}_enabled`]){
      const node=g.sound[kind].node as HTMLMediaElement,p=`_audio_${kind}`;
      if(!node)throw Error('Une piste audio TDS active n’est pas prête.');
      const clip=simpleClip(node,Number(d[p+'_start_seconds']),Number(d[p+'_end_seconds'])),at=Number(d[p+'_delay_seconds']),volume=Number(d[p+'_volume']);
      if(kind==='voice'){
        if(!Number.isFinite(clip.length)||clip.length<=0||clip.end>node.duration+1/48000)throw Error('Voix TDS : passage hors du fichier audio.');
        assertSupplementalVoiceFits({url:node.src,start:clip.start,end:clip.end,duration:clip.length,delay:at,volume},duration);
        events.push({url:node.src,at,start:clip.start,duration:clip.length,rate:1,gain:()=>volume,required:true});
      }else events.push(...playlistEvents({clips:[clip],loop:false},at,duration,()=>volume));
    }
  }else if(id==='BTV_BA_TDS_SUIVI_DE'&&d._audio_bed_enabled){
    const node=g.audioBed as HTMLMediaElement,track={clips:[simpleClip(node,Number(d._audio_bed_start_seconds),0)],loop:!!d._audio_bed_loop};
    events.push(...playlistEvents(track,0,outAt,()=>Number(d._audio_bed_volume)));
    events.push(...playlistEvents(track,outAt,duration,()=>Number(d._audio_bed_volume),24.28));
  }
  return events.filter(e=>e.duration>0&&(e.buffer||rawUrl(e.url)));
}

export async function mixAudio(events:AudioEvent[],duration:number,signal:AbortSignal,progress:(message:string)=>void,options:{maxMemoryBytes?:number}={}){
  const rate=48000,length=Math.round(duration*rate),context=new OfflineAudioContext(2,length,rate);
  const inputs:Input[]=[],cache=new Map<AudioEvent,{buffer:AudioBuffer|null;offset:number}>();
  const abort=()=>inputs.forEach(input=>input.dispose());signal.addEventListener('abort',abort,{once:true});
  let memory=length*8;const memoryLimit=options.maxMemoryBytes??384*1024**2;
  try{
    for(const {url,start,end,events:same} of audioWindows(events)){
      signal.throwIfAborted();
      const input=new Input({formats:ALL_FORMATS,source:browserSource(url)});inputs.push(input);
      progress('Décodage des pistes sonores…');
      const track=await input.getPrimaryAudioTrack();
      if(!track){if(same.some(e=>e.required))throw Error('Le fichier audio choisi ne contient aucune piste sonore.');for(const event of same)cache.set(event,{buffer:null,offset:start});input.dispose();continue;}
      if(!await track.canDecode())throw Error('Le navigateur ne sait pas décoder un des sons sélectionnés. Convertissez cette source en WAV ou AAC.');
      const count=Math.ceil((end-start)*rate);memory+=count*8;
      if(memory>memoryLimit)throw Error(`Les sons décodés dépassent la mémoire de sécurité (${Math.round(memoryLimit/1024**2)} Mo). Raccourcissez les passages sélectionnés.`);
      const decode=new OfflineAudioContext(2,Math.max(1,count),rate),sink=new AudioBufferSink(track);
      for await(const item of sink.buffers(start,end)){
        signal.throwIfAborted();const from=Math.max(start,item.timestamp),to=Math.min(end,item.timestamp+item.buffer.duration);if(to<=from)continue;
        const source=decode.createBufferSource();source.buffer=item.buffer;source.connect(decode.destination);source.start(from-start,from-item.timestamp,to-from);
      }
      const decoded={buffer:await decode.startRendering(),offset:start};for(const event of same)cache.set(event,decoded);input.dispose();
    }
    for(const event of events){
      signal.throwIfAborted();const decoded=event.buffer?{buffer:event.buffer,offset:0}:cache.get(event)!;
      if(!decoded?.buffer)continue;
      const eventEnd=event.at+event.duration,end=Math.min(duration,eventEnd);
      // Keep the selected source duration unless the export actually cuts it.
      // (at + duration) - at can add/remove a boundary sample in Web Audio.
      const playDuration=end<eventEnd?end-event.at:event.duration,source=context.createBufferSource(),gain=context.createGain();
      let offset=event.start-decoded.offset;
      if(event.rate!==1){
        memory+=Math.ceil(playDuration*rate)*8;if(memory>memoryLimit)throw Error('Le traitement des ralentis audio dépasse la mémoire disponible. Réduisez la durée des extraits.');
        progress('Adaptation de la vitesse sans déformer la hauteur des voix…');source.buffer=await preservePitch(decoded.buffer,offset,playDuration,event.rate,signal);offset=0;
      }else source.buffer=decoded.buffer;
      source.connect(gain);gain.connect(context.destination);
      gain.gain.setValueAtTime(event.gain(event.at),event.at);
      for(let t=event.at+.01;t<end;t+=.01)gain.gain.linearRampToValueAtTime(event.gain(t),t);
      gain.gain.linearRampToValueAtTime(event.gain(end),end);
      source.start(event.at,offset,playDuration);
    }
    progress('Mixage du son à 48 kHz…');const buffer=await context.startRendering();signal.throwIfAborted();
    let peak=0;for(let c=0;c<buffer.numberOfChannels;c++)for(const sample of buffer.getChannelData(c))peak=Math.max(peak,Math.abs(sample));
    if(peak>1.00001)throw Error(`Le mixage sature (${(20*Math.log10(peak)).toFixed(1)} dBFS). Réduisez les volumes des pistes avant l’export.`);
    return {buffer,peak,audible:peak>1e-6};
  }finally{signal.removeEventListener('abort',abort);inputs.forEach(input=>input.dispose());cache.clear();}
}
