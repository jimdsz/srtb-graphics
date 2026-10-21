import type {ProjectData} from './domain';

export const APPOINTMENT_DISPLAY='_studio_ba_appointment_display';
export function appointmentTextVisible(data:ProjectData){return !['hidden','logo'].includes(String(data[APPOINTMENT_DISPLAY]));}
/** Stored editorial values are retained when an operator hides the block. */
export function appointmentEngineData(data:ProjectData,native:ProjectData){
  if(!appointmentTextVisible(data))for(const n of [1,2,3]){native[`_jour_${n}`]='';native[`_heure_${n}`]='';}
  return native;
}
export function chooseAppointmentDisplay(data:ProjectData,display:string):ProjectData{
  if(!['text','hidden','logo'].includes(display))throw Error('Affichage du rendez-vous inconnu.');
  const patch:ProjectData={[APPOINTMENT_DISPLAY]:display};
  if(display==='logo'&&data[APPOINTMENT_DISPLAY]!=='logo'){
    const source=data._studio_overlay_logo_url,url=typeof source==='object'?source.url:source;
    Object.assign(patch,{_studio_overlay_logo_enabled:!!url,_studio_overlay_logo_anchor:'bottom-left',_studio_overlay_logo_x:9,_studio_overlay_logo_y:-3,_studio_overlay_logo_size:10});
  }else if(data[APPOINTMENT_DISPLAY]==='logo'&&display!=='logo')patch._studio_overlay_logo_enabled=false;
  return patch;
}
