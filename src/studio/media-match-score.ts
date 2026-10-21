import type {IndexedMedia,PlannerRow,ProgrammeRule} from './day-planner-model';
import {mediaDateHint} from './day-planner-media-date';
import {mediaEpisodeHint} from './day-planner-media-episode';

// Shared verbatim by the browser and the packaged connector. Keep this module
// independent of UI/schema runtime dependencies: indexes can contain 250k files.
export const matchWords=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('fr').replace(/[^a-z0-9]+/g,' ').trim();
export function programmeWords(value:string){return [...new Set(matchWords(value).split(' ').filter(w=>w.length>2&&!['les','des','une','sur','dans','pour'].includes(w)))];}
const cache=new WeakMap<IndexedMedia,{path:string;name:string;hay:string;tokens:Set<string>;technical:boolean}>();
function technicalMedia(file:IndexedMedia,hay:string){
 const name=matchWords(file.name);
 return /^(?:logo(?:s)?|fond(?:s)?|synthe|habillage|generique|gen fin|intro|jingle|mire|pip|capture|screenshot)(?: |$)/.test(name)
  ||/(?:^| )(?:pop up|popup|ba|bandes? annonces?|jingle|habillage|tout de suite|ce soir|demain)(?: |$)/.test(name)
  ||/(?:^| )(?:bandes? annonces?|pop up|popup|habillage|jingle)(?: |$)/.test(hay)
  ||/[_ .-]\d{4,7}\.(?:png|jpe?g|webp)$/i.test(file.name)
  ||/\.(?:wav|mp3|m4a|ogg)$/i.test(file.name);
}
export function scoreMedia(row:Pick<PlannerRow,'title'|'subtitle'|'airDate'>,directoryId:string,file:IndexedMedia,rule?:ProgrammeRule){
 let value=cache.get(file);
 if(!value||value.path!==file.path||value.name!==file.name){const hay=matchWords(file.path);value={path:file.path,name:file.name,hay,tokens:new Set(hay.split(' ')),technical:technicalMedia(file,hay)};cache.set(file,value);}
 const words=programmeWords(rule?.keywords||row.title),matches=words.filter(w=>value.tokens.has(w));
 const filenameTokens=new Set(matchWords(file.name).split(' ')),folderOnly=words.length>0&&matches.length===words.length&&!words.every(w=>filenameTokens.has(w));
 const title=matchWords(row.title),exact=!!title&&value.hay.includes(title),learned=rule?.directoryId===directoryId&&rule.preferredPath===file.path;
 const episode=mediaEpisodeHint(file,row),date=mediaDateHint(file,row.airDate),technical=!learned&&value.technical;
 const base=learned?100:Math.min(95,Math.round(matches.length/Math.max(1,words.length)*65)+(exact?15:0)+(episode.status==='matching'?15:0));
 const manual=date.manual||technical||(!learned&&folderOnly)||(episode.manual&&(!learned||episode.status!=='unknown'));
 const score=technical?Math.min(45,base):!learned&&folderOnly?Math.min(55,base):manual?Math.min(60,base):date.status==='matching'&&base>=40?Math.min(100,base+20):base;
 const reason=learned?'Association mémorisée par l’équipe':`${matches.length}/${words.length} mots du programme`;
 return {file,score,manual,reason:[reason,learned&&episode.status==='unknown'?'':episode.reason,date.reason,!learned&&folderOnly?'Correspondance dans les dossiers, nom du fichier différent · choix manuel':'',technical?'Habillage ou image de séquence probable · vérifier son usage':''].filter(Boolean).join(' · ')};
}
