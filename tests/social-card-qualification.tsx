import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {broadcastTemplates,getTemplate,templateDefaults,validateProjectData} from '../src/studio/domain';
import type {ProjectData} from '../src/studio/domain';
import {engineData} from '../src/studio/presentation';
import {socialCardKey} from '../src/studio/social-card-settings';
import {SocialRenderer,prepareSocialAssets} from '../src/studio/social-renderer';
import {makeTimeline} from '../src/studio/video/timeline';
import {prepareGraphic} from '../src/studio/video/engine';
import type {LegacyGraphic} from '../src/studio/video/engine';
import {attachSocialPreview} from '../src/studio/social-preview';
import {installSocialScene} from '../src/studio/social-scene';
import {installTypography} from '../src/studio/typography-engine';
import {studioEngineModule} from '../src/studio/text-editing';
import {installBAMediaReadiness} from '../src/studio/media-readiness';
import {sampleProof} from '../src/studio/video/frame-proof';
import {stripSupplementalVoice} from '../src/studio/supplemental-voice';
import Preview from '../src/studio/Preview';
import Fields from '../src/studio/Fields';
import PlacementSettings from '../src/studio/PlacementSettings';
import '../src/studio/studio.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';

const ids=['BTV_BA_1P','BTV_BA_TDS','BTV_BA_TDS_SUIVI_DE','BTV_PopUp','BTV_Ce_Soir','BTV_Relais_Antenne','BTV_Passerelle_Replay','BTV_Renvoi','BTV_Evenement','BTV_Semainier'];
const image='/library/v1.7.0/BTV_Ce_Soir/lib/media/programme.jpg';
function fixture(id:string,format='vertical',size=100){
  const t=getTemplate(id),d:ProjectData={...templateDefaults(t),_studio_format:format,_out_mode:'manual',[socialCardKey(format as 'vertical'|'portrait','scale')]:size};
  for(const key of Object.keys(d)){
    if(/_audio.*enabled$/.test(key)||/_(sponsor|mentions|credit|inedit).*visible$/.test(key))d[key]=false;
    if(/^_media_.+_sequence$/.test(key))d[key]='[]';
    if(/^_media_.+_url$/.test(key)){d[key]=image;for(const [suffix,value]of [['start_seconds',0],['end_seconds',30],['rate',1]] as const){const k=key.slice(0,-4)+'_'+suffix;if(k in d)d[k]=value;}}
  }
  if(id==='BTV_BA_1P')Object.assign(d,{_out_duration_seconds:12,_studio_ba_mode:'simple',_jour_1:'Ce soir',_heure_1:'20h30',_jour_2:'',_heure_2:'',_jour_3:'',_heure_3:''});
  if(id==='BTV_Passerelle_Replay')d._replay_url='https://example.test/recette';
  return validateProjectData(t,d);
}
const ensure=(value:unknown,message:string)=>{if(!value)throw Error(message);};
async function parity(id:string,data:ProjectData){
  const signal=new AbortController().signal,t=getTemplate(id),mod=await import(/* @vite-ignore */studioEngineModule(t)),tag='card-check-'+id.toLowerCase().replaceAll('_','-');
  if(!customElements.get(tag))customElements.define(tag,class extends mod.default{});
  const host=document.createElement('div');host.style.cssText='position:fixed;left:-20000px;width:432px;height:768px';document.body.append(host);
  const g=document.createElement(tag) as LegacyGraphic;host.append(g);installSocialScene(g,t);installTypography(g,t,data);await installBAMediaReadiness(t);
  let prepared:Awaited<ReturnType<typeof prepareGraphic>>|undefined;
  try{
    const loaded=await g.load({renderType:'realtime',previewMuted:true,data:stripSupplementalVoice(t,engineData(data,true))});ensure(!(loaded?.statusCode>=400),'Load '+id);
    await attachSocialPreview(g,t,data,signal);prepared=await prepareGraphic(t,data,Number(data._out_duration_seconds),false,signal);
    const samples=[];
    for(const seconds of id==='BTV_BA_1P'?[8,17]:id==='BTV_Semainier'?[1.8,8,21]:[8]){
      await g.goToTime({seconds});g.__socialPreview?.refresh();const a=sampleProof(host.querySelector('canvas')!,Math.round(seconds*25)),b=sampleProof(await prepared.frame(Math.round(seconds*25),null),Math.round(seconds*25));
      let rgb=0,alpha=0;for(let i=0;i<a.alpha.length;i++){alpha+=Math.abs(a.alpha[i]-b.alpha[i]);for(let j=0;j<3;j++)rgb+=Math.abs(a.rgb[i*4+j]-b.rgb[i*4+j]);}
      const diff={seconds,rgb:rgb/(a.alpha.length*3),alpha:alpha/a.alpha.length};ensure(diff.rgb<12&&diff.alpha<1,`${id} parity ${JSON.stringify(diff)}`);samples.push(diff);
    }
    return {id,format:data._studio_format,scale:80,samples};
  }finally{await prepared?.dispose();await g.dispose();host.remove();}
}
function App(){
  const [id,setId]=useState('BTV_Evenement'),[data,setData]=useState(()=>fixture('BTV_Evenement')),[report,setReport]=useState(''),[busy,setBusy]=useState(false),[showEditor,setShowEditor]=useState(true);
  const template=getTemplate(id);
  async function run(){
    setBusy(true);setShowEditor(false);const records:any[]=[];const gallery=document.getElementById('gallery')!;gallery.replaceChildren();
    try{
      const picture=new Image();picture.src=image;await picture.decode();
      for(const model of ids)for(const format of ['portrait','vertical'] as const){
        setReport(`${model} · ${format}`);
        const t=getTemplate(model),d=fixture(model,format,80),renderer=new SocialRenderer(t,d,await prepareSocialAssets(t,d,new AbortController().signal)),timeline=makeTimeline(model,d,{},Number(d._out_duration_seconds));
        try{
          const pics=Object.fromEntries(['intro','body','pack','background','renvoi','event','event_logo','final','popup','1','2','3',...Array.from({length:7},(_,i)=>'programme_'+(i+1))].map(key=>[key,picture]));
          const canvas=renderer.frame(8,timeline,pics,null),figure=document.createElement('figure'),thumb=document.createElement('canvas'),caption=document.createElement('figcaption');thumb.width=216;thumb.height=format==='portrait'?270:384;thumb.getContext('2d')!.drawImage(canvas,0,0,thumb.width,thumb.height);caption.textContent=`${model} ${format} 80 %`;figure.append(thumb,caption);gallery.append(figure);
          ensure(renderer.textBoxes.length>0,model+' empty');ensure(renderer.warnings.length===0,model+' '+renderer.warnings.join(';'));
          records.push(await parity(model,d));setReport(JSON.stringify({completed:records.length,records},null,2));
        }finally{renderer.dispose();}
      }
      setReport(JSON.stringify({status:'PASS',compositions:records.length,records},null,2));
    }catch(e){setReport(JSON.stringify({status:'FAIL',error:String(e),records},null,2));}finally{setBusy(false);setShowEditor(true);}
  }
  if(new URLSearchParams(location.search).has('controls'))return <div className="fields-panel"><PlacementSettings template={template} data={data} onChange={patch=>setData(previous=>({...previous,...patch}))} disabled={false}/></div>;
  return <><h1>Cartons sociaux — recette locale</h1><p>Aucun projet ni média envoyé. Éditeur réel, ressources locales de démonstration.</p><div className="card-check-tools"><label>Modèle<select value={id} disabled={busy} onChange={e=>{setId(e.target.value);setData(fixture(e.target.value));}}>{broadcastTemplates.filter(t=>ids.includes(t.id)).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><button disabled={busy} onClick={run}>Contrôler les 20 compositions</button><button disabled={busy} onClick={()=>setData(validateProjectData(template,JSON.parse(JSON.stringify(data))))}>Simuler sauvegarde et relecture</button></div><pre id="report" role="status">{report}</pre>{showEditor?<div className="card-check-editor"><Preview key={id} template={template} data={data} onChange={setData}/><aside><Fields template={template} data={data} media={[]} onChange={setData}/></aside></div>:null}<output id="saved-parameters">{JSON.stringify(Object.fromEntries(Object.entries(data).filter(([key])=>key.includes('_card_')||key==='_studio_format')))}</output><div id="gallery"/></>;
}
const root=createRoot(document.getElementById('root')!);root.render(<App/>);if(import.meta.hot)import.meta.hot.dispose(()=>root.unmount());
