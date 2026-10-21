import type {ProjectData} from './domain';
import {styleKey,textStyles,TYPOGRAPHY_KEY} from './typography-model';

export const textColourChoices=[
  {value:'original',label:'Du modèle'},
  {value:'#ffffff',label:'Blanc'},
  {value:'#000000',label:'Noir'},
  {value:'#f0b900',label:'Or BTV'},
  {value:'#007300',label:'Vert BTV'},
  {value:'#eb1905',label:'Rouge BTV'},
] as const;

export function patchTextColour(data:ProjectData,field:string,colour:string):ProjectData{
  if(!textColourChoices.some(choice=>choice.value===colour))throw Error('Couleur de texte hors charte.');
  const styles=textStyles(data),key=styleKey(field,String(data._studio_format||'tv')),next={...styles[key]};
  // Remove only this override. A colour-only edit can return to native glyphs;
  // positions, fonts and edits in the other formats remain untouched.
  if(colour==='original')delete next.colour;else next.colour=colour;
  if(Object.keys(next).length)styles[key]=next;else delete styles[key];
  return {[TYPOGRAPHY_KEY]:JSON.stringify(styles)};
}
