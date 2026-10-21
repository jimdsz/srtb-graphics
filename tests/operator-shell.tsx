// Browser-only data. No authenticated session, remote writes or user files.
import {createRoot} from 'react-dom/client';
import Studio from '../src/studio/Studio';
import {api,ApiError} from '../src/studio/api';
import {derivations} from '../src/studio/derivation-api';
import {getTemplate,templateDefaults,type Project,type Member,type MediaAsset} from '../src/studio/domain';
import '../src/studio/studio.css';
import '../src/studio/theme.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';

const template=getTemplate('BTV_PopUp'),date='2026-09-24T10:00:00Z';
const member:Member={email:'recette@example.test',name:'Poste de recette',role:'admin',active:1};
let projects:Project[]=(['draft','submitted','approved'] as const).map((status,index)=>({id:`shell-${index}`,title:['Le rendez-vous du soir','Tour du Bénin — édition spéciale et arrivée de la dernière étape','Journal de la semaine'][index],template_id:template.id,template_version:template.version,library_version:template.libraryVersion,status,revision:index+1,data:{...templateDefaults(template),_background_visible:false},created_by:member.email,updated_by:member.email,created_at:date,updated_at:date,archived:0}));
let members:Member[]=[member,{email:'coordination.programmes.et.production.regionale@example.test',name:'Coordination des programmes et de la production régionale',role:'broadcaster',active:1},{email:'graphisme@example.test',name:'Atelier graphique',role:'designer',active:0}];
const media:MediaAsset[]=[['image','Tour du Bénin — arrivée à Cotonou.jpg','image/jpeg'],['video','Interview_du_directeur_des_programmes_version_longue_sous_titree_finale.mp4','video/mp4'],['audio','Annonce antenne — rendez-vous du soir.wav','audio/wav']].map(([id,name,mime_type])=>({id,name,mime_type,bytes:1280000,created_by:member.email,created_at:date,status:'ready'}));
if(new URL(location.href).searchParams.has('stress')){members[1]={...members[1],name:'Coordination'.repeat(8),email:`${'m'.repeat(64)}@${'regional'.repeat(7)}.example.test`};media[0]={...media[0],name:`${'image'.repeat(44)}.jpg`,created_by:members[1].email};}
api.projects=async archived=>({projects:structuredClone(projects.filter(project=>!!project.archived===!!archived)),next:null});
api.project=async id=>structuredClone(projects.find(project=>project.id===id)!);
api.media=async()=>media;
api.transfers=async()=>[];
api.members=async()=>structuredClone(members);
api.activity=async()=>[{id:1,actor:members[1].email,action:'project.approve',target:'shell-2',detail:'Validation de la version destinée à la diffusion.',created_at:date}];
api.member=async next=>{members=members.map(value=>value.email===next.email?{...next}:value);if(!members.some(value=>value.email===next.email))members.push({...next});return {ok:true,notice:'Accès enregistré. Aucun e-mail n’a été envoyé automatiquement.'};};
api.create=async(templateId,title,data)=>{const selected=getTemplate(templateId),project:Project={...projects[0],id:'shell-created',title,template_id:templateId,template_version:selected.version,library_version:selected.libraryVersion,data:data||templateDefaults(selected)};projects=[project,...projects];return structuredClone(project);};
api.save=async(previous,title,data)=>{const updated={...previous,title,data,revision:previous.revision+1};projects=projects.map(project=>project.id===previous.id?updated:project);return structuredClone(updated);};
api.comments=async()=>[];
api.revisions=async()=>[];
derivations.origin=async()=>{throw new ApiError('Projet ordinaire de recette.',404);};
createRoot(document.querySelector('#root')!).render(<Studio member={member}/>);
