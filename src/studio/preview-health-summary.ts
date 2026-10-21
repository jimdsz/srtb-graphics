/** A responsive UI clock is not evidence that video frames are advancing. */
export function previewHealthMessage({longGaps,frames,dropped,buffering,activeVideoSamples,copyStalled=false}:{longGaps:number;frames:number;dropped:number;buffering:number;activeVideoSamples:number;copyStalled?:boolean}){
  if(copyStalled)return 'La vidéo avance, mais sa copie dans l’aperçu n’a pas progressé pendant au moins deux secondes. Copiez le bilan pour identifier le blocage.';
  if(longGaps>3||frames>0&&dropped/frames>.03||buffering>2)return 'Des ralentissements ont été mesurés sur ce poste. Copiez le bilan pour le diagnostic.';
  if(activeVideoSamples>0&&frames===0)return 'L’interface répond, mais aucune progression des images vidéo n’a pu être confirmée. La fluidité vidéo n’est pas validée ; copiez le bilan si l’image reste figée.';
  if(activeVideoSamples===0)return 'L’interface a été mesurée, mais aucune vidéo en lecture n’a été observée. Ce bilan ne valide pas la fluidité des médias.';
  return 'Pas de ralentissement important détecté pendant ce passage. Ce résultat ne garantit pas les autres passages.';
}
