import { env } from 'cloudflare:workers';
import { expect, it, vi } from 'vitest';
import worker from '../../server/pages-worker';

const config = { ...env, AUTH_MODE: 'firebase', FIREBASE_PROJECT_ID: 'srtb-test-auth', FIREBASE_API_KEY: 'AIza' + 'x'.repeat(35) };
const context = { waitUntil: vi.fn() } as unknown as ExecutionContext;
it('serves the login shell but never static templates or APIs without a session', async () => {
  const assetFetch = vi.fn(async () => new Response('shell'));
  const bindings = { ...config, ASSETS: { fetch: assetFetch } as unknown as Fetcher };
  const shell = await worker.fetch(new Request('https://studio.example/graphics'), bindings, context);
  expect(shell.status).toBe(200); expect(await shell.text()).toBe('shell'); expect(assetFetch).toHaveBeenCalledTimes(1);
  for (const path of ['/studio-engines/ba-text-v1/graphic.mjs','/studio-engines/ba-text-v1/text-layout.mjs','/studio-engines/ba-text-v1/portable.mjs','/library/v1.7.0/BTV_Relais_Antenne/graphic.mjs', '/api/me', '/api/graphics/projects', '/api/graphics/media/123/content']) {
    const response = await worker.fetch(new Request('https://studio.example' + path), bindings, context);
    expect(response.status).toBe(401); expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  }
  expect(assetFetch).toHaveBeenCalledTimes(1);
  for(const path of ['/preview-media/v1/ba-programme.mp4','/preview-media/v3/ba-prepared-slow-1280.mp4']){
    const response=await worker.fetch(new Request('https://studio.example'+path,{headers:{Range:'bytes=0-1'}}),bindings,context);
    expect(response.status).toBe(401);expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  }
  expect(assetFetch).toHaveBeenCalledTimes(1);
  const exportResponse=await worker.fetch(new Request('https://studio.example/api/graphics/projects/00000000-0000-4000-8000-000000000001/export',{method:'POST',headers:{Origin:'https://studio.example','Content-Type':'application/json'},body:'{}'}),bindings,context);
  expect(exportResponse.status).toBe(401);expect(assetFetch).toHaveBeenCalledTimes(1);
});
it('fails closed for private assets with incomplete production settings', async () => {
  const assetFetch = vi.fn();
  const response = await worker.fetch(new Request('https://studio.example/library/private.mp4'), { ...config, FIREBASE_PROJECT_ID: 'NOT_CONFIGURED', ASSETS: { fetch: assetFetch } as unknown as Fetcher }, context);
  expect(response.status).toBe(503); expect(assetFetch).not.toHaveBeenCalled();
});
