import type {BroadcastTemplate,ProjectData} from './domain';
import {ceSoirSignaturePreset} from './ce-soir-audio';

// Original files explicitly shared by SRTB on 24 September. These are private
// API references, never public assets or anonymous download credentials.
const sharedSignatures:Record<string,{id:string;name:string}>={
  BTV_Renvoi:{id:'771c3ca4-0b6d-4473-a154-8b413762e1d4',name:'BTV_RENVOI PIQURE DE RAPPEL -23LUFS.wav'},
  BTV_Evenement:{id:'37620099-c2ad-4bf1-93a1-6f4966c12d89',name:'BTV_BA EVENEMENT_-23LUFS.wav'},
  BTV_Semainier:{id:'363b053e-8c50-4df0-9311-7fb371077974',name:'BTV_BA SEMAINIER_-23LUFS.wav'},
};

/** Restore only the target engine's own accompaniment. Voice and media tracks
 * are deliberately outside this patch, as are the source BA's timing values. */
export function modelSignature(template:BroadcastTemplate):ProjectData|undefined{
  if(template.id==='BTV_Ce_Soir'&&template.libraryVersion==='1.7.0')return ceSoirSignaturePreset();
  const shared=template.libraryVersion==='1.7.0'?sharedSignatures[template.id]:undefined;
  if(shared)return {_audio_url:{url:`/api/graphics/media/${shared.id}/content`,name:shared.name,mimeType:'audio/wav'},_audio_enabled:true,_audio_volume:1};
  if(!['BTV_BA_1P','BTV_BA_TDS','BTV_BA_TDS_SUIVI_DE'].includes(template.id)||!template.fields._audio_bed_url?.default)return;
  const patch:ProjectData={};
  for(const [key,field]of Object.entries(template.fields))if(key.startsWith('_audio_bed_')&&field.default!==undefined)patch[key]=field.default;
  patch._audio_bed_enabled=true;
  return patch;
}

/** Existing silent projects need an explicit, undoable activation. Never guess
 * whether an old false value was the template default or an operator's choice. */
export function inactiveTDSSignature(template:BroadcastTemplate,data:ProjectData):ProjectData|undefined{
  if(template.libraryVersion!=='1.7.0'||!['BTV_BA_TDS','BTV_BA_TDS_SUIVI_DE'].includes(template.id)||data._audio_bed_enabled===true)return;
  return modelSignature(template);
}

export function derivedSignature(source:ProjectData,target:BroadcastTemplate):{patch:ProjectData;warning:string}{
  const preset=modelSignature(target);
  if(!preset)throw Error('Ce modèle ne possède pas de signature sonore native.');
  // An explicitly silent source stays silent. A stale voice never follows it.
  if(source._audio_bed_enabled!==true)return {patch:{...preset,_audio_bed_enabled:false},warning:'Signature sonore désactivée, comme dans la BA source. La voix et le son des médias ne sont pas repris.'};
  const maximum=Number(target.fields._audio_bed_volume?.maximum??1);
  const requested=Number(source._audio_bed_gain??source._audio_bed_volume??1),volume=Math.min(maximum,Math.max(0,requested));
  return {patch:{...preset,_audio_bed_volume:volume},warning:`Signature sonore du modèle Tout de suite activée, avec ses propres repères. La voix, le fichier musical personnalisé et le son des médias de la BA ne sont pas copiés.${requested>maximum?' Le gain est limité à celui permis par ce modèle ; contrôlez l’écoute.':''}`};
}
