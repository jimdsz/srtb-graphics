import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {getTemplate,templateDefaults,validateProjectData} from '../src/studio/domain';
import type {ProjectData} from '../src/studio/domain';
import {engineData} from '../src/studio/presentation';
import {SocialRenderer,prepareSocialAssets} from '../src/studio/social-renderer';
import {portraitLayoutMode,PORTRAIT_LAYOUT} from '../src/studio/social-portrait-layout';
import {makeTimeline} from '../src/studio/video/timeline';
import {prepareGraphic} from '../src/studio/video/engine';
import type {LegacyGraphic} from '../src/studio/video/engine';
import {attachSocialPreview} from '../src/studio/social-preview';
import {installSocialScene} from '../src/studio/social-scene';
import {installTypography} from '../src/studio/typography-engine';
import {studioEngineModule} from '../src/studio/text-editing';
import {installBAMediaReadiness} from '../src/studio/media-readiness';
import {sampleProof} from '../src/studio/video/frame-proof';
import Preview from '../src/studio/Preview';
import Fields from '../src/studio/Fields';
import '../src/studio/studio.css';

const ensure=(value:unknown,message:string)=>{if(!value)throw Error(message);};
const sourceImage='/library/v1.7.0/BTV_Ce_Soir/lib/media/programme.jpg';
function fixture(id='BTV_BA_1P',patch:ProjectData={}):ProjectData{
  const t=getTemplate(id),d:ProjectData={...templateDefaults(t),_studio_format:'portrait',_out_mode:'manual',_out_duration_seconds:id==='BTV_BA_1P'?12:Number(t.fields._out_duration_seconds.default)};
  for(const key of Object.keys(d)){
    if(/_audio.*enabled$/.test(key)||/_(sponsor|mentions|credit|inedit).*visible$/.test(key))d[key]=false;
    if(/^_media_.+_sequence$/.test(key))d[key]='[]';
    if(/^_media_.+_url$/.test(key)&&d[key]){d[key]=sourceImage;for(const [suffix,value]of [['start_seconds',0],['end_seconds',30],['rate',1]] as const){const k=key.slice(0,-4)+'_'+suffix;if(k in d)d[k]=value;}}
  }
  for(const prefix of id==='BTV_BA_TDS_SUIVI_DE'?['_p1','_p2']:[''])Object.assign(d,{[`${prefix}_titre_ligne_1`]:'LE GRAND',[`${prefix}_titre_ligne_2`]:'ENTRETIEN',[`${prefix}_titre_ligne_3`]:'',[`${prefix}${id==='BTV_BA_1P'?'_thematique':'_theme'}`]:'MAGAZINE'});
  if(id==='BTV_BA_1P')Object.assign(d,{_studio_ba_mode:'simple',_jour_1:'Aujourd’hui',_heure_1:'20h30',_jour_2:'',_heure_2:'',_jour_3:'',_heure_3:'',_sous_titre_visible:true,_sous_titre_pack:'Au cœur du Bénin'});
  return validateProjectData(t,{...d,...patch});
}
const cases:{name:string;id:string;patch:ProjectData}[]=[
  {name:'BA · deux lignes / un rendez-vous',id:'BTV_BA_1P',patch:{}},
  {name:'BA · un titre court',id:'BTV_BA_1P',patch:{_titre_ligne_1:'DÉCOUVERTES',_titre_ligne_2:'',_sous_titre_visible:false}},
  {name:'BA · trois lignes / trois rendez-vous',id:'BTV_BA_1P',patch:{_titre_ligne_1:'LE GRAND MAGAZINE',_titre_ligne_2:'DES CULTURES VIVANTES',_titre_ligne_3:'ET DE NOS TRADITIONS',_studio_ba_mode:'multiple',_jour_2:'Demain',_heure_2:'20h30',_jour_3:'Dimanche',_heure_3:'20h30'}},
  {name:'BA · options denses',id:'BTV_BA_1P',patch:{_titre_ligne_3:'ET NOS TRADITIONS',_studio_ba_mode:'multiple',_jour_2:'Demain',_heure_2:'20h30',_jour_3:'Dimanche',_heure_3:'20h30',_credit_visible:true,_sponsor_visible:true,_sponsor_original:true,_sponsor_label_visible:true,_mentions_visible:true}},
  {name:'BA · rendez-vous masqué',id:'BTV_BA_1P',patch:{_studio_ba_appointment_display:'hidden'}},
  {name:'BA · remplacement par logo libre',id:'BTV_BA_1P',patch:{[PORTRAIT_LAYOUT]:'compact',_studio_ba_appointment_display:'logo',_studio_overlay_logo_enabled:true,_studio_overlay_logo_url:sourceImage,_studio_overlay_logo_anchor:'bottom-left',_studio_overlay_logo_x:9,_studio_overlay_logo_y:-3,_studio_overlay_logo_size:10}},
  {name:'BA · logo BTV en bas',id:'BTV_BA_1P',patch:{[PORTRAIT_LAYOUT]:'compact',_studio_logo_anchor:'bottom-right'}},
  {name:'BA · typographie personnalisée mesurée',id:'BTV_BA_1P',patch:{[PORTRAIT_LAYOUT]:'compact',_studio_typography:JSON.stringify({'portrait:_titre_ligne_1':{font:'suisse',size:150,lineHeight:1.6,align:'center',tracking:1.2},'portrait:_titre_ligne_2':{size:115,lineHeight:1.3}})}},
  {name:'BA · taille extrême / avertissement',id:'BTV_BA_1P',patch:{[PORTRAIT_LAYOUT]:'compact',_titre_ligne_1:'W'.repeat(18),_studio_typography:JSON.stringify({'portrait:_titre_ligne_1':{size:400}})}},
  {name:'TDS · panneau compact',id:'BTV_BA_TDS',patch:{}},
  {name:'TDS suivi · programme 1 puis 2',id:'BTV_BA_TDS_SUIVI_DE',patch:{_p2_titre_ligne_1:'REGARDS SUR',_p2_titre_ligne_2:'LE BÉNIN'}},
  {name:'Ancien placement · géométrie conservée',id:'BTV_BA_1P',patch:{_studio_block_scale:85,_studio_block_anchor:'center',_studio_typography:JSON.stringify({'portrait:_titre_ligne_1':{x:20,y:-5}})}},
  {name:'9:16 · témoin inchangé',id:'BTV_BA_1P',patch:{_studio_format:'vertical'}},
  {name:'4:5 · quatre lignes saisies',id:'BTV_BA_1P',patch:{_titre_ligne_1:'LE GRAND\nENTRETIEN\nAU CŒUR\nDU BÉNIN',_titre_ligne_2:''}},
  {name:'9:16 · quatre lignes saisies',id:'BTV_BA_1P',patch:{_studio_format:'vertical',_titre_ligne_1:'LE GRAND\nENTRETIEN\nAU CŒUR\nDU BÉNIN',_titre_ligne_2:''}},
  {name:'4:5 · mot long conservé',id:'BTV_BA_1P',patch:{_titre_ligne_1:'W'.repeat(160),_titre_ligne_2:''}},
  {name:'9:16 · mot long conservé',id:'BTV_BA_1P',patch:{_studio_format:'vertical',_titre_ligne_1:'W'.repeat(160),_titre_ligne_2:''}},
];
const status=document.querySelector('#status')!,result=document.querySelector('#result')!,gallery=document.querySelector('#gallery')!,run=document.querySelector<HTMLButtonElement>('#run')!,cancel=document.querySelector<HTMLButtonElement>('#cancel')!;
let controller:AbortController|undefined;
function alphaCount(canvas:HTMLCanvasElement){const rgba=canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data;let nonzero=0;for(let i=3;i<rgba.length;i+=4)if(rgba[i])nonzero++;return nonzero;}
function thumbnail(canvas:HTMLCanvasElement,label:string){const figure=document.createElement('figure'),caption=document.createElement('figcaption'),thumb=document.createElement('canvas');caption.textContent=label;thumb.width=270;thumb.height=Math.round(270*canvas.height/canvas.width);thumb.getContext('2d')!.drawImage(canvas,0,0,thumb.width,thumb.height);figure.append(thumb,caption);gallery.append(figure);}
async function parity(id:string,data:ProjectData,signal:AbortSignal){
  const template=getTemplate(id),mod=await import(/* @vite-ignore */studioEngineModule(template)),tag='portrait-check-'+id.toLowerCase().replaceAll('_','-');
  if(!customElements.get(tag))customElements.define(tag,class extends mod.default{});
  const host=document.createElement('div');host.style.cssText='position:fixed;left:-20000px;width:432px;height:540px';document.body.append(host);
  const graphic=document.createElement(tag) as LegacyGraphic;host.append(graphic);installSocialScene(graphic,template);installTypography(graphic,template,data);await installBAMediaReadiness(template);
  let prepared:Awaited<ReturnType<typeof prepareGraphic>>|undefined;
  try{
    const loaded=await graphic.load({renderType:'realtime',previewMuted:true,data:engineData(data,true)});ensure(!(loaded?.statusCode>=400),'Chargement aperçu refusé '+id);
    await attachSocialPreview(graphic,template,data,signal);prepared=await prepareGraphic(template,data,Number(data._out_duration_seconds),false,signal);
    const samples=[];
    for(const seconds of id==='BTV_BA_1P'?[8,17,19.96]:id==='BTV_BA_TDS_SUIVI_DE'?[8,17]:[8]){
      signal.throwIfAborted();await graphic.goToTime({seconds});graphic.__socialPreview?.refresh();
      const canvas=host.querySelector('canvas')!,index=Math.round(seconds*25),a=sampleProof(canvas,index),b=sampleProof(await prepared.frame(index,null),index);
      let rgb=0,alpha=0;for(let i=0;i<a.alpha.length;i++){alpha+=Math.abs(a.alpha[i]-b.alpha[i]);for(let j=0;j<3;j++)rgb+=Math.abs(a.rgb[i*4+j]-b.rgb[i*4+j]);}
      const diff={rgb:rgb/(a.alpha.length*3),alpha:alpha/a.alpha.length};ensure(diff.rgb<12&&diff.alpha<1,'Parité aperçu/export '+id+' '+JSON.stringify(diff));samples.push({seconds,...diff});
    }
    return {id,samples};
  }finally{await prepared?.dispose();await graphic.dispose();host.remove();}
}
run.onclick=async()=>{
  controller=new AbortController();run.disabled=true;cancel.disabled=false;gallery.replaceChildren();const records:unknown[]=[];
  try{
    const picture=new Image();picture.src=sourceImage;await picture.decode();
    for(const entry of cases){
      controller.signal.throwIfAborted();status.textContent=entry.name;const template=getTemplate(entry.id),data=fixture(entry.id,entry.patch),before=JSON.stringify(data),assets=await prepareSocialAssets(template,data,controller.signal),renderer=new SocialRenderer(template,data,assets),timeline=makeTimeline(template.id,data,{},Number(data._out_duration_seconds));
      try{
        const samples=[];
        for(const seconds of entry.id==='BTV_BA_TDS_SUIVI_DE'?[8,17]:[8]){
          const pictures={intro:picture,body:picture,pack:picture,background:picture,programme_1:picture,programme_2:picture},canvas=renderer.frame(seconds,timeline,pictures,null,true);
          const centerX=canvas.width/2,rgba=renderer.ctx.getImageData(centerX,0,1,canvas.height).data;let panelTop=canvas.height,panelBottom=0;
          for(let y=300;y<canvas.height;y++)if(rgba[y*4+3]===255){panelTop=Math.min(panelTop,y);panelBottom=y+1;}
          const compact=data._studio_format==='portrait'&&portraitLayoutMode(data)==='compact'&&!renderer.warnings.some(w=>w.includes('géométrie historique'));
          if(compact){ensure((canvas.height-panelTop)/canvas.height<=.58,'Panneau >58% '+entry.name);ensure(panelTop>500,'Vidéo moins visible que le panneau historique');}
          if(entry.name===cases[0].name)ensure((canvas.height-panelTop)/canvas.height<.4,'Panneau standard >40%');
          if(compact)for(const {box,text}of renderer.diagnostics){ensure(box.x>=0&&box.y>=0&&box.x+box.w<=canvas.width&&box.y+box.h<=canvas.height,'Texte hors cadre '+text);}
          if(['hidden','logo'].includes(String(data._studio_ba_appointment_display)))ensure(!renderer.textBoxes.some(box=>/^_(jour|heure)_/.test(box.field)),'Rendez-vous masqué encore présent');
          if(entry.name==='BA · logo BTV en bas')ensure(renderer.elementBoxes.some(box=>box.field==='_studio_logo_anchor'),'Logo BTV absent des éléments');
          if(/quatre lignes|mot long/.test(entry.name)){
            ensure(renderer.warnings.length>0,'Dépassement éditorial sans avertissement');
            const title=renderer.diagnostics.find(item=>item.text===String(data._titre_ligne_1));
            ensure(title,'Titre long absent du rendu');
            if(entry.name.includes('quatre lignes'))ensure(title?.lines===4,'Quatre lignes saisies non conservées');
            ensure(renderer.textBoxes.some(box=>box.field==='_titre_ligne_1'),'Titre long non sélectionnable');
          }
          const sample={seconds,panelTop,panelBottom,panelHeight:panelBottom-panelTop,diagnostics:structuredClone(renderer.diagnostics),textBoxes:structuredClone(renderer.textBoxes),warnings:[...renderer.warnings],nonzeroAlpha:alphaCount(canvas)};
          thumbnail(renderer.frame(seconds,timeline,pictures,null,false),entry.name+' · '+seconds+' s · panneau '+sample.panelHeight+' px');samples.push(sample);
        }
        ensure(alphaCount(renderer.frame(timeline.duration,timeline,{},null,true))===0,'Dernière image non transparente');ensure(JSON.stringify(data)===before,'Réglages source modifiés');
        if(entry.name.startsWith('Ancien')){const old=renderer.frame(8,timeline,{},null,true).getContext('2d')!.getImageData(0,0,1080,1350).data.slice();renderer.data={...data,[PORTRAIT_LAYOUT]:'legacy'};const explicit=renderer.frame(8,timeline,{},null,true).getContext('2d')!.getImageData(0,0,1080,1350).data;ensure(old.every((n,i)=>n===explicit[i]),'Ancien projet déplacé');}
        records.push({name:entry.name,mode:portraitLayoutMode(data),samples,result:'PASS'});
      }finally{renderer.dispose();}
    }
    const oversized=fixture('BTV_BA_1P',{[PORTRAIT_LAYOUT]:'compact',_titre_ligne_1:'W'.repeat(18),_studio_typography:JSON.stringify({'portrait:_titre_ligne_1':{size:400}})}),oversizedTemplate=getTemplate('BTV_BA_1P'),oversizedRenderer=new SocialRenderer(oversizedTemplate,oversized,await prepareSocialAssets(oversizedTemplate,oversized,controller.signal));
    try{const before=JSON.stringify(oversized),frame=oversizedRenderer.frame(8,makeTimeline(oversizedTemplate.id,oversized,{},12),{},null,true);ensure(alphaCount(frame)>0,'Typographie immense : écran vide');ensure(oversizedRenderer.warnings.some(w=>w.includes('géométrie historique')),'Typographie immense sans avertissement');ensure(JSON.stringify(oversized)===before,'Style forcé modifié');}finally{oversizedRenderer.dispose();}
    const parities=[];for(const id of ['BTV_BA_1P','BTV_BA_TDS','BTV_BA_TDS_SUIVI_DE']){status.textContent='Parité réelle · '+id;parities.push(await parity(id,fixture(id),controller.signal));}
    parities.push(await parity('BTV_BA_1P',fixture('BTV_BA_1P',cases.find(item=>item.name.includes('typographie personnalisée'))!.patch),controller.signal));
    for(const entry of cases.filter(item=>/quatre lignes|mot long/.test(item.name)))parities.push({name:entry.name,...await parity(entry.id,fixture(entry.id,entry.patch),controller.signal)});
    const report={scope:'Panneau 4:5 : rendu réel BTV, aperçu/export sans encodage, fixtures locales uniquement',status:'PASS',records,oversizedTypography:'visible historical fallback, warning, original settings retained',parities};result.textContent=JSON.stringify(report,null,2);status.textContent='PASS · '+records.length+' compositions · '+parities.length+' parités réelles';
    const a=document.createElement('a');a.textContent='Enregistrer le rapport JSON';a.href=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));a.download='social-portrait-qualification-'+Date.now()+'.json';result.before(a);
  }catch(error){status.textContent='ÉCHEC · '+String(error);result.textContent=JSON.stringify({completed:records,error:String(error)},null,2);}
  finally{controller=undefined;run.disabled=false;cancel.disabled=true;}
};cancel.onclick=()=>controller?.abort();
function Editor(){
  const [index,setIndex]=useState(0),[data,setData]=useState(()=>fixture()),[editor,setEditor]=useState(false),entry=cases[index],template=getTemplate(entry.id);
  const [selectedElement,setSelectedElement]=useState<{field:string;serial:number}>();
  return <><label>Composition de test<select value={index} onChange={e=>{const i=Number(e.target.value);setIndex(i);setSelectedElement(undefined);setData(fixture(cases[i].id,cases[i].patch));}}>{cases.map((item,i)=><option key={item.name} value={i}>{item.name}</option>)}</select></label><button onClick={()=>setEditor(!editor)}>{editor?'Fermer l’éditeur':'Ouvrir l’éditeur réel'}</button><button onClick={()=>setData(validateProjectData(template,JSON.parse(JSON.stringify(data))))}>Simuler sauvegarde et relecture</button><p>Choix enregistré : {String(data[PORTRAIT_LAYOUT]||'absent')} · rendu : {portraitLayoutMode(data)}</p>{editor?<div className="editor-grid"><Preview key={entry.name} template={template} data={data} onChange={setData} onSelectElement={field=>setSelectedElement(previous=>({field,serial:(previous?.serial||0)+1}))}/><Fields template={template} data={data} media={[]} onChange={setData} selectedElement={selectedElement}/></div>:null}</>;
}
createRoot(document.querySelector('#editor')!).render(<Editor/>);
