import type {IndexedMedia,PlannerRow} from './day-planner-model';

type EpisodeLabel={episodes:number[];seasons:number[];ambiguous:boolean};
const fold=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('fr');
const words=(value:string)=>fold(value).replace(/[^a-z0-9]+/g,' ').trim();
const fileCache=new WeakMap<IndexedMedia,{path:string;name:string;label:EpisodeLabel;stem:string}>();
const labelCache=new Map<string,EpisodeLabel>();

/** Explicit labels only: dates, version numbers and arbitrary path numbers are
 * not episodes. Repeated identical labels are harmless; ranges need a choice. */
function inspect(value:string):EpisodeLabel{
 const text=fold(value),episodes=new Set<number>(),seasons=new Set<number>();let range=false;
 const collect=(pattern:RegExp,read:(m:RegExpMatchArray)=>void)=>{
  for(const match of text.matchAll(pattern)){
   read(match);
   if(/^[\s._]*(?:[-–—]|a|au|et)[\s._]*(?:e(?:p(?:isode)?)?[\s._-]*)?\d/.test(text.slice(match.index!+match[0].length)))range=true;
  }
 };
 collect(/(?<![a-z0-9])s(\d{1,3})[ ._-]*e(\d{1,5})(?![a-z0-9])/g,m=>{seasons.add(+m[1]);episodes.add(+m[2]);});
 collect(/(?<![a-z0-9])(?:episodes?|ep|e|numero|n[°ºo]?)[\s._:#°º-]*(\d{1,5})(?![a-z0-9])/g,m=>episodes.add(+m[1]));
 collect(/(?<![a-z0-9])(?:saisons?|seasons?|s)[\s._:#-]*(\d{1,3})(?![a-z0-9])/g,m=>seasons.add(+m[1]));
 return {episodes:[...episodes],seasons:[...seasons],ambiguous:range||episodes.size>1||seasons.size>1};
}
function expectedLabel(subtitle:string){
 let label=labelCache.get(subtitle);
 if(!label){
  label=inspect(subtitle);
  if(!label.episodes.length&&!label.seasons.length){
   if(/^\s*\d{1,5}\s*$/.test(subtitle))label={...label,episodes:[Number(subtitle)]};
   else if(/\d/.test(subtitle))label={...label,ambiguous:true};
  }
  if(labelCache.size>=600)labelCache.clear();labelCache.set(subtitle,label);
 }
 return label;
}

/** Hints only, never a claim about the recording. Unknown/mismatching numbers
 * remain selectable by the operator; only batch preselection is withheld. */
export function mediaEpisodeHint(file:IndexedMedia,row:Pick<PlannerRow,'title'|'subtitle'>){
 const expected=expectedLabel(row.subtitle);
 if(expected.ambiguous)return {status:'uncertain' as const,manual:true,reason:'Numéro d’épisode de la grille à préciser · choix manuel'};
 if(!expected.episodes.length&&!expected.seasons.length)return {status:'not-specified' as const,manual:false,reason:''};
 let cached=fileCache.get(file);
 if(!cached||cached.path!==file.path||cached.name!==file.name){
  cached={path:file.path,name:file.name,label:inspect(file.path.replace(/\.[^/.]+$/,'')),stem:words(file.name.replace(/\.[^.]+$/,''))};fileCache.set(file,cached);
 }
 let actual=cached.label;
 // Support the common « Programme 010.mp4 » convention, but not numbers from
 // dates, folders or « Programme 010 V2 » without an explicit episode marker.
 const title=words(row.title),suffix=title&&cached.stem.startsWith(title+' ')?cached.stem.slice(title.length+1):'';
 // An unlabelled four-digit year is not reliable episode metadata.
 if(!actual.episodes.length&&/^\d{1,5}$/.test(suffix)&&!(suffix.length===4&&+suffix>=1900&&+suffix<=2199))actual={...actual,episodes:[Number(suffix)]};
 if(actual.ambiguous)return {status:'uncertain' as const,manual:true,reason:'Plusieurs épisodes ou saisons dans le nom · choix manuel'};
 const wantedEpisode=expected.episodes[0],wantedSeason=expected.seasons[0],foundEpisode=actual.episodes[0],foundSeason=actual.seasons[0];
 if(wantedEpisode!==undefined&&foundEpisode!==undefined&&wantedEpisode!==foundEpisode)return {status:'different' as const,manual:true,reason:`Épisode du nom : ${foundEpisode} · attendu : ${wantedEpisode} · à vérifier`};
 if(wantedSeason!==undefined&&foundSeason!==undefined&&wantedSeason!==foundSeason)return {status:'different' as const,manual:true,reason:`Saison du nom : ${foundSeason} · attendue : ${wantedSeason} · épisode à vérifier`};
 if(wantedEpisode!==undefined&&foundEpisode===undefined||wantedSeason!==undefined&&foundSeason===undefined)return {status:'unknown' as const,manual:true,reason:'Épisode ou saison non identifiable dans le nom · choix manuel'};
 return {status:'matching' as const,manual:false,reason:[wantedSeason!==undefined?`Saison ${wantedSeason}`:'',wantedEpisode!==undefined?`Épisode ${wantedEpisode}`:''].filter(Boolean).join(' · ')+' · correspondance du nom'};
}
