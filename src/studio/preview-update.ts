import type {BroadcastTemplate} from './domain';
import type {PreviewTransport} from './preview-transport';

/** BA v2 swaps a fully prepared scene at the frozen frame. Clearing or seeking
 * first would hide that scene while files decode. Other engines keep their
 * existing idle/clear contract; do not generalize BA's atomic update promise. */
export async function updatePreviewAtPosition(template:Pick<BroadcastTemplate,'id'|'version'|'libraryVersion'>,controls:PreviewTransport|null,update:()=>Promise<void>,assertAllowed:()=>void){
  const saved=controls?.snapshot(),atomicBA=template.id==='BTV_BA_1P'&&template.version==='1.0.3'&&template.libraryVersion==='1.7.0';
  assertAllowed();
  if(atomicBA)await controls?.pause();else await controls?.clear();
  try{assertAllowed();await update();assertAllowed();}
  catch(error){
    // Legacy validation can reject after Clear. Restore the accepted position
    // silently; never resume a rejected edit. A broken scene still propagates
    // the original error and the owning preview retains its frozen picture.
    if(!atomicBA&&saved&&saved.phase!=='ready'&&saved.phase!=='stopped'){
      try{assertAllowed();await controls?.seek(saved.seconds,saved.outAt!==undefined&&saved.seconds>=saved.outAt?saved.outAt:undefined);assertAllowed();}catch{/* Recovery remains available in the editor. */}
    }
    throw error;
  }
  if(saved&&saved.phase!=='ready'&&saved.phase!=='stopped'){
    if(!atomicBA){await controls?.seek(saved.seconds,saved.outAt!==undefined&&saved.seconds>=saved.outAt?saved.outAt:undefined);assertAllowed();}
    if(saved.playing){await controls?.resume();assertAllowed();}
  }
}
