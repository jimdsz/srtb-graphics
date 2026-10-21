import type {BroadcastTemplate} from './domain';
import {studioEngineModule} from './text-editing';
const adapted=new Set(['BTV_Renvoi','BTV_Evenement','BTV_Semainier','BTV_Ce_Soir','BTV_Relais_Antenne','BTV_Passerelle_Replay']);
/** Preview alone opts into cancellable loaders. AE v2 shares the complete OUT
 * configuration with export; v1 remains available to already-open clients. */
export function previewEngineModule(template:BroadcastTemplate){
  const source=`/library/v1.7.0/${template.id}/${['BTV_Renvoi','BTV_Evenement','BTV_Semainier'].includes(template.id)?'graphic-v2.mjs':'graphic.mjs'}`;
  const version=template.id==='BTV_Passerelle_Replay'?'v3':['BTV_Evenement','BTV_Semainier'].includes(template.id)?'v2':'v1';
  return template.libraryVersion==='1.7.0'&&template.version===(template.id==='BTV_Passerelle_Replay'?'1.1.0':'1.0.0')&&template.module===source&&adapted.has(template.id)?`/studio-engines/preview-network-${version}/${template.id}.mjs`:studioEngineModule(template);
}
