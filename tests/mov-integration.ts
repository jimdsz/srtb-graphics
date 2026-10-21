import {broadcastTemplates,getTemplate,templateDefaults} from '../src/studio/domain';
import {exportBroadcastVideo} from '../src/studio/video/export';
const status=document.querySelector('#status')!,results=document.querySelector('#results')!;
let control:AbortController|undefined;
const report=(value:unknown)=>results.textContent+='\n'+JSON.stringify(value,null,2);
async function run(mode:'all'|'rest'|'large'|'abort'){
  control=new AbortController();const signal=control.signal;document.querySelectorAll('button').forEach(b=>b.disabled=b.id!=='stop');results.textContent='';
  try{
    const templates=mode==='all'?broadcastTemplates:mode==='rest'?broadcastTemplates.filter(t=>t.id!=='BTV_BA_1P'):[getTemplate('BTV_PopUp')];
    for(const template of templates){
      const data=templateDefaults(template),start=performance.now();
      if(template.id==='BTV_Passerelle_Replay')data._replay_url='https://srtb.bj';
      // Native BA entry/OUT and sound remain intact, including the full default BA duration.
      if(mode==='large'){data._background_visible=false;data._media_popup_url='/__mov-source/network.mp4';data._media_popup_start_seconds=600;data._media_popup_end_seconds=606;data._media_popup_sequence='[]';data._media_popup_audio_enabled=true;}
      if(mode==='abort'){
        const abort=new AbortController();let aborted=false;
        try{const unwanted=await exportBroadcastVideo(template,data,{format:'mov',audio:true,manualOut:12,removeBackground:true,background:'#000000'},abort.signal,p=>{status.textContent=p.message;if(p.percent>=15)abort.abort();});await unwanted.dispose();}catch(error){if(!abort.signal.aborted)throw error;aborted=true;}
        if(!aborted)throw Error('Cancellation did not interrupt export');
        const dir=await(await navigator.storage.getDirectory()).getDirectoryHandle('srtb-temporary-exports');let remaining=0;for await(const _ of (dir as any).values())remaining++;
        if(remaining)throw Error('Temporary export not cleaned after cancellation');report({cancelled:true,temporaryFiles:remaining});
      }
      const result=await exportBroadcastVideo(template,data,{format:'mov',audio:true,manualOut:mode==='all'||mode==='rest'?Number(data._out_duration_seconds||12):12,removeBackground:template.id!=='BTV_BA_1P',background:'#000000'},signal,p=>status.textContent=template.id+' · '+p.message);
      try{
        const row={template:template.id,mode,...result.report,seconds:(performance.now()-start)/1000};report(row);
        const stem='integrated-'+template.id.toLowerCase().replaceAll('_','-')+'-'+mode+'-'+Date.now();
        for(const [ext,body]of [['mov',result.blob],['json',new Blob([JSON.stringify(row,null,2)])]] as const){const saved=await fetch('/__mov-evidence/'+stem+'.'+ext,{method:'POST',body,signal});if(!saved.ok)throw Error('Evidence: '+await saved.text());}
      }finally{await result.dispose();}
    }
    status.textContent='PASS · exports calculés, relus et preuves conservées localement';
  }catch(error){status.textContent='ÉCHEC · '+String(error);}
  finally{document.querySelectorAll('button').forEach(b=>b.disabled=b.id==='stop');}
}
document.querySelector('#all')!.addEventListener('click',()=>void run('all'));
document.querySelector('#rest')!.addEventListener('click',()=>void run('rest'));
document.querySelector('#large')!.addEventListener('click',()=>void run('large'));
document.querySelector('#abort')!.addEventListener('click',()=>void run('abort'));
document.querySelector('#stop')!.addEventListener('click',()=>control?.abort());
