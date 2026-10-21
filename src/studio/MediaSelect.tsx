import {useState} from 'react';
import type {ReactNode} from 'react';
import type {BroadcastField,FieldValue,MediaAsset} from './domain';
import {LocalFileButton} from './LocalMedia';
import {localReference} from './local-reference';

export function mediaValue(media:MediaAsset){return {url:`/api/graphics/media/${media.id}/content`,name:media.name,mimeType:media.mime_type};}
export default function MediaSelect({id,value,field,media,onChange,onBusyChange,onRange,selectionAction,emptyLabel='Aucun média'}:{id:string;value:FieldValue;field:BroadcastField;media:MediaAsset[];onChange:(value:FieldValue)=>void;onBusyChange?:(busy:boolean)=>void;onRange?:(range:{start:number;end:number})=>void;selectionAction?:ReactNode;emptyLabel?:string}){
  const [reading,setReading]=useState(false);
  const kind=field['x-control'],filtered=media.filter(item=>item.status==='ready'&&(kind==='audio'?item.mime_type.startsWith('audio/'):kind==='image'?item.mime_type.startsWith('image/'):!item.mime_type.startsWith('audio/')));
  const url=typeof value==='object'?value.url:typeof value==='string'?value:'',options=new Set(filtered.map(item=>`/api/graphics/media/${item.id}/content`));
  return <><select id={id} value={url} disabled={reading} onChange={event=>{const found=filtered.find(item=>`/api/graphics/media/${item.id}/content`===event.target.value);onChange(found?mediaValue(found):event.target.value);}}>
    <option value="">{emptyLabel}</option>
    {url&&!options.has(url)?<option value={url}>{localReference(url)||url.startsWith('blob:')?`Sur ce poste · ${typeof value==='object'?value.name:'Média local'}`:`Ressource du modèle · ${url.split('/').at(-1)}`}</option>:null}
    {typeof field.default==='string'&&field.default&&field.default!==url?<option value={field.default}>Ressource d’origine</option>:null}
    {filtered.map(item=><option key={item.id} value={`/api/graphics/media/${item.id}/content`}>{item.name}</option>)}
  </select><LocalFileButton selectionKey={url} onChoose={onChange} onRange={onRange} selectionAction={selectionAction} kind={kind} onBusyChange={busy=>{setReading(busy);onBusyChange?.(busy);}}/><small>Le choix local n’envoie aucun fichier. Le menu ci-dessus donne aussi accès aux médias déjà partagés.</small></>;
}
