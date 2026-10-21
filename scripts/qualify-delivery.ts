// Generate/extract a package through the real local API. No browser automation and no cloud.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { broadcastTemplates } from '../src/studio/domain';
import { packageDocuments } from '../src/studio/delivery-runtime';
import { writeDeliveryZip } from '../src/studio/delivery-zip';
import type { DeliveryPlan } from '../src/studio/delivery-plan';

const origin = 'http://127.0.0.1:5192';
const page = await fetch(origin + '/api/graphics/projects').then(r => r.json());
const project = page.projects.find((p: { title: string; status: string }) => p.title === 'Recette locale — relais transportable' && p.status === 'approved');
if (!project) throw Error('Créer et valider le relais de qualification depuis l’interface avant ce test.');
const response = await fetch(`${origin}/api/graphics/projects/${project.id}/delivery?revision=${project.revision}`);
if (!response.ok) throw Error('Livraison non autorisée.');
const plan: DeliveryPlan = await response.json();
const template = broadcastTemplates.find(t => t.id === plan.project.templateId)!;
const chunks: Uint8Array[] = [];
let closed = false;
await writeDeliveryZip(plan, packageDocuments(plan, template), {
  write: async chunk => { chunks.push(chunk); }, close: async () => { closed = true; }, abort: async () => { chunks.length = 0; },
}, new AbortController().signal, () => {}, async (url, init) => fetch(new URL(String(url), origin), init));
if (!closed) throw Error('ZIP non finalisé.');
const archive = Buffer.concat(chunks), files = unzipSync(archive);
const manifest = JSON.parse(new TextDecoder().decode(files['INVENTAIRE.json']));
for (const item of manifest.files) if (files[item.path]?.length !== item.bytes || createHash('sha256').update(files[item.path]).digest('hex') !== item.sha256) throw Error('Archive corrompue : ' + item.path);
const root = resolve('.qa-delivery', new Date().toISOString().replaceAll(':', '-'));
const moved = resolve(root, 'autre-poste');
await mkdir(moved, { recursive: true });
await writeFile(resolve(root, plan.filename), archive);
for (const [path, bytes] of Object.entries(files)) {
  const target = resolve(moved, path); if (!target.startsWith(moved + sep)) throw Error('Unsafe extraction');
  await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes);
}
await writeFile(resolve(moved, 'qualification.html'), `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Recette du paquet déplacé</title><style>body{font:16px system-ui;background:#222;color:#fff;margin:24px}iframe{width:min(100%,1280px);aspect-ratio:16/9;border:1px solid #888;display:block;background:#303236}button{padding:12px;margin:8px 6px 8px 0}#status{min-height:2em}</style><h1>Paquet déplacé — hors antenne</h1><p>Copie extraite dans un autre dossier ; aucune connexion à Graphics n’est nécessaire.</p><button data-action="play">IN</button><button data-action="stop">OUT</button><button id="update">UPDATE test</button><button id="bad">UPDATE invalide</button><button data-action="getStatus">Lire l’état</button><p id="status" role="status">Chargement…</p><iframe title="Rendu transportable" src="SRTB-PROJET.html"></iframe><script>const frame=document.querySelector('iframe'),status=document.querySelector('#status');async function run(action){try{const result=await action(frame.contentWindow);status.textContent='OK '+JSON.stringify(result??'');}catch(e){status.textContent='Erreur : '+e.message;}}frame.addEventListener('load',()=>run(w=>w.__srtbReady.then(()=> 'Moteur prêt')));for(const button of document.querySelectorAll('[data-action]'))button.onclick=()=>run(w=>w[button.dataset.action]());document.querySelector('#update').onclick=()=>run(w=>w.update(JSON.stringify({_current_title:'JOURNAL SRTB',_next_title:'RECETTE VALIDÉE',_out_mode:'manual'})).then(()=> 'UPDATE appliqué'));document.querySelector('#bad').onclick=()=>run(w=>w.update('JSON incorrect'));</script></html>`);
console.log(JSON.stringify({ archive: resolve(root, plan.filename), extracted: moved, files: Object.keys(files).length, bytes: archive.length, hashesVerified: manifest.files.length, projectRevision: project.revision }, null, 2));
