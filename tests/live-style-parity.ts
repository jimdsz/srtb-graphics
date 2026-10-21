import {broadcastTemplates,templateDefaults} from '../src/studio/domain';
import {engineData,simpleBaDefaults} from '../src/studio/presentation';
import {prepareGraphic} from '../src/studio/video/engine';
import {textStyles} from '../src/studio/typography-model';
import {stripSupplementalVoice} from '../src/studio/supplemental-voice';
const button=document.querySelector<HTMLButtonElement>('#run')!,status=document.querySelector('#status')!,result=document.querySelector('#result')!;
button.onclick=async()=>{button.disabled=true;const records=[];try{
  const selected=new URLSearchParams(location.search).get('template');
  for(const template of broadcastTemplates.filter(t=>!selected||t.id===selected)){
    const phase=(message:string)=>{status.textContent=template.name+' · '+message;};
    phase('préparation');
    let data=templateDefaults(template);if(template.id==='BTV_BA_1P')data=simpleBaDefaults(data);
    data={...data,_studio_format:'tv',_studio_typography:'{}'};
    for(const key of Object.keys(data)){
      if(/_audio.*enabled$/.test(key))data[key]=false;
      if(/^_media_.+_sequence$/.test(key))data[key]='[]';
      if(/^_media_.+_url$/.test(key)&&data[key]){const prefix=key.slice(0,-4);data[key]='/library/v1.7.0/BTV_Ce_Soir/lib/media/programme.jpg';if(prefix+'_start_seconds'in data)data[prefix+'_start_seconds']=0;if(prefix+'_end_seconds'in data)data[prefix+'_end_seconds']=40;if(prefix+'_rate'in data)data[prefix+'_rate']=1;}
    }
    if(template.id==='BTV_Passerelle_Replay')data._replay_url='https://srtb.bj';
    const signal=new AbortController().signal,frame=template.id.startsWith('BTV_BA')?200:75;
    const live=await prepareGraphic(template,data,28,false,signal);
    try{
      phase('image initiale');await live.frame(frame,null);
      const boxes=live.graphic.__typography.boxes();
      const field=['_next_label','_titre_ligne_1','_p1_titre_ligne_1','_title','_heading'].find(key=>boxes.some((box:any)=>box.field===key))||boxes[0]?.field;
      if(!field)throw Error('Aucun texte visible : '+template.id);
      for(const stage of ['style','content']){
        const styles=textStyles(data);styles['tv:'+field]={...styles['tv:'+field],size:115,colour:'#ffffff'};
        const next={...data,_studio_typography:JSON.stringify(styles),...(stage==='content'?{[field]:'NOUVEAU TITRE'}:{})};
        phase(stage+' · mise à jour');const fast=await live.graphic.__typography.updateLive(engineData(next,true),()=>true);
        if(!fast){const response=await live.graphic.updateAction(stripSupplementalVoice(template,engineData(next,true)));if(response?.statusCode>=400)throw Error(JSON.stringify(response));}
        phase(stage+' · image éditée');const actual=await live.frame(frame,null),a=actual.getContext('2d')!.getImageData(0,0,1920,1080).data;
        phase(stage+' · référence');
        const fresh=await prepareGraphic(template,next,28,false,signal);
        try{const expected=await fresh.frame(frame,null),b=expected.getContext('2d')!.getImageData(0,0,1920,1080).data;let max=0,sum=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);max=Math.max(max,d);sum+=d;}const mean=sum/a.length;const record={template:template.id,field,stage,fast,max,mean,result:max<=2&&mean<=.01?'PASS':'FAIL'};records.push(record);result.textContent=JSON.stringify(records,null,2);}finally{await fresh.dispose();}
        data=next;
      }
    }finally{await live.dispose();}
  }
  status.textContent=records.every(r=>r.result==='PASS')?`PASS · ${records.length} comparaisons`:'FAIL · différences de rendu';
}catch(error){status.textContent='ÉCHEC · '+String(error);}finally{button.disabled=false;}};
