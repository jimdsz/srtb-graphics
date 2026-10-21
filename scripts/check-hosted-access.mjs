import assert from 'node:assert/strict';

const base = new URL(process.argv[2] || 'https://qualification.srtb-graphics.pages.dev');
if (base.protocol !== 'https:' || !/(^|\.)srtb-graphics\.pages\.dev$/.test(base.hostname)) throw Error('Cible de recette SRTB non autorisée.');
const controller = () => AbortSignal.timeout(20000);
let frontendModule = '';
for (const path of ['/', '/graphics', '/api/auth/config']) {
  const response = await fetch(new URL(path, base), { redirect: 'error', signal: controller() });
  assert.equal(response.status, 200, `${path}: coque de connexion indisponible`);
  assert.match(response.headers.get('cache-control') || '', /no-store/);
  if (path === '/api/auth/config') {
    const data = await response.json();
    assert.equal(data.enabled, true);
    assert.equal(data.projectId, 'srtb-graphics');
  } else {
    const html = await response.text();
    assert.match(html, /data-theme="dark"/);
    assert.match(html, /srtb-theme-init\.js/);
    assert.ok(!html.includes('B2_APPLICATION_KEY'));
    const module = html.match(/(?:src|href)=["'](\/assets\/studio-[A-Za-z0-9_-]+\.js)["']/)?.[1];
    if (module) {
      if (frontendModule) assert.equal(module, frontendModule, 'Les routes publiques doivent charger le même frontend.');
      frontendModule = module;
    }
  }
  console.log(`PASS public login shell: ${path}`);
}
// Frontend code is public (including the login shell); project data and media are not.
assert.match(frontendModule,/^\/assets\/studio-[A-Za-z0-9_-]+\.js$/,'Bundle frontend versionné introuvable dans la coque.');
const retained=await fetch(new URL(frontendModule,base),{signal:controller()});
assert.equal(retained.status,200);assert.match(retained.headers.get('content-type')||'',/javascript/);await retained.body?.cancel();
console.log(`PASS current frontend module available for open sessions: ${frontendModule}`);
const privatePaths = [
  '/preview-media/v2/BTV_BA_TDS.zip', '/preview-media/v2/BTV_BA_TDS_SUIVI_DE.zip',
  '/preview-media/v1/ba-programme.mp4', '/preview-media/v1/BTV_BA_TDS.zip', '/preview-media/v1/BTV_BA_TDS_SUIVI_DE.zip',
  '/preview-media/v3/ba-prepared-slow-1280.mp4',
  '/social/v1/btv-logo.svg', '/social/v1/ba-sponsors.svg',
  '/api/me', '/api/graphics/projects', '/api/graphics/media', '/api/graphics/media/transfers',
  '/library/v1.7.0/BTV_BA_1P/graphic.mjs',
  '/library/v1.7.0/BTV_BA_1P/lib/media/programme.mp4',
  '/library/v1.7.0/BTV_BA_1P/sourceassets/VOIX%20OFF%20BA.wav',
  '/library/v1.7.0/BTV_BA_TDS/lib/audio/VOIX%20OFF%20BA.wav',
  '/library/v1.7.0/BTV_Renvoi/graphic.mjs',
  '/library/v1.7.0/BTV_Evenement/graphic.mjs',
  '/library/v1.7.0/BTV_Semainier/graphic.mjs',
];
for (const path of privatePaths) {
  const response = await fetch(new URL(path, base), { redirect: 'error', headers: { Range: 'bytes=0-15' }, signal: controller() });
  assert.equal(response.status, 401, `${path}: accès anonyme doit être refusé`);
  assert.match(response.headers.get('content-type') || '', /application\/json/);
  assert.match(response.headers.get('cache-control') || '', /no-store/);
  await response.body?.cancel();
  console.log(`PASS private without session: ${path}`);
}
const invalid = await fetch(new URL('/api/auth/session', base), { method: 'POST', headers: { Origin: base.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: 'not-a-valid-token'.repeat(8) }), signal: controller() });
assert.equal(invalid.status, 401);
console.log('PASS invalid Firebase token rejected');
const anonymousExport=await fetch(new URL('/api/graphics/projects/00000000-0000-4000-8000-000000000001/export',base),{method:'POST',headers:{Origin:base.origin,'Content-Type':'application/json'},body:'{}',signal:controller()});
assert.equal(anonymousExport.status,401);console.log('PASS direct export refused without a session');
console.log('Anonymous-access checks passed. Signed-in workflows and exports are NOT covered.');
