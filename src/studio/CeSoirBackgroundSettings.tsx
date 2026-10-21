import type {ProjectData} from './domain';
import {CE_SOIR_BACKGROUND,CE_SOIR_COLORS,ceSoirBackgroundPatch} from './ce-soir-background';
import type {CeSoirBackground} from './ce-soir-background';
import CharterColourChoice from './CharterColourChoice';

const choices=[{value:'original',label:'Fond actuel'},...Object.entries(CE_SOIR_COLORS).map(([value,colour])=>({value,colour,label:{vert:'Vert',rouge:'Rouge',or:'Or'}[value]!}))];

export default function CeSoirBackgroundSettings({data,onChange,disabled=false}:{data:ProjectData;onChange:(patch:ProjectData)=>void;disabled?:boolean}){
  const selected=String(data[CE_SOIR_BACKGROUND]||'original');
  return <section className="ce-soir-background-setting" data-inspector-field={CE_SOIR_BACKGROUND}>
    <CharterColourChoice title="Fond de l’habillage" value={selected} choices={choices} disabled={disabled} onChange={value=>onChange(ceSoirBackgroundPatch(data,value as CeSoirBackground))} help="Fond uni dès la première image, jusqu’à la dernière. Les trois programmes restent en place. « Fond actuel » rétablit votre fond précédent."/>
    {selected==='original'&&data._out_mode==='media_end'&&data._out_media_track==='background'?<small>Avec un fond uni, la sortie utilisera la durée réglée dans « Durée ».</small>:null}
  </section>;
}
