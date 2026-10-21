import type {BroadcastTemplate,ProjectData} from './domain';
import {presentation} from './presentation';
import {PORTRAIT_LAYOUT,portraitPanelTemplate,portraitLayoutMode} from './social-portrait-layout';
import {compactCardTemplate,compactSocialCard,socialCardKey,socialCardScale} from './social-card-settings';
import {Minimize2,RotateCcw} from 'lucide-react';
import RelayPlacementSettings from './RelayPlacementSettings';
export default function PlacementSettings({template,data,onChange,disabled}:{template:BroadcastTemplate;data:ProjectData;onChange:(patch:ProjectData)=>void;disabled:boolean}){
  const format=presentation(data);if(format==='tv')return template.id==='BTV_Relais_Antenne'?<RelayPlacementSettings {...{data,onChange,disabled}}/>:null;
  const size=socialCardScale(data),sizeKey=socialCardKey(format,'scale'),compactKey=socialCardKey(format,'compact');
  const canCompact=compactCardTemplate(template.id)&&(format==='vertical'||!portraitPanelTemplate(template.id));
  const logo=['BTV_BA_1P','BTV_BA_TDS','BTV_BA_TDS_SUIVI_DE','BTV_Ce_Soir'].includes(template.id),sponsor=Object.keys(template.fields).some(key=>key.includes('sponsor'));
  return <><section className="social-card-settings" aria-label="Carton des réseaux sociaux"><header><Minimize2 size={18} aria-hidden="true"/><strong>Carton des réseaux</strong><span>{format==='vertical'?'9:16':'4:5'}</span></header><fieldset disabled={disabled}>
    <label>Taille du carton <output>{size} %</output><input aria-label="Taille du carton" type="range" min="50" max="100" step="1" value={size} onChange={e=>onChange({[sizeKey]:Number(e.target.value)})}/></label>
    <div className="social-card-presets">{[[65,'Petit'],[80,'Moyen'],[100,'Grand']] .map(([value,label])=><button type="button" key={value} aria-pressed={size===value} onClick={()=>onChange({[sizeKey]:Number(value)})}>{label}</button>)}</div>
    {canCompact?<label className="social-card-compact"><input type="checkbox" checked={compactSocialCard(data)} onChange={e=>onChange({[compactKey]:e.target.checked})}/>Réduire les espaces vides</label>:null}
    <small>Fond et contenu proportionnels. Aperçu immédiat ; la version TV et l’autre format ne changent pas.</small>
    {size<70?<small role="status">Petit carton : vérifiez la lisibilité sur un téléphone.</small>:null}
    <button type="button" className="social-card-reset" onClick={()=>onChange({[sizeKey]:100,[compactKey]:true})}><RotateCcw size={14} aria-hidden="true"/>Rétablir ce carton</button>
  </fieldset></section><details className="field-section"><summary>Placement <span>Logos et textes</span></summary><fieldset disabled={disabled} data-inspector-field="_studio_logo_anchor">
    {presentation(data)==='portrait'&&portraitPanelTemplate(template.id)?<label>Mise en page du panneau 4:5<select value={portraitLayoutMode(data)} onChange={e=>onChange({[PORTRAIT_LAYOUT]:e.target.value})}><option value="compact">Compact · adapté au contenu</option><option value="legacy">Historique · placements conservés</option></select><small>Les compositions déjà personnalisées gardent leur mise en page historique. Choisir Compact réorganise le panneau sans effacer vos réglages ; le cadrage du média reste manuel.</small></label>:null}
    {logo?<label>Position du logo BTV<select value={String(data._studio_logo_anchor||'top-left')} onChange={e=>onChange({_studio_logo_anchor:e.target.value})}><option value="top-left">En haut à gauche</option><option value="top-right">En haut à droite</option><option value="top-center">En haut au centre</option><option value="bottom-left">En bas à gauche</option><option value="bottom-right">En bas à droite</option></select></label>:null}
    <label>Bloc titre et rendez-vous<select value={String(data._studio_block_anchor||'original')} onChange={e=>onChange({_studio_block_anchor:e.target.value})}><option value="original">Placement de la charte</option><option value="top">En haut</option><option value="center">Au centre</option><option value="bottom">En bas</option></select></label>
    <label>Taille du bloc : {Number(data._studio_block_scale??100)} %<input aria-label="Taille du bloc titre et rendez-vous" type="range" min="70" max="100" step="1" value={Number(data._studio_block_scale??100)} onChange={e=>onChange({_studio_block_scale:Number(e.target.value)})}/></label>
    {(['x','y'] as const).map(axis=><label key={axis}>{axis==='x'?'Décalage horizontal':'Décalage vertical'}<input type="range" min="-100" max="100" step="1" value={Number(data['_studio_block_'+axis]??0)} onChange={e=>onChange({['_studio_block_'+axis]:Number(e.target.value)})}/></label>)}
    {sponsor?<label>Alignement des sponsors<select value={String(data._studio_sponsor_x??50)} onChange={e=>onChange({_studio_sponsor_x:Number(e.target.value)})}><option value="0">À gauche</option><option value="50">Au centre</option><option value="100">À droite</option></select></label>:null}
    <button type="button" onClick={()=>onChange({_studio_logo_anchor:'top-left',_studio_block_anchor:'original',_studio_block_scale:100,_studio_block_x:0,_studio_block_y:0,_studio_sponsor_x:50})}>Rétablir le placement BTV</button>
    <p className="small muted">Les blocs se déplacent avec leur fond, sans étirer les textes. La taille est réduite si nécessaire pour rester dans les marges de sécurité. Réglages communs à l’aperçu et aux exports vidéo ; la composition TV d’origine reste inchangée.</p>
  </fieldset></details></>;
}
