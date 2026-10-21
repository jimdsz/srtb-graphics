import type {ProfileAsset} from './preparation-profile-model';

export type VoiceRangeState={source:ProfileAsset|null;start:number;end:number;revision:number;status:'unselected'|'manual'|'measuring'|'whole'|'error';message:string};
type Measure=(source:ProfileAsset,controller:AbortController)=>Promise<number>;
export const voiceRangeReady=(state:VoiceRangeState)=>!!state.source&&(state.status==='manual'||state.status==='whole')&&Number.isFinite(state.start)&&Number.isFinite(state.end)&&state.start>=0&&state.end>state.start;

/** One editor owns the user's range intent, independently of file-hash renders.
 * A pending/failed whole-file request never silently falls back to old marks. */
export function createVoiceRangeDraft(initial?:{source:ProfileAsset;start:number;end:number}){
  let state:VoiceRangeState={source:initial?.source??null,start:initial?.start??0,end:initial?.end??0,revision:0,status:initial?'manual':'unselected',message:''};
  let active:AbortController|null=null;
  const listeners=new Set<()=>void>();
  function update(change:Partial<VoiceRangeState>){state={...state,...change,revision:state.revision+1};for(const listener of listeners)listener();}
  function abort(){const previous=active;active=null;previous?.abort();}
  return {
    snapshot:()=>state,
    subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};},
    select(source:ProfileAsset|null){
      if(source?.url===state.source?.url)return;
      abort();update({source,start:0,end:0,status:'unselected',message:'Choisissez le fichier entier ou renseignez explicitement les repères du passage.'});
    },
    manual(key:'start'|'end',value:number){
      // Inputs are disabled while measuring; also reject stale queued events.
      if(active)return;
      update({[key]:value,status:'manual',message:'Repères manuels : écoutez tout le passage avant de confirmer son contenu.'});
    },
    async measure(measure:Measure){
      if(active||!state.source)return;
      const source=state.source,task=new AbortController();active=task;
      update({status:'measuring',message:'Décodage local du fichier… Écoute et confirmation suspendues jusqu’au résultat.'});
      try{
        const duration=await measure(source,task);
        if(active!==task)return;
        task.signal.throwIfAborted();
        if(!Number.isFinite(duration)||duration<=0)throw Error('La durée décodée est invalide. Réessayez ou renseignez les repères manuellement.');
        active=null;
        update({start:0,end:duration,status:'whole',message:`Fichier entier : ${duration.toFixed(6)} s décodées. Réécoutez le passage pour confirmer son contenu.`});
      }catch(cause){
        if(active!==task)return;
        active=null;
        update({status:'error',message:task.signal.aborted?'Mesure interrompue. Réessayez lorsque l’accès est rétabli, ou renseignez explicitement les repères.':cause instanceof Error?cause.message:String(cause)});
      }
    },
    cancel(){
      if(!active)return;
      abort();update({status:'error',message:'Mesure interrompue. Réessayez ou renseignez explicitement les repères. Aucun passage précédent n’a été validé.'});
    },
  };
}
