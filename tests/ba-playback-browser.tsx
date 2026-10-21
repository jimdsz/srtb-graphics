import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import Preview from '../src/studio/Preview';
import {getTemplate,templateDefaults} from '../src/studio/domain';
import '../src/studio/studio.css';
import '../src/studio/theme.css';
const template=getTemplate('BTV_BA_1P'),wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
function assert(value:unknown,message:string){if(!value)throw Error(message);}
function Bench(){
  const [mode,setMode]=useState<'canvas'|'svg'|'svg-all-png'>('canvas'),[format,setFormat]=useState('tv'),[busy,setBusy]=useState(false),[result,setResult]=useState('Prêt.');
  async function run(){setBusy(true);setResult('Contrôle du vrai moteur et des médias…');const g:any=document.querySelector('.graphic-host')!.firstElementChild;const checks:any[]=[];
    try{
      const transport=g.__previewTransport;assert(transport,'Aperçu encore en chargement');assert(g.__previewPlaybackStats,'Adaptateur absent');
      await transport.start();await wait(650);await transport.pause();const entry=transport.snapshot();assert(!entry.playing,'Pause IN');checks.push({step:'entrée',seconds:entry.seconds});
      await transport.seek(11.52);const node=g.media.node('body') as HTMLVideoElement;const before=node.currentTime,quality=node.getVideoPlaybackQuality?.();
      await transport.resume();await wait(2200);await transport.pause();const after=node.currentTime,q2=node.getVideoPlaybackQuality?.(),position=transport.snapshot();
      assert(after-before>1.5,'La vidéo ne progresse pas');assert(!position.playing&&node.paused,'Pause corps');assert((q2?.totalVideoFrames||0)>(quality?.totalVideoFrames||0),'Aucune nouvelle image décodée');
      checks.push({step:'corps',sourceBefore:before,sourceAfter:after,decodedFrames:(q2?.totalVideoFrames||0)-(quality?.totalVideoFrames||0),position:position.seconds,stats:g.__previewPlaybackStats()});
      const seeksBefore=g.__previewPlaybackStats().find((s:any)=>s.kind==='body').seeks;
      await wait(1800);await transport.resume();await wait(650);await transport.pause();
      const seeksAfter=g.__previewPlaybackStats().find((s:any)=>s.kind==='body').seeks;
      assert(seeksAfter===seeksBefore,'La pause déclenche un seek intempestif à la reprise');checks.push({step:'pause prolongée',seeksBefore,seeksAfter});
      // Real video playing, but its returned promise deliberately never settles:
      // reproduces the old single-slot lock independently of network throughput.
      const original=node.play.bind(node);node.play=()=>{void original().catch(()=>{});return new Promise(()=>{});};
      try{await transport.resume();await wait(350);const start=performance.now();await transport.pause();const pauseMs=performance.now()-start;assert(pauseMs<500,'Pause bloquée par play()');checks.push({step:'play suspendu',pauseMs});}finally{node.play=original;}
      await transport.resume();await wait(350);await transport.out();await wait(450);await transport.pause();assert(transport.snapshot().phase==='paused','Pause OUT');checks.push({step:'sortie',seconds:transport.snapshot().seconds});
      await transport.clear();assert(!transport.snapshot().playing,'Effacer');setResult(JSON.stringify({pass:true,mode,format,checks},null,2));
    }catch(error){setResult(JSON.stringify({pass:false,error:String(error),checks},null,2));}finally{setBusy(false);}
  }
  async function gpuFailure(){
    setBusy(true);setResult('Perte du processeur graphique simulée…');
    const original=WebGLRenderingContext.prototype.texImage2D;
    let injected=false;
    try{
      const g:any=document.querySelector('.graphic-host')!.firstElementChild,transport=g.__previewTransport;
      assert(transport,'Aperçu encore en chargement');await transport.seek(11.52);
      WebGLRenderingContext.prototype.texImage2D=function(this:WebGLRenderingContext,...args:any[]){
        if(!injected&&args.length===6){injected=true;const extension=this.getExtension('WEBGL_lose_context');assert(extension,'Simulation non disponible');extension!.loseContext();}
        return (original as any).apply(this,args);
      } as any;
      await transport.resume();const begun=performance.now();
      while(g.state.phase!=='error'&&performance.now()-begun<2000)await wait(50);
      assert(injected&&g.state.phase==='error','La perte GPU reste silencieuse');
      const stopped=transport.snapshot();await wait(180);const after=transport.snapshot();
      assert(!stopped.playing&&after.seconds===stopped.seconds,'Le compteur avance sur une image périmée');
      assert(g.media.node('body').paused,'La vidéo continue derrière l’erreur');
      setResult(JSON.stringify({pass:true,mode,format,simulatedGraphicsLoss:true,clockStopped:true,mediaPaused:true},null,2));
    }catch(error){setResult(JSON.stringify({pass:false,error:String(error)},null,2));}
    finally{WebGLRenderingContext.prototype.texImage2D=original;setBusy(false);}
  }
  async function canvasFailure(secondary=false){
    setBusy(true);setResult('Perte d’une surface 2D simulée pendant la vraie lecture…');
    const original=CanvasRenderingContext2D.prototype.drawImage;let injected=false;
    try{
      assert(location.origin==='http://127.0.0.1:5192','Injection strictement locale');
      const g:any=document.querySelector('.graphic-host')!.firstElementChild,transport=g.__previewTransport;
      assert(transport&&format==='tv','Aperçu TV encore en chargement');await transport.seek(11.52);await transport.resume();await wait(750);
      const node=g.media.node('body') as HTMLVideoElement,q=node.getVideoPlaybackQuality();await wait(500);
      const decoded=node.getVideoPlaybackQuality().totalVideoFrames-q.totalVideoFrames;assert(decoded>=5,'Source non décodée avant injection');
      if(mode==='canvas'){
        const target=g.scene.canvases.targets.body[secondary?1:0] as HTMLCanvasElement;assert(target,'Surface directe absente');
        target.dispatchEvent(new Event('contextlost'));injected=true;
      }else if(mode==='svg'){
        const target=g.shadowRoot.querySelector('[data-studio-body-presentation="html"] canvas') as HTMLCanvasElement;
        assert(target,'Surface HTML hybride absente');target.dispatchEvent(new Event('contextlost'));injected=true;
      }else{
        // The publisher snapshot is deliberately detached; fault injection only
        // at the next real canvas copy, not a production API or a pixel readback.
        CanvasRenderingContext2D.prototype.drawImage=function(...args:any[]){
          (original as any).apply(this,args);
          if(!injected&&this.canvas instanceof HTMLCanvasElement&&this.canvas.width>=300&&args[0] instanceof HTMLCanvasElement){injected=true;this.canvas.dispatchEvent(new Event('contextlost'));}
        } as any;
      }
      const begin=performance.now();while(g.state.phase!=='error'&&performance.now()-begin<2500)await wait(50);
      assert(injected&&g.state.phase==='error','La surface figée reste silencieuse');
      const stopped=transport.snapshot();await wait(250);const after=transport.snapshot();
      assert(!stopped.playing&&stopped.seconds===after.seconds&&node.paused,'Compteur ou vidéo continue après perte de surface');
      const report={pass:true,mode,secondary,renderer:g.__previewRenderer,injection:'contextlost synthétique, pas une perte matérielle Mac',decodedBeforeLoss:decoded,clockStopped:true,mediaPaused:true,error:g.state.errors};
      const evidence=`ba-canvas-loss-${Date.now()}.json`;
      const response=await fetch('/__video-evidence/'+evidence,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report,null,2)});assert(response.ok,'Rapport non enregistré');
      setResult(JSON.stringify({...report,evidence},null,2));
    }catch(error){setResult(JSON.stringify({pass:false,error:String(error)},null,2));}
    finally{CanvasRenderingContext2D.prototype.drawImage=original;setBusy(false);}
  }
  async function outgoingWait(){
    setBusy(true);setResult('Attente de la vidéo sortante simulée, passage au corps…');let restore=()=>{};
    try{
      const g:any=document.querySelector('.graphic-host')!.firstElementChild,transport=g.__previewTransport;
      assert(transport,'Aperçu encore en chargement');await transport.seek(4.16);
      const media=g.media,ensure=media.ensure.bind(media),intro=media.node('intro') as HTMLVideoElement,body=media.node('body') as HTMLVideoElement;
      const quality=body.getVideoPlaybackQuality?.();let release!:(node:HTMLVideoElement)=>void;
      const pending=new Promise<HTMLVideoElement>(resolve=>release=resolve);
      media.ensure=(track:any,index:number)=>track.kind==='intro'?pending:ensure(track,index);
      restore=()=>{media.ensure=ensure;release(intro);};
      // The inactive body may retain a previous run's source time. Observe its
      // progress after the transition, not relative to that unrelated old time.
      await transport.resume();await wait(2000);const before=body.currentTime;await wait(300);
      const after=body.currentTime,q2=body.getVideoPlaybackQuality?.();
      assert(after-before>.15,'L’introduction empêche la vidéo suivante de démarrer');
      assert(!media.tracks.intro.playing&&intro.paused,'La source sortante reste active');
      assert((q2?.totalVideoFrames||0)>(quality?.totalVideoFrames||0),'Le corps ne décode aucune image');
      const start=performance.now();await transport.pause();const pauseMs=performance.now()-start;
      assert(pauseMs<500,'Pause attend la source sortante');restore();await wait(100);
      assert(intro.paused&&body.paused,'Une réponse tardive a relancé une vidéo');
      setResult(JSON.stringify({pass:true,mode,format,simulatedOutgoingWait:true,bodyProgressSeconds:after-before,bodyProgressObservationMs:300,decodedFrames:(q2?.totalVideoFrames||0)-(quality?.totalVideoFrames||0),pauseMs,lateSourceStayedPaused:true},null,2));
    }catch(error){setResult(JSON.stringify({pass:false,error:String(error)},null,2));}
    finally{restore();setBusy(false);}
  }
  async function futureFailure(){
    setBusy(true);setResult('Préchargement du prochain extrait en panne, vidéo courante réelle…');let restore=()=>{};
    try{
      const g:any=document.querySelector('.graphic-host')!.firstElementChild,transport=g.__previewTransport;
      assert(transport,'Aperçu encore en chargement');await transport.seek(11.52);
      const media=g.media,track=media.tracks.body,originalClips=track.clips,originalLength=track.length,ensure=media.ensure.bind(media);
      const node=media.node('body') as HTMLVideoElement,before=node.currentTime,quality=node.getVideoPlaybackQuality();
      let attempts=0,reject!:(error:Error)=>void;
      const future={...originalClips[0],node:null,loading:null,start:20,end:22,length:2};
      track.clips=[...originalClips,future];track.length+=2/track.rate;
      const pending=new Promise<HTMLVideoElement>((_,fail)=>reject=fail);
      media.ensure=(t:any,index:number)=>t===track&&t.clips[index]===future?(attempts++,pending):ensure(t,index);
      restore=()=>{media.ensure=ensure;track.clips=originalClips;track.length=originalLength;};
      await transport.resume();await wait(900);reject(Error('Panne réseau simulée du prochain extrait'));
      await wait(1200);
      const after=node.currentTime,q2=node.getVideoPlaybackQuality();
      assert(attempts===1,'Le chargement anticipé est relancé à chaque image');
      assert(g.state.phase!=='error'&&transport.snapshot().playing,'Le prochain extrait interrompt la vidéo courante');
      assert(after-before>1.5&&q2.totalVideoFrames>quality.totalVideoFrames,'La vraie vidéo ne progresse plus');
      const started=performance.now();await transport.pause();const pauseMs=performance.now()-started;
      assert(pauseMs<500&&node.paused,'Pause bloquée');
      setResult(JSON.stringify({pass:true,mode,format,simulatedFutureFailure:true,attempts,sourceProgress:after-before,decodedFrames:q2.totalVideoFrames-quality.totalVideoFrames,pauseMs},null,2));
    }catch(error){setResult(JSON.stringify({pass:false,error:String(error)},null,2));}
    finally{restore();setBusy(false);}
  }
  async function frameCallbacks(freeze=false){
    setBusy(true);setResult('Contrôle des images reçues avec compteur de qualité indisponible…');let restore=()=>{};const checks:any[]=[];
    try{
      const g:any=document.querySelector('.graphic-host')!.firstElementChild,transport=g.__previewTransport;
      assert(transport,'Aperçu encore en chargement');await transport.seek(11.52);
      const node=g.media.node('body') as HTMLVideoElement;
      const quality=node.getVideoPlaybackQuality,request=node.requestVideoFrameCallback,play=node.play;
      const currentTime=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'currentTime')!;
      let frozen=false,start=0,base=0;
      restore=()=>{node.getVideoPlaybackQuality=quality;node.requestVideoFrameCallback=request;node.play=play;delete (node as any).currentTime;delete (node as any).paused;};
      node.getVideoPlaybackQuality=()=>({totalVideoFrames:0,droppedVideoFrames:0,corruptedVideoFrames:0,creationTime:0});
      node.requestVideoFrameCallback=callback=>request.call(node,(time,metadata)=>{if(!frozen)callback(time,metadata);});
      await transport.resume();await wait(1800);
      const observed=g.__previewPlaybackStats().find((s:any)=>s.kind==='body');
      assert(observed.progressSignal==='video-frame-callback'&&observed.observedVideoFrames>5,'Les callbacks réels ne sont pas observables sur ce navigateur');
      checks.push({step:'vrais callbacks, compteur qualité nul',...observed});
      if(freeze){
        // Fault injection only: freeze the real decoded image while deliberately
        // reporting an advancing source clock, like the reported failure mode.
        base=node.currentTime;start=performance.now();frozen=true;node.pause();
        Object.defineProperty(node,'currentTime',{configurable:true,get:()=>base+(performance.now()-start)/1000,set:(value:number)=>{currentTime.set!.call(node,value);base=value-(performance.now()-start)/1000;}});
        Object.defineProperty(node,'paused',{configurable:true,get:()=>false});node.play=()=>Promise.resolve();
        while(g.state.phase!=='error'&&performance.now()-start<7000)await wait(100);
        const stopped=transport.snapshot();assert(g.state.phase==='error'&&!stopped.playing,'Le gel avec compteur actif reste silencieux');
        checks.push({step:'gel simulé détecté',seconds:stopped.seconds,stats:g.__previewPlaybackStats()});
        restore();await transport.start();await wait(600);await transport.pause();assert(g.state.phase!=='error','La relance après erreur est bloquée');
      }else{await transport.pause();assert(node.paused,'Pause bloquée');}
      setResult(JSON.stringify({pass:true,mode,format,simulatedFreeze:freeze,checks},null,2));
    }catch(error){setResult(JSON.stringify({pass:false,error:String(error),checks},null,2));}
    finally{restore();setBusy(false);}
  }
  async function stall(){
    setBusy(true);setResult('Panne de décodeur simulée, puis reprise volontaire…');const g:any=document.querySelector('.graphic-host')!.firstElementChild;let restore=()=>{};
    try{
      const transport=g.__previewTransport;assert(transport,'Aperçu encore en chargement');await transport.seek(11.52);
      const node=g.media.node('body') as HTMLVideoElement,original=node.play.bind(node);restore=()=>{node.play=original;};
      const playsBefore=g.__previewPlaybackStats().find((s:any)=>s.kind==='body').playRequests;
      node.play=()=>Promise.resolve(); // Real source/device, deliberately refusing to advance.
      await transport.resume();const begun=performance.now();
      while(g.state.phase!=='error'&&performance.now()-begun<7500)await wait(100);
      const snapshot=transport.snapshot(),stats=g.__previewPlaybackStats();assert(g.state.phase==='error','Le décodeur figé n’est pas signalé');assert(!snapshot.playing,'Le compteur continue après la panne');
      assert(stats.find((s:any)=>s.kind==='body').playRequests-playsBefore<=12,'Trop de demandes de lecture pendant la panne');
      restore();await transport.start();await wait(500);await transport.pause();assert(g.state.phase!=='error','Impossible de relancer IN');
      setResult(JSON.stringify({pass:true,mode,format,simulatedDecoderStall:true,stoppedPosition:snapshot,stats,recovered:g.state.phase},null,2));
    }catch(error){setResult(JSON.stringify({pass:false,error:String(error)},null,2));}finally{restore();setBusy(false);}
  }
  return <main style={{maxWidth:1050,margin:'20px auto'}}><h1>BA · lecture vidéo et pause</h1><p>Vrais médias de démonstration. Aucun projet ni transfert de fichier personnel.</p><label>Présentation<select disabled={busy} value={mode} onChange={e=>setMode(e.target.value as any)}><option value="canvas">Chromium</option><option value="svg">Chemin compatible WebKit</option><option value="svg-all-png">SVG — toutes les images</option></select></label><label>Format<select disabled={busy} value={format} onChange={e=>setFormat(e.target.value)}><option value="tv">TV</option><option value="portrait">4:5</option><option value="vertical">9:16</option></select></label><button disabled={busy} onClick={()=>void run()}>Vérifier lecture, pause et sortie</button><button disabled={busy} onClick={()=>void outgoingWait()}>Simuler une attente pendant la transition</button><button disabled={busy} onClick={()=>void futureFailure()}>Simuler une panne du prochain extrait</button><button disabled={busy} onClick={()=>void stall()}>Simuler une vidéo figée et vérifier la reprise</button><button disabled={busy} onClick={()=>void gpuFailure()}>Simuler une perte graphique</button><button disabled={busy} onClick={()=>void canvasFailure()}>Simuler une perte de surface 2D</button><button disabled={busy||mode!=='canvas'} onClick={()=>void canvasFailure(true)}>Simuler la perte de la seconde surface</button><button disabled={busy} onClick={()=>void frameCallbacks()}>Vérifier les images sans compteur qualité</button><button disabled={busy} onClick={()=>void frameCallbacks(true)}>Simuler un gel avec compteur actif</button><pre role="status" aria-label="Résultat lecture">{result}</pre><Preview key={mode+format} template={template} data={{...templateDefaults(template),_studio_format:format}} mediaPresentation={mode}/></main>;
}
createRoot(document.querySelector('#root')!).render(<Bench/>);
