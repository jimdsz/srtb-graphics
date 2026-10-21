import {isMediaField,isSequenceField} from '../src/studio/domain';
import type {BroadcastTemplate,ProjectData} from '../src/studio/domain';
import {selectedMediaData} from '../src/studio/media-selection';

// Inspect actual media fields, not editorial text, filenames or QR destinations.
// Keep saved alternatives intact while checking only what the engine will use.
export function sharedMediaReferences(template:BroadcastTemplate,data:ProjectData):string[]{
  const selected=selectedMediaData(template,data),ids=new Set<string>();
  function add(value:unknown){
    const url=typeof value==='string'?value:value&&typeof value==='object'&&'url'in value?value.url:undefined;
    const match=typeof url==='string'?url.match(/^\/api\/graphics\/media\/([a-f\d-]+)\/content$/):null;
    if(match)ids.add(match[1]);
  }
  for(const [key,field]of Object.entries(template.fields)){
    if(isMediaField(key,field))add(selected[key]);
    else if(isSequenceField(key,field)){
      const clips:unknown=JSON.parse(String(selected[key]||'[]'));
      if(Array.isArray(clips))for(const clip of clips)if(clip&&typeof clip==='object'&&'url'in clip)add(clip.url);
    }
  }
  return [...ids];
}
