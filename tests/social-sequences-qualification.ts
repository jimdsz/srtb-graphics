import {getTemplate,templateDefaults} from '../src/studio/domain';
import type {ProjectData} from '../src/studio/domain';
import {SocialRenderer,prepareSocialAssets} from '../src/studio/social-renderer';
import {makeTimeline,TIMINGS} from '../src/studio/video/timeline';
import {socialSignature} from '../src/studio/social-motion';
import {BRAND_POSITION} from '../src/studio/element-selection';
const ids=['BTV_BA_1P','BTV_BA_TDS','BTV_BA_TDS_SUIVI_DE','BTV_Ce_Soir','BTV_Renvoi','BTV_Evenement','BTV_Semainier','BTV_PopUp','BTV_Relais_Antenne','BTV_Passerelle_Replay'];
const entries:Record<string,number>={BTV_BA_1P:4.36,BTV_BA_TDS:4.36,BTV_BA_TDS_SUIVI_DE:4.36,BTV_Ce_Soir:1.6,BTV_Renvoi:2.8,BTV_Evenement:4.08,BTV_Semainier:2.96};
const photoURL='/library/v1.7.0/BTV_Ce_Soir/lib/media/programme.jpg';
const results:any[]=[],earlyOut:any[]=[],variants:any[]=[];
async function run(){
 const photo=new Image();photo.src=photoURL;await photo.decode();
 const pictures=Object.fromEntries(['intro','body','pack','background','programme_1','programme_2','renvoi','event','final','1','2','3','popup',...Array.from({length:7},(_,n)=>'programme_'+(n+1))].map(key=>[key,photo]));
 for(const format of ['portrait','vertical']){
  const section=document.createElement('section');section.id='sheet-'+format;const heading=document.createElement('h2');heading.textContent=format==='portrait'?'4:5':'9:16';section.append(heading);document.querySelector('#gallery')!.append(section);
  for(const id of ids){
   const template=getTemplate(id),data:ProjectData={...templateDefaults(template),_studio_format:format,_studio_logo_anchor:'top-right',_out_mode:'manual'};
   if(id==='BTV_BA_1P')Object.assign(data,{_studio_ba_mode:'simple',_titre_ligne_1:'LE GRAND',_titre_ligne_2:'ENTRETIEN',_titre_ligne_3:'',_thematique:'MAGAZINE',_jour_1:'CE SOIR',_heure_1:'20H30'});
   const timeline=makeTimeline(id,data,{},id==='BTV_BA_1P'?12:TIMINGS[id].stop),assets=await prepareSocialAssets(template,data,new AbortController().signal),renderer=new SocialRenderer(template,data,assets);
   const title=document.createElement('h3');title.textContent=template.name;section.append(title);const row=document.createElement('div');row.className='frames';section.append(row);
   const entry=entries[id]??.6,samples=[0,.12,.48,entry-.04,entry,Math.min(8,timeline.outAt-.04),timeline.outAt,timeline.outAt+Math.min(.52,timeline.timing.out/2),timeline.duration-.04];
   if(id==='BTV_BA_TDS_SUIVI_DE')samples.splice(5,1,13.8,14.2,16.6);
   for(const seconds of samples){
    renderer.frame(seconds,timeline,pictures,null);
    const figure=document.createElement('figure'),copy=document.createElement('canvas'),caption=document.createElement('figcaption');copy.width=240;copy.height=Math.round(240*renderer.canvas.height/renderer.canvas.width);copy.getContext('2d')!.drawImage(renderer.canvas,0,0,copy.width,copy.height);caption.textContent=seconds.toFixed(2)+' s';figure.append(copy,caption);row.append(figure);
    const rgba=copy.getContext('2d')!.getImageData(0,0,copy.width,copy.height).data;let opaque=0;for(let pixel=3;pixel<rgba.length;pixel+=4)if(rgba[pixel]>250)opaque++;
    results.push({id,format,seconds,outAt:timeline.outAt,duration:timeline.duration,phase:socialSignature(id,seconds,timeline)?.phase??'content',texts:renderer.textBoxes.map(b=>b.field),brand:renderer.elementBoxes.find(b=>b.field===BRAND_POSITION),opaque:opaque/(rgba.length/4),warnings:[...renderer.warnings]});
   }
   for(const at of [.12,entry-.24,id==='BTV_BA_TDS_SUIVI_DE'?13.76:id==='BTV_Semainier'?7.76:8]){
    renderer.frame(at,{...timeline,outAt:Infinity,duration:Infinity},pictures,null);const before=structuredClone(renderer.textBoxes),brand=structuredClone(renderer.elementBoxes.find(b=>b.field===BRAND_POSITION));
    const early={...timeline,outAt:at,duration:at+timeline.timing.out};renderer.frame(at,early,pictures,null);const after=structuredClone(renderer.textBoxes);
    earlyOut.push({id,format,at,sameFields:JSON.stringify(before.map(b=>b.field))===JSON.stringify(after.map(b=>b.field)),maxShift:Math.max(0,...before.flatMap((box,i)=>after[i]?['x','y','width','height'].map(key=>Math.abs((box as any)[key]-(after[i] as any)[key])):[1])),sameBrand:JSON.stringify(brand)===JSON.stringify(renderer.elementBoxes.find(b=>b.field===BRAND_POSITION))});
   }
   const titleField=id==='BTV_BA_TDS_SUIVI_DE'?'_p1_titre_ligne_1':id==='BTV_BA_1P'||id==='BTV_BA_TDS'?'_titre_ligne_1':id==='BTV_Ce_Soir'?'_title_1':id==='BTV_Renvoi'?'title':id==='BTV_Evenement'?'title_1':id==='BTV_Semainier'?'intro_top':id==='BTV_Relais_Antenne'?'_current_title':'_title';
   for(const text of ['', 'UNE LIGNE','DEUX\nLIGNES','TROIS\nLIGNES\nVISIBLES','W'.repeat(100)]){
    renderer.data={...data,[titleField]:text};renderer.frame(0,timeline,pictures,null);
    variants.push({id,format,text,hasField:renderer.textBoxes.some(box=>box.field===titleField),boxes:renderer.textBoxes.filter(box=>box.field===titleField),warnings:[...renderer.warnings]});
   }
   renderer.dispose();
  }
 }
 document.querySelector('#result')!.textContent=JSON.stringify({status:'PASS',records:results,earlyOut,variants});document.querySelector('#status')!.textContent='PASS';
}
run().catch(error=>{document.querySelector('#result')!.textContent=JSON.stringify({status:'FAIL',error:String(error),records:results});document.querySelector('#status')!.textContent='FAIL';});
