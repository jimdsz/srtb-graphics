import {getTemplate,templateDefaults,validateProjectData} from '../src/studio/domain';
import type {ProjectData} from '../src/studio/domain';
import {simpleBaDefaults,dimensions,engineData} from '../src/studio/presentation';
import {prepareGraphic} from '../src/studio/video/engine';

const scheduledTemplate=getTemplate('BTV_BA_1P');
const immediateTemplate=getTemplate('BTV_BA_TDS');
const image='/library/v1.7.0/BTV_Ce_Soir/lib/media/programme.jpg';
const announcements=[['Jour et heure','Mardi','20h30'],['Demain','Demain','20h30'],['Aujourd’hui','Aujourd’hui','20h30'],['Ce soir','Ce soir','20h30'],['Tout de suite','Tout de suite','']] as const;
const formats=['tv','portrait','vertical'] as const;
const button=document.querySelector<HTMLButtonElement>('#run')!,cancel=document.querySelector<HTMLButtonElement>('#cancel')!;
const status=document.querySelector<HTMLElement>('#status')!,result=document.querySelector<HTMLElement>('#result')!,gallery=document.querySelector<HTMLElement>('#gallery')!;
let controller:AbortController|undefined;
function ensure(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
function fixture(announcement:string,time:string,format:string):{template:typeof scheduledTemplate;data:ProjectData}{
  if(announcement==='Tout de suite'){
    const data={...templateDefaults(immediateTemplate),_studio_format:format,
      _titre_ligne_1:'LE GRAND',_titre_ligne_2:'ENTRETIEN',_titre_ligne_3:'',_theme:'MAGAZINE',_sous_titre:'',
      _background_visible:true,_media_background_url:image,_media_background_start_seconds:0,
      _media_background_end_seconds:30,_media_background_sequence:'[]',_media_background_loop:false,
      _out_mode:'manual',_out_duration_seconds:16} as ProjectData;
    for(const key of Object.keys(data))if(/_audio.*enabled$/.test(key))data[key]=false;
    return {template:immediateTemplate,data:validateProjectData(immediateTemplate,data)};
  }
  const data={...simpleBaDefaults(templateDefaults(scheduledTemplate)),_studio_format:format,_jour_1:announcement,_heure_1:time,
    _jour_2:'MERCREDI À NE PAS AFFICHER',_heure_2:'09h00',_jour_3:'JEUDI À NE PAS AFFICHER',_heure_3:'11h00',
    _titre_ligne_1:'LE GRAND',_titre_ligne_2:'ENTRETIEN',_titre_ligne_3:'',_out_mode:'manual',_out_duration_seconds:12} as ProjectData;
  for(const key of Object.keys(data)){
    if(/_audio.*enabled$/.test(key))data[key]=false;
    if(/^_media_.+_sequence$/.test(key))data[key]='[]';
    if(/^_media_.+_url$/.test(key)&&data[key]){
      const prefix=key.slice(0,-4);data[key]=image;
      if(prefix+'_start_seconds'in data)data[prefix+'_start_seconds']=0;
      if(prefix+'_end_seconds'in data)data[prefix+'_end_seconds']=30;
      if(prefix+'_rate'in data)data[prefix+'_rate']=1;
    }
  }
  return {template:scheduledTemplate,data:validateProjectData(scheduledTemplate,data)};
}
async function hash(canvas:HTMLCanvasElement){
  const bytes=canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data;
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
button.addEventListener('click',async()=>{
  controller=new AbortController();button.disabled=true;cancel.disabled=false;gallery.replaceChildren();result.textContent='';
  const records:unknown[]=[],started=performance.now();
  try{
    for(const format of formats){
      const hashes=new Set<string>();
      for(const [label,announcement,time]of announcements){
        controller.signal.throwIfAborted();status.textContent=`Rendu ${records.length+1}/15 · ${label} · ${format}`;
        const fixtureData=fixture(announcement,time,format),{template,data}=fixtureData,before=JSON.stringify(data),native=engineData(data);
        if(template.id==='BTV_BA_TDS'){
          ensure(!('_jour_1'in native)&&!('_heure_1'in native),'Le modèle Tout de suite ne doit recevoir ni jour ni horaire.');
        }else{
          ensure(native._jour_2===''&&native._heure_2===''&&native._jour_3===''&&native._heure_3==='','Les horaires cachés doivent rester exclus du moteur simple.');
          ensure(native._jour_1===announcement&&native._heure_1===time,'Le libellé ou l’horaire a été remplacé.');
        }
        const outAt=template.id==='BTV_BA_TDS'?16:12;
        const prepared=await prepareGraphic(template,data,outAt,false,controller.signal);
        try{
          const figure=document.createElement('figure'),caption=document.createElement('figcaption');caption.textContent=template.id==='BTV_BA_TDS'?`${label} · ${format} — moteur immédiat dédié`:`${label} · ${format} — corps puis carton`;figure.append(caption);
          const {width,height}=dimensions(data),samples=[];
          // Le moteur Tout de suite est volontairement différent : grand cartouche
          // horizontal, puis signature sur deux lignes, sans bloc jour/heure.
          const checkpoints=template.id==='BTV_BA_TDS'?[2.8,8]:[8,17];
          for(const seconds of checkpoints){
            const frame=await prepared.frame(Math.round(seconds*25),null);ensure(frame.width===width&&frame.height===height,'Dimensions de composition incorrectes.');
            const fingerprint=await hash(frame);samples.push({seconds,sha256:fingerprint});
            const thumbnail=document.createElement('canvas');thumbnail.width=Math.round(width/4);thumbnail.height=Math.round(height/4);thumbnail.getContext('2d')!.drawImage(frame,0,0,thumbnail.width,thumbnail.height);figure.append(thumbnail);
          }
          if(template.id==='BTV_BA_TDS'&&format==='tv')ensure(samples[0].sha256!==samples[1].sha256,'Le moteur Tout de suite TV ne passe pas du grand titre horizontal à la signature deux lignes.');
          ensure(!hashes.has(samples[0].sha256),'Deux annonces donnent exactement la même image du corps.');hashes.add(samples[0].sha256);
          ensure(JSON.stringify(data)===before,'Le rendu a modifié les réglages source.');gallery.append(figure);
          records.push({format,label,templateId:template.id,announcement,time,width,height,duration:prepared.timeline.duration,samples,result:'PASS'});
        }finally{await prepared.dispose();}
      }
    }
    const report={scope:'Rendu isolé de quatre annonces BA simples et du moteur Tout de suite dédié, en trois formats, sans voix ni export encodé.',status:'PASS',count:records.length,elapsedMs:Math.round(performance.now()-started),records};
    result.textContent=JSON.stringify(report,null,2);
    const response=await fetch(`/__social-evidence/announcement-layout-${Date.now()}.json`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report,null,2)});
    ensure(response.ok,'Le rendu est terminé mais le rapport local n’a pas été enregistré.');status.textContent='PASS — 15 compositions rendues, rapport enregistré localement.';
  }catch(error){status.textContent=controller.signal.aborted?'Recette annulée.':`ÉCHEC : ${error instanceof Error?error.message:String(error)}`;result.textContent=JSON.stringify({completed:records,error:String(error)},null,2);}
  finally{button.disabled=false;cancel.disabled=true;controller=undefined;}
});
cancel.addEventListener('click',()=>controller?.abort());
