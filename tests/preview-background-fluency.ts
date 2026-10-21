import {unzipSync} from 'fflate';
import {extractPreviewBackgrounds,installPreviewBackgrounds} from '../src/studio/preview-backgrounds';
import type {LegacyGraphic} from '../src/studio/video/engine';
import type {BroadcastTemplate} from '../src/studio/domain';

const status=document.querySelector('#status')!,result=document.querySelector('#result')!,screen=document.querySelector('#screen')!;
const button=document.querySelector<HTMLButtonElement>('#run')!,records:unknown[]=[];
const show=(record:unknown)=>{records.push(record);result.textContent=JSON.stringify(records,null,2);};
const nextFrame=()=>new Promise<number>(resolve=>requestAnimationFrame(resolve));
const delay=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const round=(n:number)=>Math.round(n*100)/100;
async function measure<T>(run:()=>T|Promise<T>){
  const gaps:number[]=[];let previous=performance.now();
  const timer=setInterval(()=>{const now=performance.now();gaps.push(now-previous);previous=now;},1);
  await delay(20);gaps.length=0;previous=performance.now();const start=performance.now();
  const value=await run(),elapsed=performance.now()-start;await delay(20);clearInterval(timer);
  return {value,elapsedMs:round(elapsed),maxTimerGapMs:round(Math.max(0,...gaps))};
}
async function pixels(image:HTMLImageElement){
  await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
  const ctx=canvas.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(image,0,0);return ctx.getImageData(0,0,canvas.width,canvas.height).data;
}
function assert(ok:unknown,message:string):asserts ok{if(!ok)throw Error(message);}
button.onclick=async()=>{
  button.disabled=true;records.length=0;result.textContent='';
  try{
    for(const id of ['BTV_BA_TDS','BTV_BA_TDS_SUIVI_DE']){
      status.textContent=id+' · archives';
      const root='/library/v1.7.0/'+id+'/',bytes=await (await fetch('/preview-media/v2/'+id+'.zip')).arrayBuffer();
      const sync=await measure(()=>unzipSync(new Uint8Array(bytes))),worker=await measure(()=>extractPreviewBackgrounds(bytes.slice(0),new AbortController().signal));
      for(const [key,original]of Object.entries(sync.value))assert(original.length===worker.value[key]?.length&&original.every((b,i)=>b===worker.value[key][i]),'Worker PNG mismatch '+key);
      show({id,phase:'archive',bytes:bytes.byteLength,synchronous:{elapsedMs:sync.elapsedMs,maxTimerGapMs:sync.maxTimerGapMs},worker:{elapsedMs:worker.elapsedMs,maxTimerGapMs:worker.maxTimerGapMs},bytesEqual:true});
      const template=await(await fetch(root+'lib/lottie-template.json')).json(),config=template.btvAutomation.backgroundSequence;
      const module=await import(/* @vite-ignore */root+'ferryman-base.mjs');
      const tag='sequence-test-'+id.toLowerCase().replaceAll('_','-');if(!customElements.get(tag))customElements.define(tag,module.default);
      const index=JSON.parse(new TextDecoder().decode(sync.value['index.json'])),unique=new Map<string,string>(),urls:string[]=[];
      for(let frame=config.firstFrame;frame<=config.lastFrame;frame++){
        const name=index.frames[String(frame)];if(!unique.has(name))unique.set(name,URL.createObjectURL(new Blob([sync.value[name] as Uint8Array<ArrayBuffer>],{type:'image/png'})));urls.push(unique.get(name)!);
      }
      for(const mode of ['legacy','prepared']){
        status.textContent=id+' · '+mode+' · lecture 25 i/s';
        const g=document.createElement(tag) as LegacyGraphic;g.state.lottieTemplate=template;screen.replaceChildren(g);
        try{
          if(mode==='prepared'){installPreviewBackgrounds(g,{id,libraryVersion:'1.7.0'} as BroadcastTemplate,()=>{});await g._loadBackgroundSequence();}
          else{
            const image=new Image();image.id='btv-background-sequence';image.style.cssText='width:100%;height:100%';image.src=urls[0];await image.decode();g.shadow.append(image);
            g.state.backgroundImage=image;g.state.backgroundObjectUrls=urls;g.state.backgroundFrame=config.firstFrame;
          }
          let updates=0,notReady=0,nodeSwaps=0;const setTimes:number[]=[],rafGaps:number[]=[];
          const started=await nextFrame();let previous=started,last=-1;
          while(last<urls.length-1){
            const now=await nextFrame();rafGaps.push(now-previous);previous=now;
            const offset=Math.min(urls.length-1,Math.floor((now-started)/40));if(offset===last)continue;last=offset;
            const before=g.state.backgroundImage,t=performance.now();g._setBackgroundFrame(config.firstFrame+offset);setTimes.push(performance.now()-t);updates++;
            if(g.state.backgroundImage!==before)nodeSwaps++;
            if(!g.state.backgroundImage.complete||!g.state.backgroundImage.naturalWidth)notReady++;
          }
          show({id,phase:'playback',mode,updates,notDecodedAtFrame:notReady,preparedNodeSwaps:nodeSwaps,maxSetMs:round(Math.max(...setTimes)),maxRAFGapMs:round(Math.max(...rafGaps)),rafGapsOver50ms:rafGaps.filter(n=>n>50).length});
          if(mode==='prepared'){
            status.textContent=id+' · parité et sauts';
            const checkFrames=[0,1,35,75,110,200,config.lastFrame,25,300,100,0,config.lastFrame];
            for(const frame of checkFrames){
              g._setBackgroundFrame(frame);const image=g.state.backgroundImage as HTMLImageElement,reference=new Image();reference.src=urls[frame-config.firstFrame];
              const [actual,expected]=await Promise.all([pixels(image),pixels(reference)]);
              assert(actual.length===expected.length&&actual.every((n,i)=>n===expected[i]),'Pixel mismatch '+id+' frame '+frame);
              assert(image.naturalWidth===1920&&image.naturalHeight===1080,'Native resolution lost');
              assert(g.state.backgroundFrame===frame,'Frame clock mismatch');
            }
            g._setHybridVisible(false);g._setBackgroundFrame(1);await g.state.backgroundImage.decode();assert(g.state.backgroundImage.style.visibility==='hidden','Visibility lost');
            g._setHybridVisible(true);g._setBackgroundFrame(300);g._setBackgroundFrame(20);await g.state.backgroundImage.decode();await delay(100);
            assert(g.state.backgroundFrame===20,'Stale seek published');assert(g.shadow.querySelectorAll('#btv-background-sequence').length===1,'Background layer duplicated');
            show({id,phase:'parity',frames:checkFrames,exactPixels:true,resolution:'1920x1080',visibilityPreserved:true,rapidSeek:true});
          }
        }finally{
          // The legacy fixture shares reference URLs with the next run.
          if(mode==='legacy')g.state.backgroundObjectUrls=[];
          await g.dispose();assert(!g.shadow.childNodes.length,'Disposed DOM retained');g.remove();
        }
      }
      unique.forEach(url=>URL.revokeObjectURL(url));
    }
    status.textContent='PASS · archives, lecture, pixels, horloge et nettoyage';
  }catch(error){status.textContent='ÉCHEC · '+String(error);show({error:String(error)});}finally{button.disabled=false;}
};
