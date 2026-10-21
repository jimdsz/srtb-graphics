import {getTemplate,templateDefaults} from '../src/studio/domain';
import {studioEngineModule} from '../src/studio/text-editing';
import {installTypography} from '../src/studio/typography-engine';
import {patchTextStyle,textFields} from '../src/studio/typography-model';
import type {LegacyGraphic} from '../src/studio/video/engine';
const active:LegacyGraphic[]=[];
const button=document.querySelector<HTMLButtonElement>('#run')!;
button.onclick=async()=>{
 button.disabled=true;const result=document.querySelector('#result')!;result.textContent='Chargement…';
 try{
  for(const g of active){await g.dispose();g.remove();}active.length=0;
  const id=document.querySelector<HTMLSelectElement>('#model')!.value,t=getTemplate(id),time=Number(document.querySelector<HTMLInputElement>('#time')!.value);
  const field=id==='BTV_Semainier'?'programme_1_category':id==='BTV_Evenement'?'intro_top':'title';
  const m=await import(/* @vite-ignore */studioEngineModule(t)),tag='text-mask-'+id.toLowerCase().replaceAll('_','-');
  if(!customElements.get(tag))customElements.define(tag,class extends m.default{});
  const records=[];
  for(const kind of ['native','edited']){
   const data=templateDefaults(t);for(const key of Object.keys(data))if(key.startsWith('_media_')&&key.endsWith('_url'))data[key]='';
   if(kind==='edited')Object.assign(data,patchTextStyle(data,field,{size:100}));
   const g=document.createElement(tag) as LegacyGraphic;active.push(g);document.querySelector('#'+kind)!.append(g);installTypography(g,t,data);
   await g.load({data,previewMuted:true});await g.goToTime({seconds:time});
   records.push({kind,field,boxes:g.__typography.boxes()});
  }
  result.textContent=JSON.stringify(records,null,2);
 }catch(error){result.textContent=String(error);}finally{button.disabled=false;}
};
document.querySelector<HTMLButtonElement>('#qualify')!.onclick=async()=>{
 const result=document.querySelector('#result')!,records:unknown[]=[];result.textContent='Qualification en cours…';
 document.querySelector('#export-images')?.remove();const gallery=document.createElement('div');gallery.id='export-images';gallery.className='pair';result.before(gallery);
 const controls=[...document.querySelectorAll<HTMLButtonElement>('button')];controls.forEach(b=>b.disabled=true);
 try{
  const {prepareGraphic}=await import('../src/studio/video/engine');
  for(const [id,variant] of [['BTV_Semainier',''],['BTV_Evenement',''],['BTV_Renvoi','1L'],['BTV_Renvoi','2L']]){
   const t=getTemplate(id),data=templateDefaults(t);for(const key of Object.keys(data))if(key.startsWith('_media_')&&key.endsWith('_url'))data[key]='';
   if(id==='BTV_Renvoi'){data.variant=variant;if(variant==='2L'){data.title='STREET ART';data.title2='SANS FRONTIÈRES';}}
   let edited={...data};for(const [key]of textFields(t))edited={...edited,...patchTextStyle(edited,key,{size:100})};
   const signal=new AbortController().signal,native=await prepareGraphic(t,data,12,false,signal),styled=await prepareGraphic(t,edited,12,false,signal);
   try{
    const times=id==='BTV_Semainier'?[2.72,3.72,4.92,6.12,7.32,8.52,9.72,10.92,12.12,13.32,14.52,15.72,16.92,18.12,19.32,20.52,21.72,24.52,26.28]:id==='BTV_Evenement'?[0,.52,1.04,1.52,3,4.92,10.52,14.32,16,19,21]:[0,.52,1.52,3,5,8.96,9.96];
    for(const time of times){
     const n=await native.frame(Math.round(time*25),null),a=n.getContext('2d')!.getImageData(0,0,n.width,n.height).data;
     const e=await styled.frame(Math.round(time*25),null),b=e.getContext('2d')!.getImageData(0,0,e.width,e.height).data;
     let delta=0,na=0,ea=0;for(let i=3;i<a.length;i+=4){delta+=Math.abs(a[i]-b[i]);na+=a[i];ea+=b[i];}
     const broken=[...styled.graphic.shadowRoot!.querySelectorAll('[data-studio-text-field]')].filter(n=>n.getAttribute('transform')?.includes('[object'));
     if(broken.length)throw Error('Matrice SVG non sérialisée');
     // Matching text at 100% may differ at anti-aliased glyph edges, but must
     // not add a second opaque copy during a complementary reveal.
     if(id!=='BTV_Renvoi'&&Math.abs(na-ea)>10000)throw Error('Surface de texte incohérente '+id+' à '+time);
     if((id==='BTV_Semainier'&&[3.72,4.92].includes(time))||(id==='BTV_Evenement'&&time===16)||(id==='BTV_Renvoi'&&time===3))for(const [label,frame]of [['natif',n],['édité',e]]as const){const item=document.createElement('section'),caption=document.createElement('p'),copy=document.createElement('canvas');caption.textContent=`${id} ${variant} · ${time}s · export ${label}`;copy.width=frame.width;copy.height=frame.height;copy.style.width='100%';copy.getContext('2d')!.drawImage(frame,0,0);item.append(caption,copy);gallery.append(item);}
     records.push({id,variant,time,alphaDifference:delta/(a.length/4),nativeAlpha:na,editedAlpha:ea,revealLayers:styled.graphic.shadowRoot!.querySelectorAll('[data-studio-text-reveal]').length});
     result.textContent=JSON.stringify(records,null,2);
    }
    // Positions move the matte and text together, not the text into a fixed slit.
    const field=id==='BTV_Semainier'?'programme_1_category':id==='BTV_Evenement'?'intro_top':'title';
    const time=id==='BTV_Semainier'?4.92:id==='BTV_Evenement'?.52:3;
    await styled.frame(Math.round(time*25),null);const before=styled.graphic.__typography.boxes().filter((b:any)=>b.field===field);
    styled.graphic.__typography.nudge(field,160,-80);const after=styled.graphic.__typography.boxes().filter((b:any)=>b.field===field);
    if(!before.length||before.length!==after.length||after.some((b:any,i:number)=>Math.abs((b.x-before[i].x)*1920-160)>.1||Math.abs((b.y-before[i].y)*1080+80)>.1))throw Error('Déplacement imprécis '+id);
    const count=styled.graphic.shadowRoot!.querySelectorAll('[data-studio-text-reveal]').length;
    for(let i=0;i<3;i++)await styled.graphic.updateAction({...data,_studio_typography:'{}'});
    if(styled.graphic.shadowRoot!.querySelectorAll('[data-studio-text-reveal]').length!==count)throw Error('Calques accumulés');
    records.push({id,variant,movement:'PASS',reset:'PASS'});
   }finally{await native.dispose();await styled.dispose();}
  }
  result.textContent='PASS · transitions calculées, déplacement et réinitialisation\n'+JSON.stringify(records,null,2);
 }catch(error){result.textContent='FAIL · '+String(error)+'\n'+JSON.stringify(records,null,2);}finally{controls.forEach(b=>b.disabled=false);}
};
