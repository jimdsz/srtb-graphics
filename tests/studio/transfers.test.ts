import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, expect, inject, it } from 'vitest';
import { api } from '../../server/router';
import { boundedPart } from '../../server/media';
import type { Member } from '../../src/studio/domain';

const author: Member = { email: 'admin@example.com', name: 'Jimmy', role: 'admin', active: 1 };
const other: Member = { email: 'other-transfer@example.test', name: 'Autre compte test', role: 'designer', active: 1 };
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const request = (path: string, method = 'GET', body?: unknown) => new Request(`https://studio.example/api/graphics/media${path}`, {
  method, headers: { Origin: 'https://studio.example', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
});
const call = (path: string, method = 'GET', body?: unknown, member = author) => api(request(path, method, body), env, member);
const create = async () => (await (await call('', 'POST', { name: 'Recette interruption.png', bytes: png.length, mimeType: 'image/png', consent: true }))!.json()) as { id: string };
const part = (id: string) => api(new Request(`https://studio.example/api/graphics/media/${id}/part/1`, { method: 'PUT', headers: { Origin: 'https://studio.example', 'Content-Length': String(png.length) }, body: png }), env, author);
beforeAll(async () => {
  await applyD1Migrations(env.DB, inject('migrations'));
  await env.DB.prepare('INSERT INTO members(email,name,role,updated_by) VALUES(?,?,?,?)').bind(other.email, other.name, other.role, author.email).run();
});
beforeEach(async () => { await env.DB.prepare('DELETE FROM media_parts').run(); await env.DB.prepare('DELETE FROM media').run(); });

it('lists only the member’s unfinished uploads and never exposes provider keys or leases', async () => {
  const transfer = await create();
  const rows = await (await call('/transfers'))!.json();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ id: transfer.id, received_bytes: 0, received_parts: 0, expected_parts: 1, busy: false });
  expect(rows[0]).not.toHaveProperty('object_key'); expect(rows[0]).not.toHaveProperty('upload_id'); expect(rows[0]).not.toHaveProperty('operation_until');
  expect(await (await call('/transfers', 'GET', undefined, other))!.json()).toEqual([]);
  await expect(call(`/${transfer.id}/cancel`, 'POST', {}, other)).rejects.toMatchObject({ status: 403 });
});

it('protects a live operation, frees abandoned quota on cancellation, and records it only once', async () => {
  const transfer = await create(); await create(); await create();
  await expect(create()).rejects.toMatchObject({ status: 409 });
  await env.DB.prepare('UPDATE media SET operation_token=?,operation_until=? WHERE id=?').bind('test-operation', Date.now() + 60000, transfer.id).run();
  const rows = await (await call('/transfers'))!.json();
  expect(rows.find((row: { id: string }) => row.id === transfer.id).busy).toBe(true);
  await expect(call(`/${transfer.id}/cancel`, 'POST', {})).rejects.toMatchObject({ status: 409 });
  await env.DB.prepare('UPDATE media SET operation_until=0 WHERE id=?').bind(transfer.id).run();
  expect((await call(`/${transfer.id}/cancel`, 'POST', {}))!.status).toBe(200);
  expect((await call(`/${transfer.id}/cancel`, 'POST', {}))!.status).toBe(200);
  expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM activity WHERE action='media.cancelled' AND target=?").bind(transfer.id).first())?.n).toBe(1);
  expect((await create()).id).toBeTruthy();
});

it('finalises after the provider finished but the response was lost, never deleting a received file', async () => {
  const transfer = await create(); await part(transfer.id);
  const row = await env.DB.prepare('SELECT object_key,upload_id FROM media WHERE id=?').bind(transfer.id).first<{ object_key: string; upload_id: string }>();
  const stored = await env.DB.prepare('SELECT etag FROM media_parts WHERE media_id=?').bind(transfer.id).first<{ etag: string }>();
  await env.MEDIA.resumeMultipartUpload(row!.object_key, row!.upload_id).complete([{ partNumber: 1, etag: stored!.etag }]);
  await expect(call(`/${transfer.id}/cancel`, 'POST', {})).rejects.toMatchObject({ status: 409 });
  expect((await (await call('/transfers'))!.json())[0]).toMatchObject({ received_bytes: png.length, received_parts: 1 });
  expect((await call(`/${transfer.id}/complete`, 'POST', {}))!.status).toBe(200);
  expect((await call(`/${transfer.id}/complete`, 'POST', {}))!.status).toBe(200);
  expect(await (await call('/transfers'))!.json()).toEqual([]);
  expect(await env.MEDIA.head(row!.object_key)).not.toBeNull();
  expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM activity WHERE action='media.shared' AND target=?").bind(transfer.id).first())?.n).toBe(1);
});

it('keeps incomplete media unavailable instead of treating recovery as successful', async () => {
  const transfer = await create();
  await expect(call(`/${transfer.id}/complete`, 'POST', {})).rejects.toMatchObject({ status: 409 });
  await expect(call(`/${transfer.id}/content`)).rejects.toMatchObject({ status: 409 });
  expect((await (await call('/transfers'))!.json())[0].id).toBe(transfer.id);
});

it('admits at most four concurrent media operations before reading another request body', async () => {
  const transfer = await create(), until = Date.now() + 60_000;
  for (let index = 0; index < 4; index++) {
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO media(id,object_key,name,mime_type,bytes,status,upload_id,operation_token,operation_until,created_by) VALUES(?,?,?,'image/png',1,'uploading',?,?,?,?)")
      .bind(id,`uploads/${id}`,`Charge ${index}`,'provider-fixture',`busy-${index}`,until,other.email).run();
  }
  await expect(part(transfer.id)).rejects.toMatchObject({status:503,headers:expect.any(Headers)});
  try { await part(transfer.id); throw new Error('Une saturation devait être signalée.'); }
  catch (error) { expect((error as {headers:Headers}).headers.get('Retry-After')).toBe('2'); }
  await env.DB.prepare("UPDATE media SET operation_until=0 WHERE operation_token='busy-0'").run();
  expect((await part(transfer.id))!.status).toBe(200);
});

it('stops a stalled local or network fragment without keeping its buffer indefinitely', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({pull(){ /* The source remains connected but sends no byte. */ },cancel(){cancelled=true;}});
  const request = new Request('https://studio.example/upload',{method:'PUT',headers:{'Content-Length':'1'},body:stream});
  await expect(boundedPart(request,1,10)).rejects.toMatchObject({status:408});
  expect(cancelled).toBe(true);
});
