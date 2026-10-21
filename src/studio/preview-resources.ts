import type {BroadcastTemplate,ProjectData,FieldValue} from './domain';
import type {LegacyGraphic} from './video/engine';
import {rebindSequenceCrops} from './sequence-crop';

const resources=new Map<string,Promise<unknown>>();
if(typeof window!=='undefined')window.addEventListener('srtb-local-media-clear',()=>resources.clear());
function json(url:string){
  let pending=resources.get(url);
  if(!pending){pending=fetch(url,{signal:AbortSignal.timeout(30000)}).then(r=>{if(!r.ok)throw Error(`Ressource graphique indisponible (${r.status}).`);return r.json();});resources.set(url,pending);void pending.catch(()=>{if(resources.get(url)===pending)resources.delete(url);});}
  return pending;
}
/** Immutable engine resources only, per browser session. No user media/cache on a server. */
export function installBALoader(g:LegacyGraphic,t:BroadcastTemplate,stage:(label:string)=>void){
  if(t.id!=='BTV_BA_1P'||t.version!=='1.0.3'||t.libraryVersion!=='1.7.0')return;
  g.load=(params:any={})=>g._queue(async()=>{
    if(g.state.loaded)return {statusCode:200};
    g.muted=!!params.previewMuted;stage('Chargement des graphismes et des polices');
    const base=new URL(t.module,location.href);
    const [values]=await Promise.all([
      Promise.all(['lottie-template','native-time','benin-outlines','suisse-glyphs'].map(name=>json(new URL('lib/'+name+'.json',base).href))),
      Promise.all([['Benin Semi Bold','BeninSemiBold-Regular.otf'],['SuisseIntl','SuisseIntl.otf']].map(async([family,file])=>{
        const key='font:'+family+new URL('lib/fonts/'+file,base).href;
        if(!resources.has(key)){
          const pending=new FontFace(family,`url("${new URL('lib/fonts/'+file,base)}")`).load().then(face=>{document.fonts.add(face);return face;});
          resources.set(key,pending);void pending.catch(()=>resources.delete(key));
        }
        await resources.get(key);
      })),
    ]);
    g._abort.signal.throwIfAborted();
    [g.original,g.sourceTime,g.fontData,g.suisseGlyphs]=structuredClone(values);
    stage('Ouverture des médias et préparation de la première image');
    await g._update(params.data||{},true);g.state.loaded=true;g.state.phase='ready';g.state.playStatus='loaded';g.scene.container.style.visibility='hidden';return {statusCode:200};
  });
}
const previewCopies=new Map([
  ['/library/v1.7.0/BTV_BA_1P/lib/media/programme.mp4','/preview-media/v1/ba-programme.mp4'],
  ['/library/v1.7.0/BTV_BA_1P/lib/media/prepared/native-v102/slow-25b341c2aeb35dc28530.mp4','/preview-media/v3/ba-prepared-slow-1280.mp4'],
]);
/** Only already shared demonstration movies have lightweight preview copies.
 * The prepared slow-motion copy retains all 161 original 25 fps timestamps.
 * Saved data, local files, shared user media and exports keep their original source. */
export function previewSources(template:BroadcastTemplate,data:ProjectData):ProjectData{
  const replace=(value:FieldValue):FieldValue=>{
    if(typeof value!=='string'&&(typeof value!=='object'||value===null))return value;
    const raw=typeof value==='string'?value:value.url;
    if(!raw)return value;
    const url=new URL(raw,new URL(template.module,location.href));
    const source=url.origin===location.origin?previewCopies.get(url.pathname):undefined;
    if(!source)return value;
    return typeof value==='string'?source:{...value,url:source};
  };
  const next={...data};
  for(const [key,value]of Object.entries(data)){
    if(key.startsWith('_media_')&&key.endsWith('_url'))next[key]=replace(value);
    else if(key.startsWith('_media_')&&key.endsWith('_sequence')){
      const before=JSON.parse(String(value||'[]')) as {url:FieldValue;start:number;end:number}[],after=before.map(clip=>({...clip,url:replace(clip.url)}));
      Object.assign(next,rebindSequenceCrops(data,key.slice(7,-9),before,after));next[key]=JSON.stringify(after);
    }
  }return next;
}
