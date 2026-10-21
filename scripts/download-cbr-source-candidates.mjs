// Download source data only. Nothing is built, executed, installed, or published.
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

const root = join(import.meta.dirname, '..');
const inventory = JSON.parse(await readFile(join(root, 'reports/encoder-source-audit/upstream-refs-2026-09-23.json'), 'utf8'));
if (inventory.status !== 'candidate-source-inventory-not-build-attestation') throw Error('Unexpected source inventory');
const target = join(root, '.tools', 'cbr-source-candidates');
await mkdir(target, {recursive: true});
const results = [];
for (const component of inventory.components) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(component.repository) || !/^[0-9a-f]{40}$/.test(component.sha)) throw Error('Invalid source reference');
  const archive = `https://codeload.github.com/${component.repository}/tar.gz/${component.sha}`;
  const file = `${component.repository.replace('/', '--')}-${component.sha}.tar.gz`;
  const response = await fetch(archive, {signal: AbortSignal.timeout(60_000)});
  if (!response.ok || !response.body) throw Error(`${component.name}: HTTP ${response.status}`);
  const chunks = []; let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > 64 * 1024 ** 2) throw Error(`${component.name}: archive exceeds audit limit`);
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  if (buffer[0] !== 0x1f || buffer[1] !== 0x8b) throw Error(`${component.name}: not a gzip archive`);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  await writeFile(join(target, file), buffer);
  results.push({...component, archive, file, bytes, sha256});
  console.log(`${component.name}: ${bytes} bytes, SHA256 ${sha256}`);
}
await writeFile(join(target, 'inventory.json'), JSON.stringify({
  status: 'source-candidates-not-approved-for-release', downloadedAt: new Date().toISOString(),
  note: 'Archives not extracted or executed. Includes upstream repository content; recursive git submodules are not in GitHub archives and must be audited separately. No application or user files included. Release barrier unchanged.',
  components: results,
}, null, 2) + '\n');
