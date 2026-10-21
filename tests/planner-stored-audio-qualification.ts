import {broadcastTemplates} from '../src/studio/domain';
import type {ProjectData} from '../src/studio/domain';
import {bindLocalFile,resolveLocalData} from '../src/studio/local-media';
import {prepareGraphic} from '../src/studio/video/engine';
import {audioEvents,mixAudio} from '../src/studio/video/audio';
import type {AudioEvent} from '../src/studio/video/audio';

const file=document.querySelector<HTMLInputElement>('#file')!,button=document.querySelector<HTMLButtonElement>('#run')!;
const status=document.querySelector<HTMLElement>('#status')!,result=document.querySelector<HTMLElement>('#result')!;
const voiceHash='d15f726d4c190f482ce924aa88d94bc9acf33b6bee57085b7640176684783378';
const rawUrl=(v:unknown)=>typeof v==='object'&&v!==null&&'url'in v?String(v.url):String(v||'');
function ensure(v:unknown,message:string):asserts v{if(!v)throw Error(message);}
async function read<T>(path:string):Promise<T>{const response=await fetch(path);ensure(response.ok,`${path}: HTTP ${response.status}`);return response.json();}
function comparison(actual:Float32Array,expected:Float32Array){
  ensure(actual.length===expected.length&&actual.length>100,'Comparaison incomplète.');
  let dot=0,aa=0,bb=0,error=0;
  for(let i=0;i<actual.length;i++){dot+=actual[i]*expected[i];aa+=actual[i]**2;bb+=expected[i]**2;error+=(actual[i]-expected[i])**2;}
  ensure(bb>1e-10,'La référence sonore est silencieuse.');
  return {correlation:dot/Math.sqrt(aa*bb),relativeError:Math.sqrt(error/bb),gain:Math.sqrt(aa/bb)};
}
function voiceMatch(full:AudioBuffer,bed:AudioBuffer,decoded:AudioBuffer,event:AudioEvent){
  const rate=48000,margin=.24,frames=Math.round(Math.min(.7,event.duration-margin*2)*rate);
  const offset=Math.round((event.at+margin)*rate),sourceOffset=Math.round((event.start+margin)*rate);
  const actual=new Float32Array(frames),expected=new Float32Array(frames);
  const a=full.getChannelData(0),b=bed.getChannelData(0),source=decoded.getChannelData(0);
  for(let i=0;i<frames;i++){actual[i]=a[offset+i]-b[offset+i];expected[i]=source[sourceOffset+i]*event.gain((offset+i)/rate);}
  return comparison(actual,expected);
}
file.addEventListener('change',()=>{button.disabled=!file.files?.length;});
button.addEventListener('click',async()=>{
  button.disabled=true;file.disabled=true;const records:unknown[]=[],controller=new AbortController();let decode:AudioContext|undefined;
  const timeout=setTimeout(()=>controller.abort(new DOMException('Recette limitée à 90 secondes.','TimeoutError')),90000);
  try{
    ensure(location.origin==='http://127.0.0.1:5192','Banc local 5192 uniquement.');
    const ids=document.querySelector<HTMLInputElement>('#projects')!.value.split(',').map(id=>id.trim());
    ensure(ids.length===3&&ids.every(id=>/^[a-f0-9-]{36}$/.test(id)),'Trois identifiants de test requis.');
    status.textContent='Vérification du fichier local…';
    const bound=await bindLocalFile(file.files![0],()=>{},undefined,undefined,controller.signal);
    decode=new AudioContext({sampleRate:48000});const formats=new Set<string>();
    for(const [i,id]of ids.entries()){
      status.textContent=`${i+1}/3 · lecture du projet et des pistes enregistrées`;
      const project=await read<{id:string;template_id:string;revision:number;visibility:string;data:ProjectData}>(`/api/graphics/projects/${id}`);
      ensure(project.template_id==='BTV_BA_1P'&&project.visibility==='private','Projet BA privé attendu.');
      const d=project.data,template=broadcastTemplates.find(t=>t.id===project.template_id)!;
      ensure(rawUrl(d._media_body_url)===bound.url,'La vidéo ne correspond pas au projet.');
      ensure(d._audio_bed_enabled===true&&d._audio_voice_enabled===true,'Signature et voix doivent être actives.');
      ensure(d._audio_voice_intro_offset_seconds===2.4&&d._audio_voice_outro_offset_seconds===69,'Le calage manuel n’a pas été conservé.');
      ensure(d._media_body_start_seconds===5&&d._media_body_end_seconds===15,'Extrait vidéo modifié.');
      ensure(d._media_body_audio_enabled===false,'Le média ne doit pas ajouter une piste non choisie.');
      const voiceResponse=await fetch(rawUrl(d._audio_voice_url),{signal:controller.signal});ensure(voiceResponse.ok,'Voix inaccessible.');
      const bytes=await voiceResponse.arrayBuffer(),digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
      ensure(digest===voiceHash,'La voix privée diffère du fichier réel lundi.mp3.');
      const independentVoice=await decode.decodeAudioData(bytes.slice(0));
      const prepared=await prepareGraphic(template,resolveLocalData(template,d),20,false,controller.signal);
      try{
        const events=audioEvents(prepared,template.id,false),voiceBuffer=prepared.graphic.audio.buffers.voice.buffer as AudioBuffer;
        const voices=events.filter(event=>event.buffer===voiceBuffer),beds=events.filter(event=>event.buffer!==voiceBuffer);
        ensure(voices.length===2&&beds.length===2,'Deux voix et deux passages de signature attendus.');
        ensure(Math.abs(voices[0].at-2.4)<1e-6&&Math.abs(voices[1].at-24.2)<1e-6,'Départs de voix incorrects dans le mixage.');
        ensure(voices.every(e=>Math.abs(e.duration-2.56)<1e-6),'La voix est tronquée.');
        const bed=await mixAudio(beds,prepared.timeline.duration,controller.signal,()=>{});
        ensure(bed.audible,'Signature muette.');
        const mixed=await mixAudio(events,prepared.timeline.duration,controller.signal,()=>{});
        ensure(mixed.audible,'Mixage muet.');
        const matches=voices.map(event=>voiceMatch(mixed.buffer,bed.buffer,independentVoice,event));
        ensure(matches.every(m=>m.correlation>.995&&m.relativeError<.02),'La voix n’est pas fidèlement retrouvée dans le mixage complet.');
        const after=await read<typeof project>(`/api/graphics/projects/${id}`);
        ensure(after.revision===project.revision&&JSON.stringify(after.data)===JSON.stringify(d),'Le test a modifié les données du projet.');
        const format=String(d._studio_format);formats.add(format);
        records.push({id,revision:project.revision,format,voiceSha256:digest,voiceSeconds:independentVoice.duration,signature:rawUrl(d._audio_bed_url),signaturePeak:bed.peak,mixedPeak:mixed.peak,duration:prepared.timeline.duration,voiceEvents:voices.map(e=>({at:e.at,start:e.start,duration:e.duration})),matches,status:'PASS'});
      }finally{await prepared.dispose();}
    }
    ensure(['tv','portrait','vertical'].every(format=>formats.has(format)),'Les trois formats n’ont pas été testés.');
    const report={status:'PASS',scope:'Données réelles de trois projets privés du banc local, créés depuis À faire ; mixeur PCM export, comparaison indépendante du fichier vocal. Pas de qualification des mots, de codec vidéo ou du Mac.',records};
    result.textContent=JSON.stringify(report,null,2);
    const saved=await fetch(`/__video-evidence/planner-stored-audio-${Date.now()}.json`,{method:'POST',body:JSON.stringify(report,null,2),headers:{'Content-Type':'application/json'}});ensure(saved.ok,'Rapport local non enregistré.');
    status.textContent='PASS — voix complète, deux calages conservés, signature présente dans les trois formats.';
  }catch(error){result.textContent=JSON.stringify({status:'FAIL',records,error:error instanceof Error?error.message:String(error)},null,2);status.textContent='FAIL — '+(error instanceof Error?error.message:String(error));}
  finally{clearTimeout(timeout);await decode?.close();button.disabled=false;file.disabled=false;}
});
