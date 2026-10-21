// Browser-only resource fixtures: API doubles, no real account or remote media.
import {createRoot} from 'react-dom/client';
import Studio from '../src/studio/Studio';
import {api} from '../src/studio/api';
import {plannerAPI} from '../src/studio/day-planner-api';
import {preparationProfiles} from '../src/studio/preparation-profile-api';
import type {PreparationProfileSummary} from '../src/studio/preparation-profile-model';
import type {Channel,Programme,ProgrammeData} from '../src/studio/channel-model';
import type {Member,MediaAsset} from '../src/studio/domain';
import type {PlannerSummary} from '../src/studio/day-planner-model';
import '../src/studio/studio.css';
import '../src/studio/theme.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';

const id=(value:number)=>`11111111-1111-4111-8111-${String(value).padStart(12,'0')}`;
const stamp='2026-09-29T00:00:00Z';
const query=new URLSearchParams(location.search),role=query.get('role')||'admin';
if(!['admin','designer','broadcaster'].includes(role))throw Error('Rôle de recette inconnu.');
const member:Member={email:'resources@example.test',name:'Recette ressources',role:role as Member['role'],active:1};
const failureModes=new Set((query.get('fail')||'').split(',').filter(Boolean));
const heldResources=new Set((query.get('hold')||'').split(',').filter(Boolean));
const releases=new Map<string,()=>void>();
const evidence={role,calls:{media:0,voices:0,directories:0},voiceQueries:[] as unknown[],directoryOffsets:[] as number[],channelSaves:[] as unknown[],programmeSaves:[] as unknown[],failures:[] as string[]};
Object.assign(window,{channelResourceEvidence:evidence,channelResourceRelease:(resource:string)=>releases.get(resource)?.()});
async function waitForRelease(resource:string,signal?:AbortSignal){
  if(!heldResources.has(resource))return;
  await new Promise<void>((resolve,reject)=>{
    const abort=()=>{releases.delete(resource);reject(signal?.reason||new DOMException('Recette arrêtée','AbortError'));};
    releases.set(resource,()=>{signal?.removeEventListener('abort',abort);heldResources.delete(resource);releases.delete(resource);resolve();});
    signal?.addEventListener('abort',abort,{once:true});
  });
  signal?.throwIfAborted();
}
const failed=new Set<string>();
function maybeFail(resource:string){if(failureModes.has(resource)&&!failed.has(resource)){failed.add(resource);evidence.failures.push(resource);throw Error(`Erreur de recette · ${resource}`);}}
const legacyLogo=`/api/graphics/media/${id(90)}/content`;
let channels:Channel[]=[{id:'benin-tv',name:'Bénin TV',logo:legacyLogo,accent:'#efbd32',timezone:'Africa/Porto-Novo',revision:7,archived:0,canManage:true}];
let programmes:Programme[]=[{id:id(80),channel_id:'benin-tv',name:'Magazine de recette',revision:4,archived:0,updated_at:stamp,data:{name:'Magazine de recette',aliases:['Magazine'],category:'Magazine',replayUrl:'',recurring:false,recipe:['ba'],notes:'Note conservée',directoryIds:[id(93)],voiceProfileId:id(92),logo:legacyLogo} as ProgrammeData}];
if(query.has('legacy-logo-absent'))delete programmes[0].data.logo;
const media=(number:number,name:string,mime_type:string,status:MediaAsset['status']='ready'):MediaAsset=>({id:id(number),name,mime_type,status,bytes:70,created_by:member.email,created_at:stamp});
const mediaRows=[media(1,'Logo admissible.png','image/png'),media(2,'Image secondaire.jpg','image/jpeg'),media(3,'Vidéo non admissible.mp4','video/mp4'),media(4,'Audio non admissible.wav','audio/wav'),media(5,'Image en téléversement.png','image/png','uploading'),media(6,'Image en échec.png','image/png','failed'),{...media(7,'Identifiant image invalide.png','image/png'),id:'not-a-uuid'}];
const voice=(number:number,name:string,patch:Partial<PreparationProfileSummary>={}):PreparationProfileSummary=>({id:id(number),kind:'voice',name,favorite:false,archived:false,revision:2,template_id:null,template_version:null,library_version:null,created_by:member.email,updated_by:member.email,created_at:stamp,updated_at:stamp,validated_by:member.email,validated_at:stamp,...patch});
const voicePage1=[voice(11,'Voix validée première page'),voice(12,'Voix sans validation',{validated_by:null,validated_at:null}),voice(13,'Voix archivée',{archived:true}),voice(14,'Voix sans date de validation',{validated_at:null}),voice(15,'Voix sans validateur',{validated_by:null}),voice(16,'Profil non vocal',{kind:'programme'})];
const voicePage2=[voice(21,'Voix validée deuxième page')];
const nextVoice={before:'2026-09-28T00:00:00Z',afterId:id(16)};
const directory=(number:number,name:string,patch:Partial<PlannerSummary>={}):PlannerSummary=>({id:id(number),revision:1,kind:'directory',name,updatedAt:stamp,archived:false,...patch});
const directoryPage1=[directory(31,'Emplacement première page'),directory(32,'Emplacement archivé',{archived:true}),directory(33,'Document non dossier',{kind:'plan'})];
const directoryPage2=[directory(41,'Emplacement deuxième page')];

api.channels=async()=>structuredClone(channels);
api.updateChannel=async(channelId,revision,data)=>{
  evidence.channelSaves.push(structuredClone({id:channelId,revision,data}));
  const saved={...channels[0],...data,revision:revision+1};channels=[saved];return structuredClone(saved);
};
api.programmes=async()=>structuredClone(programmes);
api.saveProgramme=async(programmeId,revision,data)=>{
  evidence.programmeSaves.push(structuredClone({id:programmeId,revision,data}));
  const saved={...programmes[0],id:programmeId||id(81),name:data.name,revision:revision+1,data:structuredClone(data)};programmes=[saved];return structuredClone(saved);
};
api.media=async signal=>{signal?.throwIfAborted();evidence.calls.media++;await waitForRelease('media',signal);maybeFail('media');return structuredClone(mediaRows);};
preparationProfiles.list=async(options={},signal)=>{
  signal?.throwIfAborted();evidence.calls.voices++;evidence.voiceQueries.push(structuredClone(options));await waitForRelease('voices',signal);maybeFail(options.next?'voices-next':'voices');
  return {profiles:structuredClone(options.next?voicePage2:voicePage1),next:options.next?null:nextVoice};
};
plannerAPI.list=async(kind,offset=0,_programme,signal)=>{
  signal?.throwIfAborted();if(kind!=='directory')return {documents:[],next:null};
  evidence.calls.directories++;evidence.directoryOffsets.push(offset);await waitForRelease('directories',signal);maybeFail(offset?'directories-next':'directories');
  return {documents:structuredClone(offset?directoryPage2:directoryPage1),next:offset?null:100};
};
api.projects=async()=>({projects:[],next:null});api.catalogue=async()=>[];api.transfers=async()=>[];
plannerAPI.overview=async(view,date)=>({view,date,items:[],next:null});
api.members=async()=>[member];api.channelMembers=async()=>[member];api.setChannelMember=async()=>({});api.activity=async()=>[];
api.search=async()=>({projects:[],programmes:[],media:[]});
createRoot(document.getElementById('root')!).render(<Studio member={member}/>);
