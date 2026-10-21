import { afterEach, expect, it, vi } from 'vitest';
import { mediaStore,purgeUploadedMedia,verifyMediaPurgeAccess } from '../../server/storage';
import { objectResponse } from '../../server/media';

const config = { APP_ENV: 'production', STORAGE_PROVIDER: 'b2', B2_REGION: 'eu-central-003', B2_BUCKET: 'srtb-test-private', B2_KEY_ID: 'test000000000000000000000', B2_APPLICATION_KEY: 'unit-test-key-not-real000000000000' };
const key = 'uploads/12345678-1234-1234-1234-123456789012';
const xml = (body: string, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'application/xml' } });
const acl = (extra = '') => xml(`<AccessControlPolicy xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Owner><ID>owner</ID></Owner><AccessControlList><Grant><Grantee xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="CanonicalUser"><ID>owner</ID></Grantee><Permission>FULL_CONTROL</Permission></Grant>${extra}</AccessControlList></AccessControlPolicy>`);
afterEach(() => vi.restoreAllMocks());
function mock(handler: (request: Request) => Response | Promise<Response>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    expect(new URL(request.url).origin).toBe('https://s3.eu-central-003.backblazeb2.com');
    expect(request.redirect).toBe('manual');
    expect(request.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(request.url).not.toContain(config.B2_APPLICATION_KEY);
    return handler(request);
  });
}
it('fails closed without secrets, on an unsafe endpoint, or on a production local fallback', () => {
  expect(() => mediaStore({ APP_ENV: 'production', STORAGE_PROVIDER: 'local' })).toThrow();
  expect(() => mediaStore({ ...config, B2_APPLICATION_KEY: '' })).toThrow();
  expect(() => mediaStore({ ...config, B2_REGION: 'localhost.invalid/path' })).toThrow();
});
it('refuses a public bucket before fetching or uploading media', async () => {
  const spy = mock(() => acl('<Grant><Grantee xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="Group"><URI>http://acs.amazonaws.com/groups/global/AllUsers</URI></Grantee><Permission>READ</Permission></Grant>'));
  await expect(mediaStore(config).head(key)).rejects.toMatchObject({ status: 503 });
  expect(spy).toHaveBeenCalledTimes(1);
});
it('streams ranges from the private bucket without exposing an origin URL', async () => {
  mock(request => {
    if (new URL(request.url).searchParams.has('acl')) return acl();
    if (request.method === 'HEAD') return new Response(null, { headers: { 'Content-Length': '100', ETag: '"etag-test"', 'Content-Type': 'video/mp4' } });
    expect(request.headers.get('range')).toBe('bytes=4-7');
    expect(request.headers.get('if-match')).toBe('"etag-test"');
    return new Response(new Uint8Array([1, 2, 3, 4]), { status: 206, headers: { 'Content-Length': '4', 'Content-Range': 'bytes 4-7/100' } });
  });
  const response = await objectResponse(new Request('https://studio.example/api/media/file/content', { headers: { Range: 'bytes=4-7' } }), mediaStore(config), key);
  expect(response.status).toBe(206); expect(response.headers.get('Content-Range')).toBe('bytes 4-7/100');
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3, 4]);
});
it('uses the S3 multipart protocol and confirms final object size', async () => {
  let completed = false, aborted = false;
  mock(async request => {
    const url = new URL(request.url);
    if (url.searchParams.has('acl')) return acl();
    if (url.searchParams.has('uploads')) {
      expect(request.headers.get('x-amz-server-side-encryption')).toBe('AES256');
      return xml('<InitiateMultipartUploadResult><UploadId>test-upload</UploadId></InitiateMultipartUploadResult>');
    }
    if (request.method === 'PUT') { expect(new Uint8Array(await request.arrayBuffer())).toHaveLength(3); return new Response(null, { headers: { ETag: '"part-1"' } }); }
    if (request.method === 'POST') { expect(await request.text()).toContain('<PartNumber>1</PartNumber>'); completed = true; return xml('<CompleteMultipartUploadResult><ETag>"final"</ETag></CompleteMultipartUploadResult>'); }
    if (request.method === 'DELETE') { aborted = true; return new Response(null, { status: 204 }); }
    expect(completed).toBe(true); return new Response(null, { headers: { 'Content-Length': '3', ETag: '"final"' } });
  });
  const bucket = mediaStore(config), upload = await bucket.createMultipartUpload(key, { httpMetadata: { contentType: 'image/png', cacheControl: 'private, no-store' } });
  const part = await upload.uploadPart(1, new Uint8Array([1, 2, 3]));
  expect((await upload.complete([part])).size).toBe(3);
  await bucket.resumeMultipartUpload(key, 'other-test-upload').abort(); expect(aborted).toBe(true);
});
it('distinguishes absent objects from storage failures and rejects traversal', async () => {
  mock(request => new URL(request.url).searchParams.has('acl') ? acl() : new Response(null, { status: 404 }));
  expect(await mediaStore(config).head(key)).toBeNull();
  await expect(mediaStore(config).head('uploads/../secret')).rejects.toMatchObject({ status: 400 });
  mock(request => new URL(request.url).searchParams.has('acl') ? acl() : xml('<Error><Code>AccessDenied</Code></Error>', 403));
  await expect(mediaStore(config).head(key)).rejects.toMatchObject({ status: 503 });
});
it('permanently removes explicit versions and hide markers, never prefix neighbours',async()=>{
  let listed=0;const deleted:string[]=[];
  mock(request=>{
    const url=new URL(request.url);if(url.searchParams.has('acl'))return acl();
    if(request.method==='DELETE'){expect(url.pathname).toBe('/srtb-test-private/'+key);const v=url.searchParams.get('versionId');expect(v).toBeTruthy();deleted.push(v!);return new Response(null,{status:204});}
    expect(url.searchParams.get('prefix')).toBe(key);expect(url.searchParams.get('max-keys')).toBe('10');listed++;
    return xml(`<ListVersionsResult>${listed===1?`<Version><Key>${key}</Key><VersionId>v1</VersionId></Version><DeleteMarker><Key>${key}</Key><VersionId>v2</VersionId></DeleteMarker>`:''}<Version><Key>${key}-neighbour</Key><VersionId>keep</VersionId></Version></ListVersionsResult>`);
  });
  expect(await purgeUploadedMedia(config,key,null)).toBe(true);expect(deleted).toEqual(['v1','v2']);
});
it('reports remaining versions and refuses protected library files',async()=>{
  const spy=mock(request=>new URL(request.url).searchParams.has('acl')?acl():request.method==='DELETE'?new Response(null,{status:204}):xml(`<ListVersionsResult><Version><Key>${key}</Key><VersionId>v1</VersionId></Version></ListVersionsResult>`));
  expect(await purgeUploadedMedia(config,key,null)).toBe(false);
  spy.mockClear();await expect(purgeUploadedMedia(config,'library/v1/template/audio.wav',null)).rejects.toMatchObject({status:409});expect(spy).not.toHaveBeenCalled();
});
it('checks B2 purge permissions read-only before metadata is committed',async()=>{
  let rights=['listFiles','deleteFiles','writeFiles'];
  const spy=vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
    const req=new Request(input,init);expect(req.url).toBe('https://api.backblazeb2.com/b2api/v4/b2_authorize_account');expect(req.method).toBe('GET');expect(req.redirect).toBe('manual');
    return Response.json({apiInfo:{storageApi:{allowed:{capabilities:rights,namePrefix:'uploads/',buckets:[{name:config.B2_BUCKET}]}}}});
  });
  await verifyMediaPurgeAccess(config,[key]).catch(async e=>{for(const r of spy.mock.results)await r.value;throw e;});rights=['listFiles'];await expect(verifyMediaPurgeAccess(config,[key])).rejects.toMatchObject({status:503});expect(spy).toHaveBeenCalledTimes(2);
});
