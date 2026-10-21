import {useId} from 'react';
import {textColourChoices} from './charter-colours';

/** Native radios retain Tab/arrow-key behaviour and named, non-colour cues. */
export default function CharterColourChoice({value,onChange,choices=textColourChoices,title='Couleur du texte',help='Ce texte uniquement, dans le format affiché. « Du modèle » rétablit sa couleur sans effacer ses autres réglages.',disabled=false}:{value:string;onChange:(value:string)=>void;choices?:readonly {value:string;label:string;colour?:string}[];title?:string;help?:string;disabled?:boolean}){
  const id=useId();
  return <fieldset className="charter-colour-choice" disabled={disabled}><legend>{title}</legend><div>
    {choices.map(choice=><label key={choice.value} className={value===choice.value?'selected':undefined}>
      <input className="sr-only" type="radio" name={id} value={choice.value} checked={value===choice.value} onChange={()=>onChange(choice.value)}/>
      <span className={`colour-swatch${choice.value==='original'?' is-original':''}`} style={choice.value==='original'?undefined:{backgroundColor:choice.colour||choice.value}} aria-hidden="true"/>
      <span>{choice.label}</span><span className="colour-selected" aria-hidden="true">{value===choice.value?'✓':''}</span>
    </label>)}
  </div><small>{help}</small></fieldset>;
}
