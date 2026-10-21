// Local-only smoke bench for the actual production bundle, with authentication fail-closed.
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
const root = resolve('dist-studio');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.otf': 'font/otf', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };
const bench = new Miniflare(convertV4MiniflareOptions({
  scriptPath: resolve(root, '_worker.js'), modules: true, compatibilityDate: '2026-09-21', compatibilityFlags: ['nodejs_compat'],
  host: '127.0.0.1', port: 5194, d1Databases: ['DB'],
  bindings: { AUTH_MODE: 'firebase', FIREBASE_PROJECT_ID: 'NOT_CONFIGURED', FIREBASE_API_KEY: 'NOT_CONFIGURED', APP_ENV: 'production', STORAGE_PROVIDER: 'b2' },
  serviceBindings: { ASSETS: async request => {
    const pathname = decodeURIComponent(new URL(request.url).pathname), target = resolve(root, ['/', '/graphics', '/login', '/signatures'].includes(pathname) ? 'index.html' : pathname.slice(1));
    if (!target.startsWith(root + sep) || target.endsWith('_worker.js')) return new Response('Not found', { status: 404 });
    try { if (!(await stat(target)).isFile()) throw Error(); return new Response(request.method === 'HEAD' ? null : await readFile(target), { headers: { 'Content-Type': mime[extname(target)] || 'application/octet-stream' } }); }
    catch { return new Response('Not found', { status: 404 }); }
  } },
}));
await bench.ready;
for (const [path, expected] of [['/', 200], ['/api/auth/config', 200], ['/library/v1.7.0/BTV_Relais_Antenne/graphic.mjs', 503], ['/api/graphics/projects', 503]]) {
  const response = await bench.dispatchFetch('https://studio.example' + path);
  if (response.status !== expected) throw Error(`Unexpected status ${response.status} for ${path}`);
  await response.body?.cancel();
}
console.log('Production bundle smoke checks passed; private routes closed. Login preview: http://127.0.0.1:5194/');
process.on('SIGINT', () => { void bench.dispose().then(() => process.exit(0)); });
