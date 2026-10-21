import {copyFile,lstat,mkdir,readdir,readFile} from 'node:fs/promises';
import {resolve,relative,sep} from 'node:path';
import {createHash} from 'node:crypto';

const trees=['commercial-assets','fonts','library','preview-media','social','studio-engines','templates','thumbnails'];
const files=['assets/srtb-theme-init.js','favicon.svg',
  'licenses/mediabunny-prores-1.58.1-source.tar.gz',
  'licenses/prores-wasm-encoder-0.3.1-source.tar.gz',
  'licenses/turbores-1.2.2-source.tar.gz'];

// Explicit allowlist. In particular, neither public/ffmpeg nor arbitrary new
// public assets/licenses nor the contaminated old module cache are copied.
export async function copyNativePublicAssets(root){
  const source=resolve(root,'public'),target=resolve(root,'dist-studio-native');let count=0;
  async function copy(path){
    const from=resolve(source,path),to=resolve(target,path);
    if(!from.startsWith(source+sep)||!to.startsWith(target+sep))throw Error('Chemin de ressource natif invalide.');
    const info=await lstat(from);if(info.isSymbolicLink())throw Error('Lien de ressource refusé : '+path);
    if(info.isDirectory()){
      await mkdir(to,{recursive:true});
      for(const name of await readdir(from))await copy(relative(source,resolve(from,name)));
    }else if(info.isFile()){
      if(info.size>25*1024**2||/(^|[/\\])(?:\.env|\.dev\.vars)|\.map$/i.test(path))throw Error('Ressource native interdite : '+path);
      await mkdir(resolve(to,'..'),{recursive:true});await copyFile(from,to);count++;
    }else throw Error('Type de ressource refusé : '+path);
  }
  for(const path of [...trees,...files])await copy(path);
  // An immutable internal pilot, still served through the authenticated Worker.
  // Never copy arbitrary .qa-delivery files or advertise an unverified package.
  const release=JSON.parse(await readFile(resolve(root,'connector/windows/release.json'),'utf8'));
  if(release.status!=='internal-pilot-unsigned'||!/^graphics-connector-windows-x64-[a-f\d]{8}\.exe$/.test(release.file)||!/^[a-f\d]{64}$/.test(release.sha256))throw Error('Manifeste du connecteur invalide.');
  const installer=resolve(source,'downloads',release.file),info=await lstat(installer);
  if(!info.isFile()||info.isSymbolicLink()||info.size!==release.bytes||info.size>25*1024**2)throw Error('Paquet du connecteur invalide.');
  if(createHash('sha256').update(await readFile(installer)).digest('hex')!==release.sha256)throw Error('Le connecteur diffère du paquet qualifié.');
  await copy('downloads/'+release.file);
  return count;
}
