import {getTemplate,templateDefaults} from '../src/studio/domain';
import {simpleBaDefaults} from '../src/studio/presentation';
import {exportBroadcastVideo} from '../src/studio/video/export';
import {NATIVE_ONLY_EXPORT} from '../src/studio/video/release-profile';
const status=document.querySelector('#status')!,result=document.querySelector('#result')!,outputs=document.querySelector('#outputs')!;
const run=document.querySelector<HTMLButtonElement>('#run')!;
const save=async(name:string,body:Blob|string)=>{const response=await fetch('/__social-evidence/'+name,{method:'POST',body});if(!response.ok)throw Error(await response.text());};
run.onclick=async()=>{
  run.disabled=true;const records:unknown[]=[],stamp=Date.now(),signal=new AbortController().signal;
  try{
    if(!NATIVE_ONLY_EXPORT)throw Error('Ce contrôle doit employer le même profil natif que la production.');
    for(const [id,format]of [['BTV_BA_TDS','portrait'],['BTV_BA_TDS','vertical'],['BTV_BA_TDS_SUIVI_DE','vertical'],['BTV_BA_1P','portrait']]){
      const template=getTemplate(id);let data=templateDefaults(template);
      if(id==='BTV_BA_1P')data=simpleBaDefaults(data);
      Object.assign(data,{_studio_format:format,_studio_logo_anchor:'top-right',_out_mode:'duration',_out_duration_seconds:id==='BTV_BA_1P'?10:id==='BTV_BA_TDS'?15.28:24.28});
      for(const [key,value]of Object.entries({_audio_voice_enabled:false,_audio_bed_enabled:true,_audio_bed_gain:.18,_audio_bed_volume:.18}))if(template.fields[key])data[key]=value;
      const kinds=id==='BTV_BA_1P'?['intro','body','pack']:id==='BTV_BA_TDS'?['background']:['programme_1','programme_2'];
      if(id==='BTV_BA_TDS')data._background_visible=true;
      if(id==='BTV_BA_TDS_SUIVI_DE')data._media_mode='internal';
      for(const kind of kinds)Object.assign(data,{[`_media_${kind}_url`]:'/library/v1.7.0/BTV_BA_1P/lib/media/programme.mp4',[`_media_${kind}_start_seconds`]:2,[`_media_${kind}_end_seconds`]:8,[`_media_${kind}_loop`]:true,[`_media_${kind}_audio_enabled`]:id==='BTV_BA_1P'?kind==='body':true,[`_media_${kind}_volume`]:.12,[`_media_${kind}_sequence`]:'[]'});
      const saved=JSON.stringify(data),filename=`social-sequences-${id.toLowerCase().replaceAll('_','-')}-${format}-${stamp}.mp4`,start=performance.now();
      const exported=await exportBroadcastVideo(template,data,{format:'mp4',manualOut:Number(data._out_duration_seconds),removeBackground:false,audio:true,background:'#000000'},signal,p=>status.textContent=`${id} · ${format} · ${p.message}`);
      try{
        if(JSON.stringify(data)!==saved)throw Error('Les réglages ont changé pendant l’export.');
        if(!exported.report.audio||exported.report.audioPeak<=.00001)throw Error('Export sans audio audible.');
        if(exported.report.exportProfile!=='native-only')throw Error('Mauvais profil de qualification.');
        await save(filename,exported.blob);
        const record={id,format,filename,report:exported.report,seconds:(performance.now()-start)/1000};records.push(record);result.textContent=JSON.stringify(records,null,2);
        const label=document.createElement('h2'),video=document.createElement('video');label.textContent=`${template.name} · ${format}`;video.controls=true;video.src=URL.createObjectURL(exported.blob);outputs.append(label,video);
      }finally{await exported.dispose();}
    }
    const proof={status:'PASS',records,source:'Bundled qualification media only; no production API',nativeProfile:true};result.textContent=JSON.stringify(proof,null,2);await save(`social-sequences-exports-${stamp}.json`,JSON.stringify(proof,null,2));status.textContent='PASS · quatre exports complets avec audio';
  }catch(error){status.textContent='ÉCHEC · '+String(error);result.textContent=JSON.stringify({status:'FAIL',records,error:String(error)},null,2);}finally{run.disabled=false;}
};
