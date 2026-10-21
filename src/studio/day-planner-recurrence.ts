import {normalized} from './day-planner-model';

export type RecurringProgramme={kind:'news'|'weather';label:string;reason:string};

const marker='(?:en direct|direct|live|rediffusion|rediff|redif)';
const leadingMarker=new RegExp(`^${marker}(?: |$)`),trailingMarker=new RegExp(`(?:^| )${marker}$`);
const continuity=/^(?:page pub(?:licitaire)?|pub(?:licite)?|meteo|bandes? annonces?|jingle)$/;
const hour='(?:[01]?\\d|2[0-3])(?:h(?:[0-5]\\d)?| h(?: [0-5]\\d)?| heures?(?: [0-5]\\d)?)';
const edition=`(?:(?:edition )?(?:(?:de|du|de la) )?(?:${hour}|matin|midi|soir|mi journee))`;
const news=new RegExp(`^(?:le )?(?:jt|j t|journal(?: televise)?|bulletin(?: d informations?)?)(?: ${edition})?(?: en (?:francais|langues? nationales?))?$`);
const weather=new RegExp(`^(?:la )?(?:meteo|bulletin (?:meteo|meteorologique)|previsions? (?:meteo|meteorologiques?))(?: ${edition})?$`);

/** Deliberately narrow service aliases, not a fuzzy title search. A live event
 * is not recurring merely because the conductor labels it DIRECT or LIVE. */
export function recurringProgramme(raw:string):RecurringProgramme|null{
  const segments=raw.trim().split(/\s+\+\s+/);
  let title=normalized([segments[0],...segments.slice(1).filter(part=>!continuity.test(normalized(part)))].join(' + '));
  // Strip only whole boundary markers. Keep the complete title otherwise so a
  // documentary such as "Journal de voyage" cannot become a daily newscast.
  let previous='';
  while(previous!==title){previous=title;title=title.replace(leadingMarker,'').replace(trailingMarker,'').trim();}
  if(news.test(title))return {kind:'news',label:'Journal récurrent',reason:'Journal ou bulletin récurrent : vérifier les habillages existants à réutiliser. Aucun nouvel habillage proposé par défaut ; choisissez les types à créer si nécessaire.'};
  if(weather.test(title))return {kind:'weather',label:'Météo récurrente',reason:'Météo récurrente : vérifier les habillages existants à réutiliser. Aucun nouvel habillage proposé par défaut ; choisissez les types à créer si nécessaire.'};
  return null;
}
