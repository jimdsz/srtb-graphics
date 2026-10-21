import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, copyFile, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Mechanical, reproducible intake. The original broadcast release is read-only.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(root, '../BroadcastTemplates/DELIVERABLES/BTV_HABILLAGE_DYNAMIQUE_v1.7.0');
const destination = path.join(root, 'public/library/v1.7.0');
const input = JSON.parse(await readFile(path.join(source, 'catalogue.json'), 'utf8'));
const excluded = new Set(['BTV_HabDyn_PopUp_RDV']);
const categories = {
  BTV_BA_1P: 'Bandes-annonces', BTV_PopUp: 'À l’antenne',
  BTV_BA_TDS: 'Bandes-annonces', BTV_BA_TDS_SUIVI_DE: 'Bandes-annonces',
  BTV_Ce_Soir: 'Programmation', BTV_Relais_Antenne: 'À l’antenne',
  BTV_Passerelle_Replay: 'Replay',
};
const assets = [], catalogue = [];
async function digest(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}
async function collect(directory, relative = '') {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (item.isSymbolicLink()) throw Error('Symbolic link rejected in library');
    const filename = path.join(directory, item.name);
    const key = [relative, item.name].filter(Boolean).join('/');
    if (item.isDirectory()) { await collect(filename, key); continue; }
    if (!item.isFile()) throw Error(`Unsupported library entry: ${key}`);
    const stat = await lstat(filename);
    const storage = stat.size > 24 * 1024 * 1024 ? 'private-object' : 'protected-asset';
    assets.push({ key, bytes: stat.size, sha256: await digest(filename), storage });
    if (storage === 'protected-asset') {
      const target = path.join(destination, ...key.split('/'));
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(filename, target);
    }
  }
}
for (const item of input.templates) {
  if (excluded.has(item.name)) continue;
  if (!/^BTV_[A-Za-z0-9_]+$/.test(item.name)) throw Error('Invalid template identifier');
  const folder = path.join(source, 'templates', item.name);
  const manifest = JSON.parse(await readFile(path.join(folder, 'manifest.ograf.json'), 'utf8'));
  if (manifest.main !== 'graphic.mjs' || item.version !== manifest.version)
    throw Error(`Source contract mismatch: ${item.name}`);
  const fields = manifest.schema.properties;
  if (Object.keys(fields).length !== item.fieldCount) throw Error(`Field mismatch: ${item.name}`);
  await collect(folder, item.name);
  catalogue.push({
    id: item.name, name: item.label, description: item.name === 'BTV_BA_1P' ? 'Titres sur une à trois lignes, dates de diffusion, extraits vidéo, pistes audio, couleurs de la charte et sortie automatique.' : item.description, version: item.version,
    libraryVersion: input.version, category: categories[item.name],
    module: `/library/v1.7.0/${item.name}/graphic.mjs`,
    preview: `/library/v1.7.0/${item.name}/preview.html`,
    fields, width: 1920, height: 1080, fps: 25,
    legacyOfflineDeclared: manifest.supportsNonRealTime,
    exportQualification: 'pending', siteQualification: 'pending',
  });
}
await mkdir(path.join(root, 'src/studio'), { recursive: true });
await mkdir(path.join(root, 'reports'), { recursive: true });
await writeFile(path.join(root, 'src/studio/catalogue.generated.json'), JSON.stringify(catalogue, null, 2) + '\n');
await writeFile(path.join(root, 'reports/library-intake.json'), JSON.stringify({
  sourceRelease: input.version, excluded: [...excluded], templates: catalogue.map(t => ({
    id: t.id, version: t.version, fields: Object.keys(t.fields).length,
    legacyOfflineDeclared: t.legacyOfflineDeclared,
  })), assets,
}, null, 2) + '\n');
console.log(JSON.stringify({
  templates: catalogue.length, fields: catalogue.reduce((n, t) => n + Object.keys(t.fields).length, 0),
  files: assets.length, protectedBytes: assets.filter(a => a.storage === 'protected-asset').reduce((n,a) => n+a.bytes,0),
  privateObjects: assets.filter(a => a.storage === 'private-object'),
}, null, 2));
