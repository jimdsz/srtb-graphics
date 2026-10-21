import {useId} from 'react';
import type {BroadcastTemplate,MediaAsset,ProjectData} from './domain';
import {APPOINTMENT_DISPLAY,chooseAppointmentDisplay} from './appointment-display';
import MediaSelect from './MediaSelect';

export default function AppointmentSettings({template,data,media,onChange,onLogoSettings,disabled}:{template:BroadcastTemplate;data:ProjectData;media:MediaAsset[];onChange:(patch:ProjectData)=>void;onLogoSettings:()=>void;disabled:boolean}){
  const id=useId();if(template.id!=='BTV_BA_1P')return null;
  const display=String(data[APPOINTMENT_DISPLAY]||'text');
  return <section className="field-section"><fieldset disabled={disabled}><legend>Bloc rendez-vous</legend>
    <label>Contenu affiché<select value={display} onChange={event=>onChange(chooseAppointmentDisplay(data,event.target.value))}>
      <option value="text">Annonce et heure facultative</option><option value="hidden">Masquer le rendez-vous</option><option value="logo">Remplacer par un logo</option>
    </select></label>
    {display==='text'?<p className="small muted">L’heure peut rester vide. Cliquez sur l’annonce dans l’aperçu pour régler sa taille et sa position indépendamment.</p>:<p className="small muted">Les dates et heures sont conservées dans le projet, mais masquées dans l’aperçu et l’export. Les voix off restent indépendantes : vérifiez ce qu’elles annoncent.</p>}
    {display==='logo'?<><label htmlFor={id}>Logo à afficher à la place</label><MediaSelect id={id} value={data._studio_overlay_logo_url||''} field={template.fields._studio_overlay_logo_url} media={media} emptyLabel="Choisir un logo" onChange={value=>onChange({_studio_overlay_logo_url:value,_studio_overlay_logo_enabled:!!(typeof value==='object'?value.url:value)})}/><button type="button" onClick={onLogoSettings}>Position, taille et apparition du logo</button><small>Utilise l’emplacement « Logo supplémentaire ». Le logo BTV et les sponsors restent séparés.</small></>:null}
  </fieldset></section>;
}
