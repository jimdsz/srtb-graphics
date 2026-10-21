import type {BroadcastTemplate} from './domain';
import type {LegacyGraphic} from './video/engine';
import {tracksOf} from './media-tracks';
import {studioEngineModule} from './text-editing';
import {resumeAudioClock} from './audio-clock-ready';
import {previewAudioCache} from './preview-audio-cache';
import {createPreviewAudioProxy,previewBedProxyAllowed,previewAudioCacheKey} from './preview-audio-proxy';
import {decodeBAAudio} from './ba-audio-clock';

type AudioOwner={context:AudioContext;bus:GainNode;cache:ReturnType<typeof previewAudioCache<AudioBuffer>>;proxy:ReturnType<typeof createPreviewAudioProxy<AudioBuffer>>};
const adapters=new WeakMap<object,{owner?:AudioOwner}>();
const proxyPolicy=new WeakMap<object,boolean>();
/** The BA replaces its audio engine on edits. Keep a preview-owned context so
 * the operator's gesture is not lost when a new source finishes downloading. */
export async function previewAudio(g:LegacyGraphic,template:BroadcastTemplate){
  const context=new AudioContext(),bus=context.createGain(),meter=context.createAnalyser();
  meter.fftSize=256;bus.connect(meter);meter.connect(context.destination);
  const knownBA=template.id==='BTV_BA_1P'&&template.version==='1.0.3'&&template.libraryVersion==='1.7.0'&&template.module==='/library/v1.7.0/BTV_BA_1P/graphic.mjs';
  const owner={context,bus,cache:previewAudioCache<AudioBuffer>(),proxy:createPreviewAudioProxy({decode:decodeBAAudio,enabled:knownBA})},nodes=new Map<HTMLMediaElement,MediaElementAudioSourceNode>(),created=new WeakMap<HTMLMediaElement,MediaElementAudioSourceNode>();
  try{
  if(template.id==='BTV_BA_1P'&&template.version==='1.0.3'&&template.libraryVersion==='1.7.0'){
    const {AudioEngine}=await import(/* @vite-ignore */new URL('audio.mjs',new URL(studioEngineModule(template),location.href)).href),prototype=AudioEngine.prototype;
    let slot=adapters.get(prototype);
    if(!slot){
      slot={};adapters.set(prototype,slot);const prepare=prototype.prepare,state=slot;
      prototype.prepare=function(...args:any[]){
        proxyPolicy.set(this,previewBedProxyAllowed(args[0],this.config,this.baseUrl,location.origin));
        // This synchronous constructor/prepare section runs before _update awaits.
        if(state.owner&&this.context!==state.owner.context){
          const original=this.context;this.master.disconnect();this.context=state.owner.context;this.ownsContext=false;
          this.master=this.context.createGain();this.master.gain.value=0;this.master.connect(state.owner.bus);void original.close().catch(()=>{});
          const cache=state.owner.cache,proxy=state.owner.proxy,read=this._load.bind(this);
          this._load=async(url:string,signal:AbortSignal,reload=false)=>{const allowed=proxyPolicy.get(this)!==false,key=previewAudioCacheKey(url,allowed,location.origin);return {url,buffer:await cache.load(key,signal,reload,async()=>(await proxy.load(url,signal,reload,read,allowed)).buffer)};};
          // A slow network gets a bounded grace period. The UI can cancel it;
          // exports keep the original loader and its original settings.
          this.timeoutMs=45000;
        }
        return prepare.apply(this,args);
      };
    }
    const update=g._update,state=slot;
    g._update=function(...args:any[]){const before=state.owner;state.owner=owner;try{return update.apply(this,args);}finally{state.owner=before;}};
  }
  }catch(error){bus.disconnect();meter.disconnect();void context.close().catch(()=>{});throw error;}
  const buffer=new Float32Array(meter.fftSize);
  let disposed=false;const lifetime=new AbortController();
  return {
    context,bus,
    unlock:()=>resumeAudioClock(context,{signal:lifetime.signal}),
    volume:(value:number)=>{bus.gain.value=Math.max(0,Math.min(1,value));},
    sample:()=>{
      if(disposed)return {peak:0,state:'closed'};
      const candidates=new Set<HTMLMediaElement>();
      for(const track of Object.values(tracksOf(g)))for(const clip of track.clips||[])if(clip.node instanceof HTMLMediaElement)candidates.add(clip.node);
      for(const track of Object.values(g.sound||{}) as {node?:HTMLMediaElement}[])if(track.node)candidates.add(track.node);
      if(g.audioBed instanceof HTMLMediaElement)candidates.add(g.audioBed);
      for(const node of candidates)if(!nodes.has(node)){const source=created.get(node)||context.createMediaElementSource(node);created.set(node,source);source.connect(bus);nodes.set(node,source);}
      for(const [node,source]of nodes)if(!candidates.has(node)){source.disconnect();nodes.delete(node);}
      meter.getFloatTimeDomainData(buffer);let peak=0;for(const value of buffer)peak=Math.max(peak,Math.abs(value));
      return {peak,state:context.state};
    },
    dispose:()=>{if(disposed)return;disposed=true;lifetime.abort();owner.proxy.dispose();owner.cache.dispose();for(const source of nodes.values())source.disconnect();nodes.clear();bus.disconnect();meter.disconnect();if(context.state!=='closed')void context.close().catch(()=>{});},
  };
}
