import type {ProjectData} from './domain';
import {relayKeys,relayNewDefaults,relayMinScale} from './relay-placement';
import {Move,RotateCcw} from 'lucide-react';
export default function RelayPlacementSettings({data,onChange,disabled}:{data:ProjectData;onChange:(patch:ProjectData)=>void;disabled:boolean}){
  return <section className="social-card-settings" aria-label="Placement du relais TV"><header><Move size={18}/><strong>Relais · placement TV</strong></header><fieldset disabled={disabled}>
    <div className="social-card-presets">{[[0,'Petit · à gauche'],[100,'Petit · à droite']].map(([value,label])=><button type="button" key={value} aria-pressed={Number(data._studio_relay_scale)===40&&Number(data._studio_relay_x)===value&&Number(data._studio_relay_y)===80} onClick={()=>onChange({...relayNewDefaults,_studio_relay_x:Number(value)})}>{label}</button>)}</div>
    {relayKeys.map((key,i)=><label key={key}>{['Taille du relais','Position horizontale','Position verticale'][i]} <output>{Number(data[key]??[100,50,100][i])} %</output><input aria-label={['Taille du relais','Position horizontale du relais','Position verticale du relais'][i]} type="range" min={i===0?relayMinScale:0} max="100" step="1" value={Number(data[key]??[100,50,100][i])} onChange={e=>onChange({[key]:Number(e.target.value)})}/></label>)}
    <small>Les préréglages compacts laissent le centre et le bas de l’image libres. Vérifiez sur vos images la place des visages et de l’habillage d’antenne.</small>
    {Number(data._studio_relay_scale??100)<40?<small role="status">Très petit : vérifiez la lisibilité des textes sur un écran TV.</small>:null}
    <button type="button" onClick={()=>onChange(relayNewDefaults)}><RotateCcw size={14}/>Rétablir le relais compact</button>
    <button type="button" onClick={()=>onChange({_studio_relay_scale:100,_studio_relay_x:50,_studio_relay_y:100})}>Placement historique</button>
  </fieldset></section>;
}
