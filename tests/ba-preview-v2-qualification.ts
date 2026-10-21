import {getTemplate,templateDefaults} from '../src/studio/domain';
import type {ProjectData} from '../src/studio/domain';
import type {LegacyGraphic} from '../src/studio/video/engine';
import {studioEngineModule} from '../src/studio/text-editing';
import {installBALoader,previewSources} from '../src/studio/preview-resources';
import {installGraphicCompatibility} from '../src/studio/graphic-compatibility';
import {installBAMediaReadiness} from '../src/studio/media-readiness';
import {installTypography} from '../src/studio/typography-engine';
import {engineData} from '../src/studio/presentation';
import {previewData} from '../src/studio/preview-data';
import '../src/studio/studio.css';
import '../src/studio/workbench.css';

const run=document.querySelector<HTMLButtonElement>('#run')!,cancel=document.querySelector<HTMLButtonElement>('#cancel')!;
const status=document.querySelector('#status')!,result=document.querySelector('#result')!,host=document.querySelector<HTMLDivElement>('#host')!;
let active:AbortController|undefined,graphic:LegacyGraphic|undefined;
const check=(value:unknown,message:string)=>{if(!value)throw Error(message);};
const tick=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
const mediaNodes=(g:LegacyGraphic)=>['intro','body','pack'].map(kind=>g.media.tracks[kind].clips[0].node);
const frameText=(g:LegacyGraphic)=>g.shadowRoot?.querySelector('[data-studio-intro-days]')?.textContent;
cancel.addEventListener('click',()=>{active?.abort();void graphic?.dispose();});
run.addEventListener('click',async()=>{
  if(active)return;active=new AbortController();run.disabled=true;cancel.disabled=false;result.textContent='';
  const signal=active.signal,records:unknown[]=[],template=getTemplate('BTV_BA_1P');
  let g:LegacyGraphic|undefined;
  const fixture:ProjectData={...templateDefaults(template),_studio_format:'tv',_studio_ba_mode:'multiple',_jour_1:'Lundi',_heure_1:'20h30',_jour_2:'Mardi',_heure_2:'09h00',_jour_3:'Jeudi',_heure_3:'14h30',_titre_ligne_1:'LE GRAND',_titre_ligne_2:'ENTRETIEN',_titre_ligne_3:'',_out_mode:'manual',_out_duration_seconds:12};
  try{
    await graphic?.dispose();graphic=undefined;host.replaceChildren();
    const modulePath=studioEngineModule(template);check(modulePath==='/studio-engines/ba-text-v2/graphic.mjs','La recette doit utiliser ba-text-v2.');
    const module=await import(/* @vite-ignore */modulePath),tag='qa-ba-preview-v2';
    if(!customElements.get(tag))customElements.define(tag,class extends module.default{});
    g=document.createElement(tag) as LegacyGraphic;graphic=g;g.style.cssText='display:block;width:100%;height:100%;position:relative';host.append(g);
    const data=previewSources(template,fixture),started=performance.now();
    installBALoader(g,template,message=>{status.textContent=message;});
    installGraphicCompatibility(g,{...template,module:new URL(template.module,location.href).href});
    installTypography(g,template,data);await installBAMediaReadiness(template);
    const loaded=await g.load({renderType:'realtime',previewMuted:true,data:previewData(engineData(data,true),true,true)});
    check(!loaded?.statusCode||loaded.statusCode<400,loaded?.statusMessage||'Chargement refusé.');signal.throwIfAborted();
    const sourceNodes=mediaNodes(g),intro=g.state.renderedTemplate.layers.find((layer:any)=>layer.nm==='JOUR'&&layer.ind===33);
    check(intro.t.d.k[0].s.t==='LUNDI - MARDI - JEUDI','Les trois jours natifs ne sont pas présents.');
    records.push({case:'native-three-dates',module:modulePath,loadMs:Math.round(performance.now()-started),intro:intro.t.d.k[0].s.t,videoNodes:sourceNodes.length,result:'PASS'});
    const cases=[
      {label:'first-day-style',patch:{_studio_typography:'{"tv:_jour_1":{"size":90}}'},expected:'LUNDI - MARDI - JEUDI'},
      {label:'second-day-style-only',patch:{_studio_typography:'{"tv:_jour_2":{"size":90}}'},expected:'LUNDI - MARDI - JEUDI'},
      {label:'first-day-colour-and-second-hour',patch:{_studio_typography:'{"tv:_jour_1":{"colour":"#f0b900"},"tv:_heure_2":{"colour":"#007300"}}'},expected:'LUNDI - MARDI - JEUDI'},
      {label:'changed-days-same-instance',patch:{_jour_1:'Vendredi',_jour_2:'Samedi',_jour_3:'Dimanche'},expected:'VENDREDI - SAMEDI - DIMANCHE'},
      {label:'simple-immediate-no-hour',patch:{_studio_ba_mode:'simple',_jour_1:'Tout de suite',_heure_1:'',_studio_typography:'{"tv:_jour_1":{"size":90}}'},expected:'TOUT DE SUITE'},
      {label:'multiple-after-simple',patch:{_studio_ba_mode:'multiple',_jour_1:'Lundi',_heure_1:'20h30',_jour_2:'Mardi',_jour_3:'Jeudi'},expected:'LUNDI - MARDI - JEUDI'},
    ];
    let current=data;
    for(const item of cases){
      signal.throwIfAborted();status.textContent=item.label;current={...current,...item.patch};
      const updated=await g.updateAction(previewData(engineData(current,true),true,true));check(!updated?.statusCode||updated.statusCode<400,updated?.statusMessage||'Mise à jour refusée.');
      await g.goToTime({seconds:2.8});await tick();signal.throwIfAborted();
      const actual=frameText(g);check(actual===item.expected,`${item.label} : ${actual} au lieu de ${item.expected}`);
      check(mediaNodes(g).every((node,index)=>node===sourceNodes[index]),'Une édition de texte a remplacé un décodeur média.');
      const group=g.shadowRoot?.querySelector<SVGGElement>('[data-studio-intro-days]');
      check(group&&Number(group.getAttribute('opacity'))>0,'Le texte contrôlé doit être visible dans l’image.');
      records.push({case:item.label,intro:actual,sameMediaNodes:true,result:'PASS'});result.textContent=JSON.stringify(records,null,2);
    }
    status.textContent=`PASS · ${records.length} contrôles sur ba-text-v2 TV · trois médias conservés. Dernière image conservée pour inspection.`;
  }catch(error){status.textContent=`ÉCHEC · ${error instanceof Error?error.message:String(error)}`;result.textContent=JSON.stringify({records,error:String(error)},null,2);await g?.dispose();}
  finally{active=undefined;run.disabled=false;cancel.disabled=true;}
});
