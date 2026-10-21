import type {BroadcastField,BroadcastTemplate,ProjectData} from './domain';
import {isSequenceField} from './domain';
import {hasOverlayLogo,nativeLogoFieldNames,nativeLogoSlots} from './native-logo-settings';
import {presentation} from './presentation';
import {soundFieldNames} from './sound-level-model';
import {textFields} from './typography-model';
import {voiceTimingFieldNames} from './voice-timing-model';

export const inspectorQuery=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('fr').trim().replace(/\s+/g,' ');
export function matchesInspectorQuery(query:string,...labels:string[]){
  const words=(value:string)=>inspectorQuery(value).split(/[^\p{L}\p{N}_]+/u).filter(Boolean);
  const text=words(labels.join(' '));
  return words(query).every(word=>text.some(label=>label.startsWith(word)));
}

export function matchesInspectorField(query:string,name:string,field:BroadcastField,section:string,extra=''){
  return matchesInspectorQuery(query,name,field.title||'',section,extra,
    isSequenceField(name,field)?'montage assembler assemblage enchaîner extraits séquence passages vidéo début fin ordre couper dupliquer':'');
}

// Grouped editors replace schema fields in the inspector. Index those editors
// as real results, not hidden schema controls that cannot be reached on screen.
export function inspectorSearchPanels(template:BroadcastTemplate,data:ProjectData,query:string){
  const metadata=(names:Iterable<string>)=>[...names].map(name=>`${name} ${template.fields[name]?.title||''} ${template.fields[name]?.['x-section']||''}`).join(' ');
  const matches=(labels:string,names:Iterable<string>=[])=>matchesInspectorQuery(query,labels,metadata(names));
  const sound=soundFieldNames(template),voice=voiceTimingFieldNames(template),texts=textFields(template).map(([key])=>key);
  const logos=[...nativeLogoFieldNames(template),...Object.keys(template.fields).filter(key=>key.startsWith('_studio_overlay_logo_'))];
  const ba=template.id==='BTV_BA_1P';
  return {
    replay:template.id==='BTV_Passerelle_Replay'&&matches('replay émission lien adresse url QR code playlist youtube',['_replay_url']),
    appointment:ba&&matches('bloc rendez-vous annonce heure date masquer cacher remplacer logo',['_studio_ba_appointment_display']),
    typography:texts.length>0&&matches('texte typographie contenu police taille couleur alignement casse gras italique position rotation interligne espacement',texts),
    textLayout:ba&&matches('titre BA répartition lignes carton final corps taille position',Object.keys(template.fields).filter(key=>/^_studio_ba_(pack|body)_/.test(key))),
    sound:sound.length>0&&matches('son audio signature jingle musique pistes niveaux volume gain dB silence activer désactiver',sound),
    voice:voice.length>0&&matches('voix off son audio fichier choisir passage calage IN OUT début fin départ décalage délai durée intro carton',voice),
    logos:(hasOverlayLogo(template)||nativeLogoSlots(template).length>0)&&matches('logo sponsor image taille position apparition animation fond',logos),
    placement:(presentation(data)!=='tv'||template.id==='BTV_Relais_Antenne')&&matches('graphisme relais TV placement logo sponsor texte titre rendez-vous taille position décalage horizontal vertical alignement panneau carton petit moyen grand espaces vides réduire compact historique mise en page 4:5 9:16',['_studio_logo_anchor','_studio_block_anchor','_studio_block_scale','_studio_block_x','_studio_block_y','_studio_sponsor_x','_studio_portrait_layout',...Object.keys(template.fields).filter(key=>/^_studio_(relay|portrait|vertical)_/.test(key))]),
    popupBackground:template.id==='BTV_PopUp'&&matches('fond du pop-up transparent transparence image vidéo média',['_background_visible']),
    ceSoirBackground:template.id==='BTV_Ce_Soir'&&matches('fond panneau uni couleur vert rouge or actuel trois rendez-vous',['_studio_ce_soir_background']),
  };
}
