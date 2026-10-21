import type {DerivationAnnouncement} from './derivation-announcements';
import {normalizeAnnouncement} from './derivation-announcements';
import {announcementCue} from './derivation-announcement-ui';
import type {PreparationProfile,PreparationProfileRevision,VoiceData} from './preparation-profile-model';
import {voiceDataSchema} from './preparation-profile-model';

export type AnnouncementVoiceProfile=PreparationProfile&{kind:'voice';data:VoiceData};
export type AnnouncementVoicePin={id:string;revision:number;cues:string[]};
export type AnnouncementVoicePinResult={id:string;revision:number;profile:AnnouncementVoiceProfile|null;error:string};
export type AnnouncementVoicePinClient={
  get:(id:string,signal?:AbortSignal)=>Promise<PreparationProfile>;
  revision:(id:string,revision:number,signal?:AbortSignal)=>Promise<PreparationProfileRevision>;
};

/** The expected cue belongs to the request identity; changing a weekday must
 * never reuse a response attesting the previous announcement. */
export function announcementVoicePinsKey(value:readonly DerivationAnnouncement[]){
  const pins=new Map<string,AnnouncementVoicePin>();
  for(const item of value){
    if(item.voice.mode!=='profile')continue;
    const {profileId:id,revision}=item.voice,key=`${id}:${revision}`;
    let pin=pins.get(key);if(!pin){pin={id,revision,cues:[]};pins.set(key,pin);}
    const cue=normalizeAnnouncement(announcementCue(item.key,item.day)??'');
    if(!pin.cues.includes(cue))pin.cues.push(cue);
  }
  return JSON.stringify([...pins.values()].map(pin=>({...pin,cues:pin.cues.sort()})).sort((a,b)=>a.id.localeCompare(b.id)||a.revision-b.revision));
}

type VoiceCandidate=Omit<PreparationProfile,'data'>&{data:unknown};
function validatedPin(pin:AnnouncementVoicePin,profile:VoiceCandidate):AnnouncementVoiceProfile{
  if(profile.id!==pin.id||profile.kind!=='voice'||profile.revision!==pin.revision)throw Error('La réponse ne correspond pas à la révision de voix épinglée.');
  if(profile.archived)throw Error('Cette révision de voix est archivée. Le choix reste conservé, mais elle ne peut pas être utilisée.');
  if(!profile.validated_by?.trim()||!profile.validated_at||!Number.isFinite(Date.parse(profile.validated_at)))throw Error('Cette révision de voix ne possède pas d’attestation datée.');
  const parsed=voiceDataSchema.safeParse(profile.data);
  if(!parsed.success)throw Error('Le passage audio ou l’attestation de cette révision est invalide.');
  const data=parsed.data;
  if(data.cue.kind!=='announcement'||pin.cues.some(cue=>!cue||cue!==normalizeAnnouncement(data.cue.value)))throw Error('Le libellé attesté de cette révision ne correspond pas à l’annonce choisie.');
  return {...profile,kind:'voice',data};
}

/** Resolve metadata only, never media bytes. Historical reads also check the
 * current profile: the revision endpoint intentionally retains archived history.
 * The creation transaction remains the final authority if a colleague changes
 * or archives a profile after these reads. */
export async function loadAnnouncementVoicePins(pins:readonly AnnouncementVoicePin[],catalogue:readonly AnnouncementVoiceProfile[],client:AnnouncementVoicePinClient,signal:AbortSignal):Promise<AnnouncementVoicePinResult[]>{
  signal.throwIfAborted();
  return Promise.all(pins.map(async pin=>{
    try{
      let candidate:VoiceCandidate|undefined=catalogue.find(profile=>profile.id===pin.id&&profile.revision===pin.revision);
      if(!candidate){
        const [current,revision]=await Promise.all([client.get(pin.id,signal),client.revision(pin.id,pin.revision,signal)]);
        signal.throwIfAborted();
        if(current.id!==pin.id||current.kind!=='voice'||current.revision<pin.revision)throw Error('La fiche correspondant à cette voix est indisponible.');
        if(current.archived)throw Error('Cette fiche voix est archivée. Le choix reste conservé, mais elle ne peut pas être utilisée.');
        candidate={...current,...revision,id:pin.id,kind:'voice'};
      }
      signal.throwIfAborted();
      return {id:pin.id,revision:pin.revision,profile:validatedPin(pin,candidate),error:''};
    }catch(cause){
      // A loader which ignores AbortSignal must not resurrect old selections.
      signal.throwIfAborted();
      return {id:pin.id,revision:pin.revision,profile:null,error:cause instanceof Error?cause.message:'Révision de voix inaccessible. Réessayez sans changer la voix épinglée.'};
    }
  }));
}
