import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import Preview from '../src/studio/Preview';
import {getTemplate,templateDefaults} from '../src/studio/domain';
import '../src/studio/studio.css';
import '../src/studio/theme.css';

// Local synthetic test settings only. Never create projects or upload media.
if(location.origin!=='http://127.0.0.1:5192')throw Error('Recette locale uniquement.');
const template=getTemplate('BTV_BA_1P'),wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const sequence=[2,3].map(start=>({url:'/library/v1.7.0/BTV_BA_1P/lib/media/programme.mp4',start,end:start+.2}));
const data={...templateDefaults(template),_media_body_sequence:JSON.stringify(sequence),_media_body_loop:true,_media_body_rate:1};
function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
function Bench(){
  const [mode,setMode]=useState<'canvas'|'svg'>('canvas'),[busy,setBusy]=useState(false),[result,setResult]=useState('Prêt.');
  async function run(frozen:boolean){
    setBusy(true);setResult('Lecture de deux vrais extraits courts en boucle…');let restore=()=>{};
    const checks:any[]=[];
    try{
      const g:any=document.querySelector('.graphic-host')!.firstElementChild,transport=g.__previewTransport;
      assert(transport&&g.__previewPlaybackStats,'Aperçu encore en chargement');
      await transport.seek(8);
      const nodes=g.media.tracks.body.clips.map((clip:any)=>clip.node) as HTMLVideoElement[];
      assert(nodes.length===2&&nodes.every(node=>node instanceof HTMLVideoElement),'Deux décodeurs vidéo attendus');
      const qualities=nodes.map(node=>node.getVideoPlaybackQuality()),before=g.__previewPlaybackStats().find((s:any)=>s.kind==='body');
      await transport.resume();await wait(2400);await transport.pause();
      const healthy=g.__previewPlaybackStats().find((s:any)=>s.kind==='body');
      const decoded=nodes.map((node,index)=>node.getVideoPlaybackQuality().totalVideoFrames-qualities[index].totalVideoFrames);
      assert(g.state.phase!=='error'&&healthy.recoveries===0,'Une boucle saine a été arrêtée');
      assert(decoded.every((n:number)=>n>10),'Chaque extrait doit décoder de nouvelles images');
      checks.push({step:'boucle réelle saine',decoded,seeks:healthy.seeks-before.seeks,recoveries:healthy.recoveries});
      if(frozen){
        // Freeze only the devices' output contract. Seeks and the native scene
        // remain real; source quality is held so seek frames cannot fake recovery.
        const originals=nodes.map(node=>({node,play:node.play,quality:node.getVideoPlaybackQuality,q:node.getVideoPlaybackQuality()}));
        restore=()=>{for(const item of originals){item.node.play=item.play;item.node.getVideoPlaybackQuality=item.quality;}};
        for(const item of originals){item.node.pause();item.node.play=()=>Promise.resolve();item.node.getVideoPlaybackQuality=()=>({totalVideoFrames:item.q.totalVideoFrames,droppedVideoFrames:item.q.droppedVideoFrames,corruptedVideoFrames:item.q.corruptedVideoFrames,creationTime:item.q.creationTime});}
        await transport.resume();const begun=performance.now();
        while(g.state.phase!=='error'&&performance.now()-begun<15000)await wait(100);
        const stopped=transport.snapshot();
        assert(g.state.phase==='error'&&!stopped.playing,'La boucle figée ne signale pas sa panne');
        assert(nodes.every(node=>node.paused),'Des vidéos continuent après la panne');
        checks.push({step:'gel simulé de deux extraits',elapsedMs:performance.now()-begun,seconds:stopped.seconds,stats:g.__previewPlaybackStats()});
        restore();restore=()=>{};
        await transport.seek(8);await transport.resume();await wait(1000);
        assert(g.state.phase!=='error','Reprise volontaire impossible après erreur');
      }else{await transport.resume();await wait(5200);assert(g.state.phase!=='error','Une boucle saine finit par échouer');}
      const started=performance.now();await transport.pause();const pauseMs=performance.now()-started;
      assert(pauseMs<500&&nodes.every(node=>node.paused),'Pause lente ou vidéo encore active');
      checks.push({step:'pause finale',pauseMs,phase:g.state.phase,stats:g.__previewPlaybackStats()});
      const report={pass:true,mode,simulatedFreeze:frozen,checks};
      const evidence=`ba-sequence-recovery-${Date.now()}.json`;
      const response=await fetch('/__video-evidence/'+evidence,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report,null,2)});
      assert(response.ok,'Écriture locale du bilan refusée');
      setResult(JSON.stringify({...report,evidence},null,2));
    }catch(error){setResult(JSON.stringify({pass:false,mode,simulatedFreeze:frozen,error:String(error),checks},null,2));}
    finally{restore();setBusy(false);}
  }
  return <main style={{maxWidth:1050,margin:'20px auto'}}><h1>BA — séquences courtes et reprise</h1><p>Médias de démonstration, aucun projet modifié.</p><label>Présentation<select disabled={busy} value={mode} onChange={e=>setMode(e.target.value as 'canvas'|'svg')}><option value="canvas">Chromium</option><option value="svg">Chemin compatible WebKit</option></select></label><button disabled={busy} onClick={()=>void run(false)}>Contrôler une boucle saine</button><button disabled={busy} onClick={()=>void run(true)}>Simuler le gel de la boucle puis reprendre</button><pre role="status" aria-label="Résultat séquence">{result}</pre><Preview key={mode} template={template} data={data} mediaPresentation={mode}/></main>;
}
createRoot(document.querySelector('#root')!).render(<Bench/>);
