import {broadcastTemplates} from '../src/studio/domain';
import {PRESENTATIONS,type Presentation} from '../src/studio/presentation';

/** One catalogue-derived scope for the general UI/render qualification benches.
 * BA simple is a preset of BTV_BA_1P, not an eleventh renderer. */
export const QUALIFICATION_FORMATS=Object.keys(PRESENTATIONS) as Presentation[];
export const SOCIAL_FORMATS=QUALIFICATION_FORMATS.filter(format=>format!=='tv');
export const MODEL_COUNT=broadcastTemplates.length;
export const COMPOSITION_COUNT=MODEL_COUNT*QUALIFICATION_FORMATS.length;
export const SOCIAL_COMPOSITION_COUNT=MODEL_COUNT*SOCIAL_FORMATS.length;
export function catalogueCompositions(formats:readonly Presentation[]=QUALIFICATION_FORMATS){
  return broadcastTemplates.flatMap(template=>formats.map(format=>({template,format})));
}

/** A summary cannot say PASS for a subset, duplicate or unknown composition. */
export function assertCompositionCoverage(records:readonly {id:string;format:string}[],formats:readonly Presentation[]=QUALIFICATION_FORMATS){
  const expected=new Set(catalogueCompositions(formats).map(({template,format})=>template.id+':'+format));
  const actual=records.map(record=>record.id+':'+record.format);
  if(actual.length!==expected.size||new Set(actual).size!==actual.length||actual.some(key=>!expected.has(key)))throw Error(`Couverture incomplète : ${new Set(actual).size}/${expected.size} compositions attendues.`);
}
