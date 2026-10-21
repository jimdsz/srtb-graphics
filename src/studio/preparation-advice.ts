import type {BroadcastTemplate,ProjectData} from './domain';
import {mediaFieldInactive} from './media-selection';
export interface PreparationAdvice {id:string;message:string;query:string;patch?:ProjectData;action?:string}
/** Explain deterministic problems, never infer a programme or a spoken day. */
export function preparationAdvice(template:BroadcastTemplate,data:ProjectData):PreparationAdvice[]{
  const items:PreparationAdvice[]=[];
  for(const prefix of ['', '_p1','_p2']){
    const key=prefix+'_titre_ligne_';
    if(String(data[key+'3']||'').trim()&&!String(data[key+'2']||'').trim())items.push({id:key,message:'Une troisième ligne est renseignée alors que la deuxième est vide.',query:key,patch:{[key+'2']:data[key+'3'],[key+'3']:''},action:'Remonter cette ligne'});
  }
  for(const [key,value]of Object.entries(data)){
    if(!key.startsWith('_media_')||!key.endsWith('_url')||mediaFieldInactive(data,key))continue;
    const prefix=key.slice(0,-4);let sequence:unknown;
    try{sequence=JSON.parse(String(data[prefix+'_sequence']||'[]'));}catch{continue;}
    if(Array.isArray(sequence)&&sequence.length)continue;
    const image=typeof value==='object'?value.mimeType.startsWith('image/'):typeof value==='string'&&/\.(png|jpe?g|webp|gif|svg)(?:[?#]|$)/i.test(value);
    if(image&&data[prefix+'_audio_enabled']===true)items.push({id:key,message:(template.fields[key]?.title||'Ce média')+' est une image : cette piste ne peut pas produire de son.',query:prefix,patch:{[prefix+'_audio_enabled']:false},action:'Désactiver son audio'});
  }
  if(template.id==='BTV_BA_1P'&&data._studio_ba_mode!=='simple'){
    const dates=[1,2,3].map(n=>[data['_jour_'+n],data['_heure_'+n]].join('|').trim()).filter(value=>value!=='|');
    if(new Set(dates).size<dates.length)items.push({id:'duplicate-dates',message:'Deux rendez-vous affichent exactement le même jour et la même heure.',query:'_jour_'});
  }
  return items;
}
