import http from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const candidate = path.join(root, 'candidates/renvoi-2026-09-23');
const manifest = JSON.parse(await readFile(path.join(candidate, 'manifest.candidate.json'), 'utf8'));
const references = new Map(manifest.references.map(ref => [ref.url, path.resolve(root, ref.source)]));
const referenceRoot = path.resolve(root, '../BroadcastTemplates/WORK/_NEW_TEMPLATES_20260923/renvoi') + path.sep;
if ([...references.values()].some(file => !file.startsWith(referenceRoot))) throw Error('Reference target outside scope');
const port = Number(process.env.RENVOI_PORT || 5217), origin = `http://127.0.0.1:${port}`;
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid loopback port');
const types = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.otf': 'font/otf' };
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  try {
    if (req.headers.host !== `127.0.0.1:${port}`) { res.writeHead(403).end(); return; }
    const pathname = decodeURIComponent(new URL(req.url, origin).pathname);
    if (req.method === 'POST' && pathname === '/report') {
      if (req.headers.origin !== origin || req.headers['content-type'] !== 'application/json') { res.writeHead(403).end(); return; }
      let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 2_000_000) throw Error('Report too large'); }
      const report = JSON.parse(body);
      if (report.schema !== 'renvoi-reference-comparison-v1' || !Array.isArray(report.results) || report.results.length !== 14) throw Error('Invalid comparison report');
      const directory = path.join(root, 'reports/renvoi-candidate'); await mkdir(directory, { recursive: true });
      const file = `comparison-${new Date().toISOString().replaceAll(':', '-')}.json`;
      await writeFile(path.join(directory, file), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ file: `reports/renvoi-candidate/${file}` })); return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
    const reference = references.get(pathname);
    const relative = pathname === '/' ? 'bench.html' : pathname.slice(1);
    const file = reference || path.resolve(candidate, relative);
    if (!reference && (!file.startsWith(candidate + path.sep) || relative.startsWith('provenance/'))) { res.writeHead(404).end(); return; }
    if (!(await stat(file)).isFile()) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', types[path.extname(file)] || (path.basename(file).startsWith('img_') ? 'image/png' : 'application/octet-stream'));
    res.end(req.method === 'HEAD' ? undefined : await readFile(file));
  } catch (error) { res.writeHead(error.code === 'ENOENT' ? 404 : 400); res.end(error.code === 'ENOENT' ? 'Not found' : error.message); }
});
server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ url: origin, pid: process.pid, candidate, referenceCount: references.size, mediaUploads: false })));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
