import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import {checkLibraryIntegrity} from './check-library-integrity.mjs';

if(process.argv.length>3||process.argv[2]&&process.argv[2]!=='--native-only')throw Error('Profil de publication inconnu.');
const nativeOnly=process.argv[2]==='--native-only';
// Pages requires a standard config filename. Generate an isolated deployment
// directory, leaving the legacy MVP configuration untouched.
const root = resolve(import.meta.dirname, '..');
// This source file deliberately uses full-line comments only; unsupported JSONC
// constructs fail JSON.parse instead of being rewritten ambiguously.
const source = await readFile(resolve(root, 'wrangler.studio.jsonc'), 'utf8');
const config = JSON.parse(source.split(/\r?\n/).filter(line => !line.trimStart().startsWith('//')).join('\n'));
if (config.name !== 'srtb-graphics') throw Error('Projet Cloudflare non autorisé.');
for (const candidate of [config, config.env?.preview]) {
  if (!candidate || candidate.vars?.AUTH_MODE !== 'firebase' || candidate.vars?.APP_ENV !== 'production' || candidate.vars?.STORAGE_PROVIDER !== 'b2') throw Error('Le mode de sécurité doit être identique en production et en aperçu.');
  if (candidate.vars.B2_APPLICATION_KEY || candidate.vars.B2_KEY_ID) throw Error('Les secrets doivent rester dans Cloudflare.');
  if (!candidate.d1_databases?.[0]?.database_id || candidate.d1_databases[0].database_id.startsWith('00000000')) throw Error('Base D1 non configurée.');
}
if (config.d1_databases[0].database_id === config.env.preview.d1_databases[0].database_id) throw Error('La base d’aperçu doit être isolée.');
const build = resolve(root, nativeOnly?'dist-studio-native':'dist-studio');
await checkLibraryIntegrity(resolve(build,'library/v1.7.0'));
const routes = JSON.parse(await readFile(resolve(build, '_routes.json'), 'utf8'));
if (routes.version !== 1 || JSON.stringify(routes.include) !== '["/*"]' || routes.exclude?.length !== 0) throw Error('Toutes les routes doivent traverser le contrôle d’accès.');
const worker = await readFile(resolve(build, '_worker.js'), 'utf8');
if (!worker.includes('Public fallback is forbidden.') || !worker.includes('authenticateSession')) throw Error('Worker privé absent ou incorrect.');
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await inspect(path);
    else {
      if (entry.isSymbolicLink() || /(^\.env|\.dev\.vars|\.map$)/.test(entry.name)) throw Error('Fichier interdit dans le paquet.');
      if ((await stat(path)).size > 25 * 1024 ** 2) throw Error('Média trop volumineux pour Pages : utiliser le stockage privé.');
    }
  }
}
await inspect(build);
config.pages_build_output_dir = nativeOnly?'../dist-studio-native':'../dist-studio';
for (const candidate of [config, config.env.preview]) for (const db of candidate.d1_databases) db.migrations_dir = '../migrations';
const target = resolve(root, nativeOnly?'.pages-studio-native':'.pages-studio');
await mkdir(target, { recursive: true });
await writeFile(resolve(target, 'wrangler.jsonc'), JSON.stringify(config, null, 2) + '\n');
console.log('Paquet privé préparé et contrôlé. Cette commande ne déploie rien et ne remplace pas la recette utilisateur.');
