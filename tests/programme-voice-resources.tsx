// Local state-transition fixture. Decoder uses synthetic WAV; audition is mocked.
// No real voice, human listening, account, backend or production permission proof.
import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import PlannerVoiceDialog from '../src/studio/PlannerVoiceDialog';
import {api} from '../src/studio/api';
import {preparationProfiles} from '../src/studio/preparation-profile-api';
import type {Programme} from '../src/studio/channel-model';
import type {PreparationProfile} from '../src/studio/preparation-profile-model';
import type {PlannerVoice} from '../src/studio/planner-voice-model';
import '../src/studio/studio.css';
import '../src/studio/theme.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';
import '../src/studio/day-planner.css';

const id=(n:number)=>`22222222-2222-4222-8222-${String(n).padStart(12,'0')}`;
const source=(n:number,name:string)=>({url:`/api/graphics/media/${id(n)}/content`,name,mimeType:'audio/wav'});
const query=new URLSearchParams(location.search),scenario=query.get('case')||'valid',existing=query.has('existing');
const stamp='2026-09-29T12:00:00Z',email='voice-fixture@example.test';
const held=new Set((query.get('hold')||'').split(',').filter(Boolean)),waiting=new Map<string,Array<()=>void>>();
const evidence={programmeCalls:[] as string[],profileCalls:[] as string[],mediaCalls:0,playCalls:0,decodeCalls:0,changes:[] as unknown[],closes:0};
const fixture={evidence,ready:false,changeProgramme:(_number:number,_revision=4,_airDate='2026-09-29')=>{},release:(key:string)=>{held.delete(key);for(const resolve of waiting.get(key)||[])resolve();waiting.delete(key);},finishAudition:(end:number)=>{const audio=document.querySelector('audio');if(!audio)throw Error('Lecteur absent');Object.defineProperty(audio,'currentTime',{configurable:true,writable:true,value:end});audio.dispatchEvent(new Event('timeupdate',{bubbles:true}));}};
Object.assign(window,{programmeVoiceFixture:fixture});
async function hold(key:string){if(held.has(key))await new Promise<void>(resolve=>waiting.set(key,[...(waiting.get(key)||[]),resolve]));}
const programme=(n:number):Programme=>({id:id(n),channel_id:'benin-tv',name:`Fiche ${n===1?'A':'B'}`,revision:scenario==='revision-mismatch'&&n===1?5:4,archived:scenario==='archived'&&n===1?1:0,updated_at:stamp,data:{name:`Fiche ${n}`,aliases:[],category:'Magazine',replayUrl:'',recurring:false,recipe:[],notes:'',directoryIds:[],voiceProfileId:scenario==='no-voice'?null:id(10+n)}});
const profile=(n:number):PreparationProfile=>({id:id(10+n),kind:'voice',name:`Voix fiche ${n===1?'A':'B'}`,favorite:false,archived:scenario==='voice-archived',revision:2,template_id:null,template_version:null,library_version:null,created_by:email,updated_by:email,created_at:stamp,updated_at:stamp,validated_by:scenario==='unvalidated'?null:email,validated_at:stamp,data:{source:source(n===1?21:22,`Source fiche ${n===1?'A':'B'}.wav`),start:n===1?1.25:.5,end:n===1?2.75:1.25,label:'Signal synthétique, pas une voix réelle',cue:{kind:'announcement',value:scenario==='wrong-day'&&n===1?'Mercredi':'Mardi'},humanValidated:true}});
api.programme=async(programmeId,_signal)=>{evidence.programmeCalls.push(programmeId);const n=programmeId===id(1)?1:2,result=programme(n);await hold(`programme-${n}`);if(scenario==='unavailable')throw Error('Fiche indisponible en recette');return structuredClone(result);};
preparationProfiles.get=async(profileId,_signal)=>{evidence.profileCalls.push(profileId);const n=profileId===id(11)?1:2,result=profile(n);await hold(`profile-${n}`);return structuredClone(result);};
let mediaFailed=false;
api.media=async()=>{evidence.mediaCalls++;await hold('media');if(scenario==='media-error'&&!mediaFailed){mediaFailed=true;throw Error('Catalogue audio indisponible en recette');}return [21,22,23].filter(n=>scenario!=='missing-media'||n!==21).map(n=>({id:id(n),name:n===23?'Choix manuel conservé.wav':`Source fiche ${n===21?'A':'B'}.wav`,mime_type:'audio/wav',status:'ready' as const,bytes:288044,created_by:email,created_at:stamp}));};
const nativeDecode=AudioContext.prototype.decodeAudioData;
AudioContext.prototype.decodeAudioData=function(...args:Parameters<AudioContext['decodeAudioData']>){evidence.decodeCalls++;return nativeDecode.apply(this,args);};
// Deliberate event simulation: never claim an operator listened to this signal.
HTMLMediaElement.prototype.play=async function(){evidence.playCalls++;};
const value:PlannerVoice|undefined=existing?{source:source(23,'Choix manuel conservé.wav'),sourceDuration:3,start:.25,end:.75,cue:'Mardi',confirmed:true,placement:{mode:'ba-auto'}}:undefined;
function Fixture(){
  const [open,setOpen]=useState(false),[config,setConfig]=useState({number:1,revision:4,airDate:'2026-09-29'});
  useEffect(()=>{fixture.changeProgramme=(number,revision=4,airDate='2026-09-29')=>setConfig({number,revision,airDate});fixture.ready=true;return()=>{fixture.ready=false;};},[]);
  return <main style={{padding:24}}><h1>Recette voix de fiche</h1><p>Signal synthétique décodé, écoute simulée : aucune preuve de contenu vocal ou d’écoute humaine.</p><button onClick={()=>setOpen(true)}>Ouvrir la voix de recette</button>{open?<PlannerVoiceDialog kind="ba" title="Magazine de recette" airDate={config.airDate} programmeId={id(config.number)} programmeRevision={config.revision} value={value} onChange={voice=>evidence.changes.push(voice?structuredClone(voice):null)} onClose={()=>{evidence.closes++;setOpen(false);}}/>:null}</main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
