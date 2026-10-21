import type {ProjectData} from './domain';
import {textStyles} from './typography-model';
type StoredFont={id:string;name:string;file:Blob};
const memory=new Map<string,StoredFont>(),loaded=new Map<string,Promise<string>>();
async function storage(mode:IDBTransactionMode,fn:(store:IDBObjectStore)=>IDBRequest){return new Promise<unknown>((resolve,reject)=>{const req=indexedDB.open('srtb-local-fonts',1);req.onupgradeneeded=()=>req.result.createObjectStore('fonts');req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result,tx=db.transaction('fonts',mode),item=fn(tx.objectStore('fonts'));let result:unknown;item.onsuccess=()=>{result=item.result;};tx.oncomplete=()=>{db.close();resolve(result);};tx.onerror=()=>{db.close();reject(tx.error);};};});}
export const fontFamily=(id:string,regular=false)=>id.startsWith('local-font:')?'SRTB Local '+id.slice(11):id==='suisse'||id==='original'&&regular?'SRTB Editor Suisse':'SRTB Editor Benin';
export async function localFonts(){const fonts=await storage('readonly',s=>s.getAll()) as StoredFont[];return fonts.map(({id,name})=>({id,name})).sort((a,b)=>a.name.localeCompare(b.name,'fr'));}
export async function fontData(id:string){let font=memory.get(id);if(!font){font=await storage('readonly',s=>s.get(id)) as StoredFont|undefined;if(font)memory.set(id,font);}if(!font)throw Error('Police locale absente sur ce poste. Importez à nouveau le même fichier dans Textes → Police. Aucun fichier n’a été envoyé.');return font;}
export async function importLocalFont(file:File){
  if(!/\.(otf|ttf|woff2?)$/i.test(file.name)||file.size<12||file.size>12*1024**2)throw Error('Choisissez une police OTF, TTF, WOFF ou WOFF2 de 12 Mo maximum.');
  const buffer=await file.arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),b=>b.toString(16).padStart(2,'0')).join(''),id='local-font:'+hash;
  let face:FontFace;try{face=await new FontFace(fontFamily(id),buffer).load();}catch{throw Error('Ce fichier de police est illisible. Choisissez un autre fichier OTF, TTF, WOFF ou WOFF2.');}document.fonts.add(face);
  const font={id,name:file.name.slice(0,200).replace(/[<>\x00-\x1f]/g,''),file};await storage('readwrite',s=>s.put(font,id));memory.set(id,font);return font;
}
export function blobData(blob:Blob):Promise<string>{return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});}
export async function prepareTextFonts(data:ProjectData,module:string){
  const selected=Object.entries(textStyles(data)).filter(([key])=>key.startsWith(String(data._studio_format||'tv')+':'));const ids=new Set(selected.map(([,s])=>s.font||'original'));if(!selected.length)return '';
  ids.add('benin');ids.add('suisse');ids.delete('original');
  return (await Promise.all([...ids].map(async id=>{
    const key=id.startsWith('local-font:')?id:new URL('lib/fonts/'+(id==='suisse'?'SuisseIntl.otf':'BeninSemiBold-Regular.otf'),new URL(module,location.href)).href;
    if(!loaded.has(key))loaded.set(key,(async()=>{
      const file=id.startsWith('local-font:')?(await fontData(id)).file:await fetch(key,{credentials:'same-origin'}).then(r=>{if(!r.ok)throw Error('Police du modèle indisponible.');return r.blob();});
      const face=new FontFace(fontFamily(id),await file.arrayBuffer());await face.load();document.fonts.add(face);
      return `@font-face{font-family:"${fontFamily(id)}";src:url("${await blobData(file)}");font-weight:400;font-style:normal}`;
    })().catch(e=>{loaded.delete(key);throw e;}));return loaded.get(key)!;
  }))).join('\n');
}
/** Explicit HTML export embeds fonts. Saving a shared project stores references only. */
export async function portableFonts(data:ProjectData){const result:Record<string,string>={};for(const style of Object.values(textStyles(data)))if(style.font?.startsWith('local-font:')&&!result[style.font])result[style.font]=await blobData((await fontData(style.font)).file);return result;}
export async function installPortableFonts(fonts:Record<string,string>){for(const [id,url]of Object.entries(fonts)){if(!/^local-font:[a-f0-9]{64}$/.test(id)||!/^data:[^,]*;base64,/.test(url)||url.length>17*1024**2)throw Error('Police du paquet invalide.');
  // Decode the embedded bytes directly: fetch(data:) is rightly excluded by the
  // studio's connect-src policy and no network permission is needed for a font.
  const bytes=Uint8Array.from(atob(url.slice(url.indexOf(',')+1)),char=>char.charCodeAt(0)),file=new Blob([bytes]),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(id!=='local-font:'+hash)throw Error('La police du paquet ne correspond pas au fichier choisi.');memory.set(id,{id,name:id,file});}}
