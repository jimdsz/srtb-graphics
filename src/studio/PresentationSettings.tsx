import {useId} from 'react';
import type {BroadcastTemplate,ProjectData} from './domain';
import {ANNOUNCEMENTS,PRESENTATIONS,presentation,changeAnnouncement,announcementPreset} from './presentation';
import {Monitor,RectangleVertical,Smartphone} from 'lucide-react';

export default function PresentationSettings({template,data,onChange,disabled}:{template:BroadcastTemplate;data:ProjectData;onChange:(data:ProjectData)=>void;disabled:boolean}){
  const id=useId(),format=presentation(data),simple=template.id==='BTV_BA_1P'&&data._studio_ba_mode==='simple';
  const announcement=announcementPreset(data._jour_1);
  return <fieldset className="presentation-settings" disabled={disabled}>
    <legend>Composition</legend>
    <div className="format-chooser" role="group" aria-label="Destination">{Object.entries(PRESENTATIONS).map(([value,p])=>{const Icon=value==='tv'?Monitor:value==='portrait'?RectangleVertical:Smartphone;return <label key={value} className={format===value?'selected':''} title={`${p.width} × ${p.height}`}><input type="radio" name={`${id}-destination`} checked={format===value} value={value} onChange={()=>onChange({...data,_studio_format:value})}/><Icon size={23} aria-hidden="true"/><span>{value==='tv'?'Télévision':value==='portrait'?'Portrait':'Vertical'}<small>{value==='tv'?'16:9':value==='portrait'?'4:5':'9:16'}</small></span></label>;})}</div>
    {format!=='tv'?<details className="composition-help"><summary>À propos du format social</summary><p>Textes, extraits et sons sont partagés avec la version TV. Ajustez le cadrage dans Médias. Les réglages propres à la TV sont conservés. Le paquet HTML de diffusion reste en 16:9.</p></details>:null}
    {template.id==='BTV_BA_1P'?<>
      <label>Rendez-vous<select value={simple?'simple':'multiple'} onChange={e=>onChange({...data,_studio_ba_mode:e.target.value,...(e.target.value==='simple'?{_audio_voice_enabled:false,_jour_1:data._jour_1||'Ce soir',_heure_1:data._heure_1??''}:{})})}><option value="simple">BA simple · un rendez-vous</option><option value="multiple">BA multi-diffusions · jusqu’à trois rendez-vous</option></select></label>
      {simple&&(data._jour_2||data._jour_3)?<p className="small muted">Les autres rendez-vous sont masqués, mais conservés. Repassez en multi-diffusions pour les retrouver.</p>:null}
      {simple?<><label>Annonce<select value={announcement??'custom'} onChange={e=>onChange(changeAnnouncement(data,e.target.value==='custom'?'':e.target.value))}>{ANNOUNCEMENTS.map(day=><option key={day}>{day}</option>)}<option value="custom">Autre libellé / date</option></select></label>
      {!announcement?<label>Libellé de diffusion<input value={String(data._jour_1??'')} onChange={e=>onChange(changeAnnouncement(data,e.target.value))}/></label>:null}
      <label>Heure de diffusion · facultative<input value={String(data._heure_1??'')} placeholder="Laisser vide si inconnue" onChange={e=>onChange({...data,_heure_1:e.target.value})}/></label>
      <details className="composition-help"><summary>Annonce et voix off</summary><p>Vérifiez « Ce soir » ou « Demain » avant publication. Changer l’annonce désactive la voix off pour éviter un jour incorrect. Choisissez la voix et son passage dans Son ; musique et extraits restent inchangés.</p></details></>:null}
    </>:null}
  </fieldset>;
}
