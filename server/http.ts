export class HttpError extends Error {
  readonly headers: Headers;
  constructor(public status: number, message: string, headers?: HeadersInit) {
    super(message);
    this.headers = new Headers(headers);
  }
}
export const json = (data: unknown, status = 200) => Response.json(data, {
  status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
});
export async function readJson(request: Request | Response, maximum = 128 * 1024): Promise<unknown> {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new HttpError(415, 'Un document JSON est attendu.');
  if (Number(request.headers.get('Content-Length')) > maximum) throw new HttpError(413, 'Document trop volumineux.');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'Document absent.');
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      length += item.value.byteLength;
      if (length > maximum) { await reader.cancel(); throw new HttpError(413, 'Document trop volumineux.'); }
      chunks.push(item.value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(body)); }
  catch { throw new HttpError(400, 'Document JSON invalide.'); }
}
export function checkOrigin(request: Request) {
  if (['GET', 'HEAD'].includes(request.method)) return;
  if (request.headers.get('Origin') !== new URL(request.url).origin ||
      request.headers.get('Sec-Fetch-Site') === 'cross-site') throw new HttpError(403, 'Origine de la demande refusée.');
}
export function secureHeaders(response: Response, template = false) {
  const output = new Response(response.body, response);
  output.headers.set('Cache-Control', 'private, no-store');
  output.headers.set('X-Content-Type-Options', 'nosniff');
  output.headers.set('Referrer-Policy', 'no-referrer');
  output.headers.set('X-Frame-Options', 'SAMEORIGIN');
  output.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  output.headers.set('Content-Security-Policy', [
    "default-src 'self'", `script-src 'self' 'wasm-unsafe-eval'${template ? " 'unsafe-inline'" : ''}`,
    "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: http://127.0.0.1:43871", "font-src 'self' data:",
    "media-src 'self' blob: data: http://127.0.0.1:43871", "connect-src 'self' blob: http://127.0.0.1:43871 https://identitytoolkit.googleapis.com https://securetoken.googleapis.com", "worker-src 'self' blob:",
    "frame-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'",
  ].join('; '));
  return output;
}
