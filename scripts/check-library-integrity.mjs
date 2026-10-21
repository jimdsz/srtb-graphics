import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,sep} from 'node:path';

// Verify the assets actually shipped, not merely the stored manifest against itself.
export async function checkLibraryIntegrity(directory='public/library/v1.7.0'){
  const inventory=JSON.parse(await readFile(new URL('../reports/library-intake.json',import.meta.url),'utf8'));
  const root=resolve(directory),errors=[];let checked=0;
  for(const asset of inventory.assets){
    if(asset.storage!=='protected-asset')continue;
    const file=resolve(root,asset.key);
    if(!file.startsWith(root+sep))throw Error('Chemin de bibliothèque invalide.');
    try{
      const bytes=await readFile(file);
      if(bytes.length!==asset.bytes||createHash('sha256').update(bytes).digest('hex')!==asset.sha256)errors.push(asset.key);
      checked++;
    }catch{errors.push(asset.key);}
  }
  if(errors.length)throw Error(`Inventaire de livraison périmé ou fichier manquant : ${errors.join(', ')}. Publication interrompue.`);
  console.log(`Library integrity: ${checked} published resources match their delivery hashes.`);
  return checked;
}
