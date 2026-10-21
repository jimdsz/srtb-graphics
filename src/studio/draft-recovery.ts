import type {BroadcastTemplate,ProjectData} from './domain';

/** These two frozen title contracts cannot render an empty title. Keep the
 * editable draft intact while the preview retains its last accepted picture. */
export function draftTextIssue(template:Pick<BroadcastTemplate,'id'|'libraryVersion'>,data:ProjectData){
  if(template.libraryVersion!=='1.7.0')return '';
  if(template.id==='BTV_PopUp'&&!String(data._title??'').trim())return 'Ce modèle demande un titre. Vous pouvez poursuivre la saisie ou annuler la modification ; le dernier aperçu valide est conservé.';
  if(template.id==='BTV_BA_1P'){
    if(!String(data._titre_ligne_1??'').trim())return 'La première ligne du titre est vide. Vous pouvez poursuivre la saisie ou annuler la modification ; le dernier aperçu valide est conservé.';
    if(!String(data._titre_ligne_2??'').trim()&&String(data._titre_ligne_3??'').trim())return 'La troisième ligne du titre demande une deuxième ligne. Complétez-la ou remontez le texte ; le dernier aperçu valide est conservé.';
  }
  return '';
}

export interface DraftChange {before:ProjectData;after:ProjectData;at:number}
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
/** Coalesce one typing burst; bound history and never copy media file bytes. */
export function recordDraftChange(history:readonly DraftChange[],before:ProjectData,after:ProjectData,at:number):DraftChange[]{
  const keys=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(key=>!same(before[key],after[key])).sort();
  if(!keys.length)return [...history];
  const previous=history.at(-1),merge=previous&&at-previous.at<750&&same(Object.keys(previous.after).sort(),keys)&&keys.every(key=>same(previous.after[key],before[key]));
  const change={before:merge?previous.before:Object.fromEntries(keys.map(key=>[key,before[key]])),after:Object.fromEntries(keys.map(key=>[key,after[key]])),at};
  return [...(merge?history.slice(0,-1):history),change].slice(-32);
}
/** A later media reconnection or external edit wins over an old undo entry. */
export function undoDraftChange(data:ProjectData,change:DraftChange){
  const next={...data};
  for(const key of Object.keys(change.after))if(same(next[key],change.after[key])){
    if(change.before[key]===undefined)delete next[key];else next[key]=change.before[key];
  }
  return next;
}
