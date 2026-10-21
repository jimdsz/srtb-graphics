import {useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import Preview from '../src/studio/Preview';
import {getTemplate,templateDefaults} from '../src/studio/domain';
import type {ProjectData} from '../src/studio/domain';
import '../src/studio/studio.css';
import '../src/studio/theme.css';
if(location.origin!=='http://127.0.0.1:5192')throw Error('Recette locale uniquement.');
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
async function until(check:()=>boolean,message:string,ms=20000){const end=performance.now()+ms;while(!check()){if(performance.now()>end)throw Error(message);await wait(60);}}
function Bench(){
 const mount=useRef<HTMLDivElement>(null),[busy,setBusy]=useState(false),[result,setResult]=useState('Prêt.');
 async function run(){
  setBusy(true);const checks:any[]=[];let root:ReturnType<typeof createRoot>|undefined;
  const decode=HTMLImageElement.prototype.decode;let rejectOnce=false,injected=0;
  // Explicit fixture fault, never installed in production or outside loopback.
  HTMLImageElement.prototype.decode=function(){if(rejectOnce&&this.src.startsWith('blob:')){rejectOnce=false;injected++;return Promise.reject(Error('Recette : décodage image interrompu'));}return decode.call(this);};
  try{
   for(const testCase of [
    {id:'BTV_BA_1P',mode:'canvas',recovery:'button'},
    {id:'BTV_BA_1P',mode:'svg-all-png',recovery:'edit'},
    {id:'BTV_Semainier',mode:'svg',recovery:'button'},
   ] as const){
    const template=getTemplate(testCase.id),field=testCase.id==='BTV_BA_1P'?'_titre_ligne_1':'programme_1_title';
    let data:ProjectData={...templateDefaults(template),[field]:'RECETTE CONSERVÉE'};
    if(testCase.id==='BTV_Semainier')data._media_programme_1_url='/library/v1.7.0/BTV_BA_1P/lib/media/programme.mp4';
    root=createRoot(mount.current!);
    const render=()=>root!.render(<Preview template={template} data={data} onChange={next=>{data=next;render();}} mediaPresentation={testCase.mode}/>);
    render();setResult(`${testCase.id} ${testCase.mode} — chargement…`);
    const graphic=()=>mount.current!.querySelector('.graphic-host')?.firstElementChild as any;
    const button=(label:string)=>mount.current!.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement|null;
    const alert=()=>mount.current!.querySelector('[role="alert"]');
    await until(()=>!!graphic()?.__previewTransport,'Chargement incomplet',45000);
    const g=graphic(),transport=g.__previewTransport;
    await transport.seek(5);await transport.resume();await wait(300);
    setResult(`${testCase.id} ${testCase.mode} — panne ponctuelle…`);
    if(testCase.mode==='canvas'){
     const target=g.scene.canvases.targets.body[0] as HTMLCanvasElement;
     target.dispatchEvent(new Event('contextlost'));injected++;
    }else rejectOnce=true;
    await until(()=>!!alert(),'Erreur non affichée');await wait(200);
    const failure=alert()!.textContent!,before=transport.snapshot().seconds;
    assert(!transport.snapshot().playing,'Horloge encore en lecture');
    for(const label of ['Recommencer l’aperçu (IN)','Lire l’aperçu','Effacer l’aperçu','Activer le son']){
     const control=button(label);assert(control?.disabled,label+' accessible sur une scène invalide');control.click();
    }
    await wait(220);assert(alert()?.textContent===failure,'IN a effacé le message');
    assert(transport.snapshot().seconds===before,'Compteur encore mobile');
    await transport.clear();let prevented=false;
    try{await transport.start();}catch{prevented=true;}assert(prevented,'Clear a débloqué un presenter mort');
    if(testCase.recovery==='edit'){
     // A temporarily empty required title must stay editable, not loop reloads.
     data={...data,[field]:''};render();await wait(450);assert(graphic()===g,'Titre vide a relancé le moteur');
     data={...data,[field]:'TITRE CORRIGÉ'};render();
    }else{
     const relaunch=[...mount.current!.querySelectorAll('button')].find(b=>b.textContent==='Relancer l’aperçu')!;
     assert(relaunch&&!relaunch.disabled,'Relance inaccessible');relaunch.click();
    }
    await until(()=>graphic()!==g&&!!graphic()?.__previewTransport,'Nouvelle scène absente',45000);await wait(250);
    const fresh=graphic();assert(!alert(),'Erreur conservée après reconstruction');
    assert(data[field]===(testCase.recovery==='edit'?'TITRE CORRIGÉ':'RECETTE CONSERVÉE'),'Texte perdu');
    await fresh.__previewTransport.seek(5);await fresh.__previewTransport.resume();
    const stats=()=>testCase.id==='BTV_BA_1P'?fresh.__previewPresentationStats?.().reduce((n:number,s:any)=>n+s.presented+(s.htmlPresented||0),0):fresh.__previewPresentationStats?.().reduce((n:number,s:any)=>n+s.presented,0);
    const firstStats=stats(),start=fresh.__previewTransport.snapshot().seconds;await wait(850);
    assert(fresh.__previewTransport.snapshot().playing&&fresh.__previewTransport.snapshot().seconds>start+.4,'Nouvelle lecture figée');
    if(testCase.mode!=='canvas')assert(stats()>firstStats+3,'Nouvelles images non présentées');
    await fresh.__previewTransport.pause();
    // Ordinary draft validation must still recover without terminal media latch.
    if(testCase.id==='BTV_BA_1P'){
     const saved=data[field];data={...data,[field]:''};render();await wait(300);
     assert(graphic()===fresh&&!alert(),'Titre vide détruit la scène');
     data={...data,[field]:saved};render();await wait(700);
     assert(graphic()===fresh&&!alert(),'Correction de texte a invalidé la scène');
     assert(!button('Recommencer l’aperçu (IN)')?.disabled,'Lecture bloquée après correction');
    }
    checks.push({...testCase,stopped:true,clearCannotRevive:true,newInstance:true,draftPreserved:true,framesAfterRecovery:testCase.mode==='canvas'?'native canvas':stats()-firstStats,validationEditable:true});
    root.unmount();root=undefined;
   }
   const report={pass:true,injected,scope:'Chromium Windows réel, SVG forcé et pannes synthétiques ; pas une validation Mac/Safari.',checks};
   const evidence=`preview-presentation-recovery-${Date.now()}.json`;
   const response=await fetch('/__video-evidence/'+evidence,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report,null,2)});assert(response.ok,'Preuve non enregistrée');
   setResult(JSON.stringify({...report,evidence},null,2));
  }catch(error){setResult(JSON.stringify({pass:false,error:String(error),injected,checks},null,2));}
  finally{rejectOnce=false;HTMLImageElement.prototype.decode=decode;root?.unmount();setBusy(false);}
 }
 return <main style={{maxWidth:1050,margin:'20px auto'}}><h1>Reprise après erreur d’image</h1><p>Pannes simulées sur les moteurs réels, sans projet ni envoi de média.</p><button disabled={busy} onClick={()=>void run()}>Contrôler les trois reprises</button><pre role="status">{result}</pre><div ref={mount}/></main>;
}
createRoot(document.querySelector('#root')!).render(<Bench/>);
