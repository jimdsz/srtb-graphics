import {templateDefaults} from './domain';
import type {BroadcastTemplate} from './domain';
export const REPLAY_DEMO_URL='https://srtb-graphics.pages.dev/';
export const CATALOGUE_MEDIA_EXAMPLES=new Set(['BTV_Renvoi','BTV_Evenement','BTV_Semainier']);
/** An opaque, lightweight library-only image preserves AE's media occlusion.
 * A transparent missing rush otherwise exposes the large logo underneath an
 * incoming shot. Never use this function for saved project data or export. */
export function catalogueMediaExampleSvg(label:string){
  const safe=label.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]!));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#24343c"/><stop offset="1" stop-color="#101b22"/></linearGradient></defs><path fill="url(#bg)" d="M0 0H1920V1080H0z"/><path fill="#2a454e" d="M0 870L480 390L920 830L1240 510L1920 1040V1080H0z"/><circle cx="1420" cy="235" r="76" fill="#68848b"/><text x="960" y="990" text-anchor="middle" font-family="sans-serif" font-size="28" fill="#c4d2d5">${safe} · vos images ici</text></svg>`;
}
// Fixed, public illustrations live for this document's lifetime, like the
// catalogue defaults map. Reuse their object URLs instead of reallocating on
// every selection. No data URL exemption in the project/server validator.
const examples=new Map<string,{url:string;name:string;mimeType:string}>();
export function isCatalogueMediaExample(url:string){return [...examples.values()].some(example=>example.url===url);}
export function catalogueMediaExample(label:string){
  let example=examples.get(label);
  if(!example){example={url:URL.createObjectURL(new Blob([catalogueMediaExampleSvg(label)],{type:'image/svg+xml'})),name:`Illustration · ${label}`,mimeType:'image/svg+xml'};examples.set(label,example);}
  return example;
}
// Library demonstration only. Project creation keeps the real defaults (empty
// replay URL); this example must never be silently copied into a project.
export function cataloguePreviewData(template:BroadcastTemplate){
  const data=templateDefaults(template);
  if(CATALOGUE_MEDIA_EXAMPLES.has(template.id)){
    const fields=template.id==='BTV_Renvoi'?[['_media_renvoi_url','Renvoi']]:template.id==='BTV_Evenement'?[['_media_intro_url','Introduction'],['_media_event_url','Événement']]:[
      ['_media_intro_url','Introduction'],...Array.from({length:7},(_,i)=>[`_media_programme_${i+1}_url`,`Programme ${i+1}`]),['_media_final_url','Conclusion'],
    ];
    for(const [key,label]of fields)if(!data[key])data[key]=catalogueMediaExample(label);
  }
  return template.id==='BTV_Passerelle_Replay'?{...data,_replay_url:REPLAY_DEMO_URL}:data;
}
