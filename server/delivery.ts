import inventory from '../reports/library-intake.json';
import { buildDeliveryPlan } from '../src/studio/delivery-plan';
import { getTemplate } from '../src/studio/domain';
import type { Project } from '../src/studio/domain';
import { sharedMediaReferences } from './media-references';
import { readyMedia } from './ready-media';
import {selectedMediaData} from '../src/studio/media-selection';
export async function deliveryPlan(project:Project,db:D1Database){
  const template=getTemplate(project.template_id),references=sharedMediaReferences(template,project.data);
  const media=await readyMedia(db,references);
  let allowedLibraryUrls:string[]=[];
  if(typeof __SRTB_DERIVATIONS__!=='undefined'&&__SRTB_DERIVATIONS__){
    const {getValidatedProjectOrigin,libraryReferences}=await import('./derivation-origin');
    const ownLibrary=`/library/v${template.libraryVersion}/${template.id}/`;
    const hasForeignLibrary=[...libraryReferences(template.id,template.libraryVersion,selectedMediaData(template,project.data))].some(url=>!url.startsWith(ownLibrary));
    const origin=hasForeignLibrary?await getValidatedProjectOrigin(db,project.id):null;
    allowedLibraryUrls=origin?.allowedLibraryUrls??[];
  }
  return buildDeliveryPlan(project,template,inventory.assets,media,allowedLibraryUrls);
}
