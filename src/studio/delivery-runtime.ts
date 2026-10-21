import type { DeliveryPlan } from './delivery-plan';
import type { BroadcastTemplate } from './domain';
import {engineData} from './presentation';
import baEditor from './ba-editor.generated.json';
import {baTextDefaults} from './text-editing';
import typography from './typography-runtime.generated.json';
import supplementalVoice from './supplemental-voice-runtime.generated.json';
import {hasSupplementalVoice} from './voice-fields';
import {overlayLogoDefaults} from './logo-model';
import {ceilFrameSeconds} from './frame-time';
import aeOutRuntime from './ae-out-runtime.generated.json';
import {CE_SOIR_BACKGROUND} from './ce-soir-background';

const json=(value:unknown)=>JSON.stringify(value,null,2).replaceAll('<','\\u003c').replaceAll('\u2028','\\u2028').replaceAll('\u2029','\\u2029');
// Separate entry point: the immutable original engine and integration files are never changed.
export function packageDocuments(plan:DeliveryPlan,template:BroadcastTemplate,fonts:Record<string,string>={}):Record<string,string> {
  const native=engineData(plan.data);
  const definition={description:`${template.name} · révision ${plan.project.revision}`,playserver:'OVERLAY',playchannel:'1',playlayer:'20',webplayout:'20',out:'manual',uicolor:'4',DataFields:Object.entries(template.fields).filter(([key])=>!key.startsWith('_studio_')&&!(plan.data._studio_ba_mode==='simple'&&/^_(jour|heure)_[23]$/.test(key))).map(([key,field])=>({field:key,ftype:'textfield',title:field.title||key,value:typeof native[key]==='object'?JSON.stringify(native[key]):String(native[key]),help:field.description||''}))};
  if(plan.snapshot)definition.description=`${template.name} · export de travail ${plan.snapshot.id.slice(0,8)}`;
  const editedBA=template.id==='BTV_BA_1P'&&template.version==='1.0.3'&&template.libraryVersion==='1.7.0';
  const completeAE=template.libraryVersion==='1.7.0'&&template.version==='1.0.0'&&['BTV_Evenement','BTV_Semainier'].includes(template.id);
  const extraVoice=hasSupplementalVoice(template);
  const voiceRuntime=extraVoice||template.libraryVersion==='1.7.0'&&['BTV_BA_1P','BTV_BA_TDS'].includes(template.id);
  const documents:Record<string,string>={
    'studio-typography.mjs':typography.code,
    'studio-fonts.json':json(fonts),
    ...(voiceRuntime?{'studio-supplemental-voice-v1.mjs':supplementalVoice.code}:{}),
    ...(editedBA?{'studio-graphic.mjs':baEditor.graphic,'studio-config.mjs':baEditor.config,'studio-audio.mjs':baEditor.audio,'studio-voice-layout.mjs':baEditor.voiceLayout,'studio-audio-clock.mjs':baEditor.audioClock,'studio-text-layout.mjs':baEditor.layout}:{}),
    ...(completeAE?{'studio-ae-out.mjs':aeOutRuntime.code,'studio-ae-engine.mjs':aeOutRuntime.engine,'studio-graphic.mjs':`import lottie from './lib/lottie-web.esm.mjs';
import {createAETemplate} from './studio-ae-engine.mjs';
import {CONFIG,DEFAULTS,VERSION} from './config.mjs';
import {completeAEOutConfig} from './studio-ae-out.mjs';
const adapted=completeAEOutConfig(CONFIG,${json(template.id)});export {DEFAULTS,VERSION};export const TIMING=adapted.timing;
export default createAETemplate(lottie,adapted,new URL('./graphic.mjs',import.meta.url).href);
`}:{}),
    ...(plan.snapshot?{'EXPORT.txt':`SRTB GRAPHICS — EXPORT DE TRAVAIL\n\n${plan.project.title}\nExport ${plan.snapshot.id} du ${plan.snapshot.createdAt}.\nBasé sur la révision ${plan.project.revision}, avec les réglages présents à l’écran au lancement.\nCet export ne modifie pas le projet partagé et ne constitue pas une validation pour l’antenne.\n`} : {}),
    'PROJET.json':json({format:plan.format,version:plan.version,project:plan.project,snapshot:plan.snapshot,data:plan.data,qualification:plan.snapshot?'Export des réglages au lancement, sans validation de diffusion. Aucun ordre n’a été envoyé à l’antenne.':'Recette poste requise. Aucun ordre n’a été envoyé à l’antenne.'}),
    'SRTB-PROJET.html':`<!doctype html><html lang="fr"><meta charset="utf-8"><title>Habillage SRTB</title><style>html,body,#output{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}#output>*{display:block;width:100%;height:100%}</style><script>window.SPXGCTemplateDefinition=${json(definition)};window.__srtbReady=import('./srtb-project.mjs');let updates=window.__srtbReady;window.update=input=>{updates=updates.catch(()=>window.__srtbReady).then(m=>m.update(input));return updates;};window.play=()=>updates.then(m=>m.play());window.stop=()=>window.__srtbReady.then(m=>m.stop());window.remove=()=>window.__srtbReady.then(m=>m.clear());window.next=window.play;window.runAnimationIN=window.play;window.runAnimationOUT=window.stop;window.getStatus=()=>window.__srtbReady.then(m=>m.status());</script><div id="output"></div></html>`,
    'srtb-project.mjs':`import Graphic from './${editedBA||completeAE?'studio-graphic':'graphic'}.mjs';
import {installTypography,installPortableFonts} from './studio-typography.mjs';
${voiceRuntime?"import {installSupplementalVoice,installNativeVoiceFit,installPortableTransport,installAEMediaTrim} from './studio-supplemental-voice-v1.mjs';":''}
const project=await fetch(new URL('PROJET.json',import.meta.url)).then(r=>{if(!r.ok)throw Error('Paramètres introuvables');return r.json();});
await installPortableFonts(await fetch(new URL('studio-fonts.json',import.meta.url)).then(r=>r.json()));
customElements.define('srtb-project-output',Graphic);
const graphic=new Graphic();document.getElementById('output').append(graphic);
${voiceRuntime?`installAEMediaTrim(graphic,${json(template)});`:''}
graphic.addEventListener('broadcast-audio-warning',event=>{console.warn(event.detail.message);window.dispatchEvent(new CustomEvent('srtb-audio-warning',{detail:event.detail}));});
${extraVoice?`installSupplementalVoice(graphic,${json(template)},{baseURL:import.meta.url});`:''}
${voiceRuntime?`installNativeVoiceFit(graphic,${json(template)});`:''}
installTypography(graphic,{...${json(template)},module:new URL('./graphic.mjs',import.meta.url).href},{...project.data,_studio_format:'tv'});
function check(result){if(result?.statusCode>=400)throw Error(result.statusMessage||'Action refusée');return result;}
const ceilFrameSeconds=${ceilFrameSeconds.toString()};
const tvData=data=>{const textKeys=${JSON.stringify([CE_SOIR_BACKGROUND,'_studio_typography','_studio_default_text_case','_studio_image_sizes',...Object.keys(overlayLogoDefaults),...(editedBA?[...Object.keys(baTextDefaults),'_studio_ba_voice_fit']:[])])};const result=Object.fromEntries(Object.entries(data).filter(([key])=>!key.startsWith('_studio_')||textKeys.includes(key)));const value=result._out_duration_seconds,duration=typeof value==='number'?value:typeof value==='string'&&value.trim()?Number(value):NaN;if(Number.isFinite(duration)&&duration>=0)result._out_duration_seconds=ceilFrameSeconds(duration);if(project.data._studio_ba_mode==='simple')for(const n of [2,3]){result['_jour_'+n]='';result['_heure_'+n]='';}return result;};
await graphic.load({renderType:'realtime',previewMuted:false,data:tvData(project.data)}).then(check);
${extraVoice?`let currentData={...project.data,_studio_format:'tv'};const transport=installPortableTransport(graphic,${json(template)},()=>currentData,error=>{console.error(error);graphic.dispatchEvent(new CustomEvent('broadcast-error',{detail:{message:error.message}}));});`:''}
function parse(input){if(input==null||input==='')return {};if(typeof input==='object')return input.data&&typeof input.data==='object'?input.data:input;if(typeof input!=='string')throw Error('JSON ou XML attendu');if(input.trim().startsWith('<')){const xml=new DOMParser().parseFromString(input,'text/xml');if(xml.querySelector('parsererror'))throw Error('XML invalide');const data={};for(const node of xml.querySelectorAll('componentData')){const key=node.getAttribute('id'),value=node.querySelector('data')?.getAttribute('value');if(!key||value==null||Object.hasOwn(data,key))throw Error('Champ XML invalide');Object.defineProperty(data,key,{value,enumerable:true});}return data;}return parse(JSON.parse(input));}
export async function update(input){const next=parse(input);${extraVoice?'await transport.clear();':''}await graphic.updateAction(tvData(next)).then(check);${extraVoice?'currentData={...currentData,...next};':''}return await import(import.meta.url);}
export const play=()=>${extraVoice?'transport.start()':'graphic.playAction().then(check)'},stop=()=>${extraVoice?'transport.out()':'graphic.stopAction().then(check)'},clear=()=>${extraVoice?'transport.clear()':'graphic.stopAction({skipAnimation:true}).then(check)'},status=()=>graphic.getStatus();
${extraVoice?"export const pause=()=>transport.pause(),resume=()=>transport.resume(),seek=seconds=>transport.seek(seconds);Object.assign(window,{pause,resume,seek});":''}
window.addEventListener('pagehide',()=>{${extraVoice?'transport.dispose();':''}void graphic.dispose();});
`,
    'LIRE-AVANT-DIFFUSION.txt':`SRTB GRAPHICS — PAQUET DE RECETTE\n\nProjet ${plan.project.id}, révision ${plan.project.revision}.\nModèle ${template.id} v${template.version}.\n\n1. Décompresser tout le dossier, pas uniquement le HTML.\n2. Conserver moteurs, polices et médias ensemble. Les données ne dépendent plus de la session Graphics.\n3. Charger SRTB-PROJET.html depuis le serveur HTML de la régie (pas en double-cliquant en file://).\n4. Vérifier en prévisualisation SPX/CasparCG, hors antenne : images, sons, IN, OUT, durées et éventuel QR. Aucun raccordement réseau ni prise d’antenne n’est effectué par ce paquet.\n5. Les fonctions play/update/stop et runAnimationIN/runAnimationOUT sont exposées. Adapter canal/couche dans SPX, selon la conduite validée.\n6. Le manifeste INVENTAIRE.json permet de contrôler chaque fichier par SHA-256.\n\nCe ZIP contient des médias privés. Remettez-le uniquement aux postes et personnes autorisés SRTB.\nCe paquet n’est pas un export vidéo MP4 ou alpha. Sa création ne remplace pas la recette de diffusion sur la cible.\nLes anciennes entrées du template restent présentes pour référence ; elles contiennent leurs réglages par défaut. Utiliser SRTB-PROJET.html pour cette révision.\n`,
  };
  if(plan.snapshot)documents['LIRE-AVANT-DIFFUSION.txt']=`EXPORT DE TRAVAIL — NON VALIDÉ POUR DIFFUSION\nLes réglages exportés peuvent différer de la révision enregistrée. Voir EXPORT.txt et PROJET.json.\n\n${documents['LIRE-AVANT-DIFFUSION.txt']}`;
  return documents;
}
