import {useId} from 'react';
import type {BroadcastTemplate,MediaAsset,ProjectData} from './domain';
import {hasOverlayLogo,logoSourcePatch,nativeLogoSlots,overlayLogoPrefix as prefix,overlayLogoSourcePatch} from './native-logo-settings';
import MediaSelect from './MediaSelect';
import type {overlayLogoGeometry} from './logo-model';
import {baSocialDirect} from './ba-social-direct';

export default function LogoSettings({template,data,media,onChange,disabled,layout}:{template:BroadcastTemplate;data:ProjectData;media:MediaAsset[];onChange:(patch:ProjectData)=>void;disabled:boolean;layout?:ReturnType<typeof overlayLogoGeometry>}){
  const id=useId(),slots=nativeLogoSlots(template),overlay=hasOverlayLogo(template);if(!slots.length&&!overlay)return null;
  const logo=data[prefix+'url']??'',url=typeof logo==='object'?logo.url:String(logo),enabled=data[prefix+'enabled']===true;
  const direct=baSocialDirect(template.id,data);
  return <section className="logo-settings" aria-label="Logos et sponsors"><header><h3>Logos & sponsors</h3><p>Le logo de la chaîne reste inchangé. Un logo supplémentaire et les sponsors du modèle se règlent séparément.</p></header><fieldset disabled={disabled}>
    {overlay?<div className="logo-slot overlay-logo-settings" data-inspector-field={prefix+'url'}><h4>Logo supplémentaire · facultatif</h4>
      <label htmlFor={`${id}-overlay`}>Image du logo</label><MediaSelect id={`${id}-overlay`} value={logo} field={template.fields[prefix+'url']} media={media} emptyLabel="Aucune image" onChange={value=>onChange(overlayLogoSourcePatch(value))}/>
      <label className="logo-visible"><input type="checkbox" checked={enabled} disabled={!url&&!enabled} onChange={event=>onChange({[prefix+'enabled']:event.target.checked})}/>Afficher ce logo supplémentaire</label>
      <p className="logo-state">{enabled?'Ce logo est affiché avec les réglages ci-dessous.':url?'Image choisie. Cochez « Afficher ce logo supplémentaire » pour l’ajouter.':'Choisissez une image, puis activez son affichage.'} Masquer conserve le fichier et ses réglages.</p>
      <label>Position<select value={String(data[prefix+'anchor']||'top-right')} onChange={event=>onChange({[prefix+'anchor']:event.target.value})}>{[['top-left','En haut à gauche'],['top-center','En haut au centre'],['top-right','En haut à droite'],['bottom-left','En bas à gauche'],['bottom-center','En bas au centre'],['bottom-right','En bas à droite']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label>Taille maximale : {Number(data[prefix+'size']??12)} %<input aria-label="Taille du logo supplémentaire" type="range" min="4" max="25" step="1" value={Number(data[prefix+'size']??12)} onChange={event=>onChange({[prefix+'size']:Number(event.target.value)})}/></label>
      {direct?<p className="small">Logo fixe pendant les extraits. Les réglages d’animation TV sont conservés.</p>:<label>Apparition<select value={String(data[prefix+'motion']||'none')} onChange={event=>onChange({[prefix+'motion']:event.target.value})}><option value="none">Sans animation</option><option value="fade">Fondu</option><option value="slide">Glissement</option></select></label>}
      <details className="logo-credit"><summary>{direct?'Fond et décalage':'Fond, décalage et délai'}</summary><div className="logo-advanced-grid">
        <label>Fond derrière le logo<select value={String(data[prefix+'plate']||'none')} onChange={event=>onChange({[prefix+'plate']:event.target.value})}>{[['none','Aucun'],['white','Blanc'],['black','Noir'],['gold','Or BTV'],['green','Vert BTV']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        {!direct?<label>Délai après IN (s)<input type="number" min="0" max="5" step=".04" value={Number(data[prefix+'delay']??0)} onChange={event=>onChange({[prefix+'delay']:Number(event.target.value)})}/></label>:null}
        {(['x','y'] as const).map(axis=><label key={axis}>{axis==='x'?'Décalage horizontal (%)':'Décalage vertical (%)'}<input type="number" min="-20" max="20" step="1" value={Number(data[prefix+axis]??0)} onChange={event=>onChange({[prefix+axis]:Number(event.target.value)})}/></label>)}
      </div><p className="small logo-measured" role="status">{enabled&&layout?`Dernier aperçu mesuré : horizontal ${layout.x.toFixed(2)} %, vertical ${layout.y.toFixed(2)} % après limitation aux marges.`:enabled?'Le décalage réellement appliqué sera mesuré après chargement du logo dans l’aperçu.':'Logo masqué : aucune image n’est chargée pour mesurer son placement.'}</p></details><small>PNG, JPEG ou WebP. L’image garde ses proportions et reste dans les marges de sécurité. Un décalage trop grand est limité ; contrôlez le placement dans chaque format.</small>
    </div>:null}
    {slots.length?<details className="native-logo-details" open={!overlay}><summary>Sponsors du modèle <span>{slots.length} emplacement{slots.length>1?'s':''}</span></summary>
    {slots.map((slot,index)=>{const visible=data[slot.visible]===true,original=!!slot.original&&data[slot.original]!==false;return <div className="logo-slot" key={slot.key} data-inspector-field={slot.key}>
      <h4>{slot.label}</h4>
      {slot.original?<label>Affichage<select value={!visible?'hidden':original?'original':'custom'} onChange={event=>onChange({[slot.visible]:event.target.value!=='hidden',...event.target.value==='hidden'?{}:{[slot.original!]:event.target.value==='original'}})}><option value="hidden">Ne pas afficher</option><option value="original">Logos du modèle</option><option value="custom">Image personnalisée</option></select></label>:<label className="logo-visible"><input type="checkbox" checked={visible} onChange={event=>onChange({[slot.visible]:event.target.checked})}/>Afficher ce logo</label>}
      <label htmlFor={`${id}-${index}`}>Image du logo{slot.original?' personnalisé':''}</label>
      <MediaSelect id={`${id}-${index}`} value={data[slot.key]??template.fields[slot.key].default??''} field={template.fields[slot.key]} media={media} emptyLabel="Aucune image — logo masqué" onChange={value=>onChange(logoSourcePatch(template,slot.key,value))}/>
      <small>PNG, JPEG ou WebP. Choisir une image l’affiche dans cet emplacement ; masquer le logo conserve le fichier choisi.</small>
      {!visible?<p className="logo-state">Ce logo est masqué.</p>:original?<p className="logo-state">Les logos d’origine sont affichés. Le fichier personnalisé est conservé.</p>:null}
    </div>;})}
    {'_sponsor_label_visible' in template.fields?<details className="logo-credit"><summary>Mention de participation</summary><label className="logo-visible"><input type="checkbox" checked={data._sponsor_label_visible===true} onChange={event=>onChange({_sponsor_label_visible:event.target.checked})}/>Afficher la mention</label><label>Texte de la mention<input value={String(data._sponsor_label??'')} maxLength={template.fields._sponsor_label.maxLength??2048} onChange={event=>onChange({_sponsor_label:event.target.value})}/></label></details>:null}
    <p className="small muted">Le sponsor suit l’emplacement et l’affichage du modèle. Aucun effet d’apparition indépendant n’est disponible ici.</p></details>:null}
  </fieldset></section>;
}
