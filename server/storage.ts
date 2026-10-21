import { S3Client, GetBucketAclCommand, HeadObjectCommand, GetObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand, ListObjectVersionsCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { FetchHttpHandler } from '@smithy/fetch-http-handler';
import { HttpError, readJson } from './http';
import {z} from 'zod';

interface ObjectHead { size: number; httpEtag: string; httpMetadata?: { contentType?: string } }
interface UploadPart { partNumber: number; etag: string }
interface Upload {
  uploadId: string;
  uploadPart(number: number, data: Uint8Array): Promise<UploadPart>;
  complete(parts: UploadPart[]): Promise<ObjectHead>;
  abort(): Promise<void>;
}
export interface MediaStore {
  head(key: string): Promise<ObjectHead | null>;
  get(key: string, options: { range: { offset: number; length: number }; etag?: string }): Promise<{ body: ReadableStream } | null>;
  createMultipartUpload(key: string, options: { httpMetadata: { contentType: string; cacheControl: string } }): Promise<Upload>;
  resumeMultipartUpload(key: string, id: string): Upload;
}
export interface StorageSettings {
  APP_ENV: string;
  STORAGE_PROVIDER?: string;
  B2_REGION?: string;
  B2_BUCKET?: string;
  B2_KEY_ID?: string;
  B2_APPLICATION_KEY?: string;
  MEDIA?: R2Bucket;
}
const storageError = () => new HttpError(503, 'Le stockage privé est indisponible ou non configuré. Aucun transfert n’est confirmé.');
const missing = (e: unknown) => typeof e === 'object' && e !== null && '$metadata' in e && (e.$metadata as { httpStatusCode?: number }).httpStatusCode === 404;
function checkedKey(key: string) {
  if (!/^(?:uploads\/[a-f\d-]{36}|library\/v[\d.]+\/[A-Za-z\d_-]+\/.+)$/.test(key) || /[\\\x00-\x1f?#%]/.test(key) || key.split('/').some(part => !part || part === '.' || part === '..')) throw new HttpError(400, 'Référence média invalide.');
  return key;
}

// Only the local qualification config provides R2. Production never falls back to a public URL.
export function mediaStore(env: StorageSettings): MediaStore {
  if (env.APP_ENV !== 'production' && env.STORAGE_PROVIDER !== 'b2' && env.MEDIA) return {
    head: key => env.MEDIA!.head(key),
    get: (key, options) => env.MEDIA!.get(key, { range: options.range }),
    createMultipartUpload: (key, options) => env.MEDIA!.createMultipartUpload(key, options),
    resumeMultipartUpload: (key, id) => env.MEDIA!.resumeMultipartUpload(key, id),
  };
  if (env.STORAGE_PROVIDER !== 'b2' || !/^[a-z]{2}-[a-z]+-\d{3}$/.test(env.B2_REGION || '') || !/^[A-Za-z\d][A-Za-z\d-]{4,61}[A-Za-z\d]$/.test(env.B2_BUCKET || '') || !/^[A-Za-z\d]{10,100}$/.test(env.B2_KEY_ID || '') || !/^[A-Za-z\d+/_=-]{20,200}$/.test(env.B2_APPLICATION_KEY || '')) throw storageError();
  return new BackblazeStore(env as Required<Pick<StorageSettings, 'B2_REGION' | 'B2_BUCKET' | 'B2_KEY_ID' | 'B2_APPLICATION_KEY'>>);
}

class BackblazeStore implements MediaStore {
  private client: S3Client;
  private bucket: string;
  private privateCheck?: Promise<void>;
  constructor(settings: Required<Pick<StorageSettings, 'B2_REGION' | 'B2_BUCKET' | 'B2_KEY_ID' | 'B2_APPLICATION_KEY'>>) {
    this.bucket = settings.B2_BUCKET;
    this.client = new S3Client({
      endpoint: `https://s3.${settings.B2_REGION}.backblazeb2.com`, region: settings.B2_REGION,
      credentials: { accessKeyId: settings.B2_KEY_ID, secretAccessKey: settings.B2_APPLICATION_KEY },
      forcePathStyle: true, followRegionRedirects: false, maxAttempts: 2,
      // B2 compatibility: do not add the optional AWS streaming checksum protocol.
      requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
      requestHandler: new FetchHttpHandler({ requestTimeout: 30000, requestInit: () => ({ redirect: 'manual', cache: 'no-store' }) }),
    });
  }
  private async privateBucket() {
    this.privateCheck ??= (async () => {
      const acl = await this.client.send(new GetBucketAclCommand({ Bucket: this.bucket }));
      if (!acl.Owner?.ID || !acl.Grants?.length || acl.Grants.some(grant => grant.Grantee?.Type !== 'CanonicalUser' || grant.Grantee.ID !== acl.Owner!.ID || grant.Grantee.URI)) throw storageError();
    })();
    await this.privateCheck.catch(error => { const failure=storageError(); failure.cause=error; throw failure; });
  }
  async head(key: string): Promise<ObjectHead | null> {
    checkedKey(key); await this.privateBucket();
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!Number.isSafeInteger(result.ContentLength) || result.ContentLength! < 0 || !result.ETag) throw storageError();
      return { size: result.ContentLength!, httpEtag: result.ETag, httpMetadata: { contentType: result.ContentType } };
    } catch (error) { if (missing(error)) return null; throw storageError(); }
  }
  async get(key: string, options: { range: { offset: number; length: number }; etag?: string }) {
    checkedKey(key); await this.privateBucket();
    const { offset, length } = options.range;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1) throw new HttpError(416, 'Plage média invalide.');
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=${offset}-${offset + length - 1}`, IfMatch: options.etag }));
      if (!result.Body) throw storageError();
      const body = result.Body.transformToWebStream();
      if (result.ContentLength !== length) { await body.cancel(); throw storageError(); }
      return { body };
    } catch (error) { if (missing(error)) return null; throw storageError(); }
  }
  async createMultipartUpload(key: string, options: { httpMetadata: { contentType: string; cacheControl: string } }) {
    checkedKey(key); await this.privateBucket();
    try {
      const result = await this.client.send(new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: key, ContentType: options.httpMetadata.contentType, CacheControl: options.httpMetadata.cacheControl, ServerSideEncryption: 'AES256' }));
      if (!result.UploadId) throw storageError();
      return this.resumeMultipartUpload(key, result.UploadId);
    } catch { throw storageError(); }
  }
  resumeMultipartUpload(key: string, id: string): Upload {
    checkedKey(key);
    if (!id || id.length > 2048 || /[\x00-\x1f]/.test(id)) throw new HttpError(400, 'Transfert invalide.');
    const input = { Bucket: this.bucket, Key: key, UploadId: id };
    return {
      uploadId: id,
      uploadPart: async (number, data) => {
        await this.privateBucket();
        if (!Number.isInteger(number) || number < 1 || number > 10000 || data.byteLength > 8 * 1024 ** 2 || !data.byteLength) throw new HttpError(400, 'Fragment invalide.');
        try {
          const part = await this.client.send(new UploadPartCommand({ ...input, PartNumber: number, Body: data, ContentLength: data.byteLength }));
          if (!part.ETag) throw storageError(); return { partNumber: number, etag: part.ETag };
        } catch { throw storageError(); }
      },
      complete: async parts => {
        await this.privateBucket();
        if (!parts.length || parts.some((part, index) => part.partNumber !== index + 1 || !part.etag)) throw new HttpError(409, 'Fragments incomplets.');
        try {
          await this.client.send(new CompleteMultipartUploadCommand({ ...input, MultipartUpload: { Parts: parts.map(part => ({ ETag: part.etag, PartNumber: part.partNumber })) } }));
          const result = await this.head(key); if (!result) throw storageError(); return result;
        } catch { throw storageError(); }
      },
      abort: async () => {
        await this.privateBucket();
        try { await this.client.send(new AbortMultipartUploadCommand(input)); } catch (error) { if (!missing(error)) throw storageError(); }
      },
    };
  }
  async purgeUploaded(key:string,uploadId:string|null):Promise<boolean>{
    checkedUploadKey(key);await this.privateBucket();
    if(uploadId)await this.resumeMultipartUpload(key,uploadId).abort();
    // Deleting only the current object would create a hide marker on B2.
    // Process bounded pages of explicit versions; never delete a prefix.
    const signal=AbortSignal.timeout(20000);
    const list=()=>this.client.send(new ListObjectVersionsCommand({Bucket:this.bucket,Prefix:key,MaxKeys:10}),{abortSignal:signal});
    try{
      const page=await list(),versions=[...(page.Versions??[]),...(page.DeleteMarkers??[])].filter(item=>item.Key===key);
      for(const version of versions){if(!version.VersionId)throw storageError();await this.client.send(new DeleteObjectCommand({Bucket:this.bucket,Key:key,VersionId:version.VersionId}),{abortSignal:signal});}
      const remaining=await list();return ![...(remaining.Versions??[]),...(remaining.DeleteMarkers??[])].some(item=>item.Key===key);
    }catch{throw new HttpError(503,'Le stockage n’a pas confirmé l’effacement des médias. La suppression reste à terminer ; réessayez.');}
  }
}

function checkedUploadKey(key:string){if(!/^uploads\/[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/.test(key))throw new HttpError(409,'Ce média n’est pas un fichier personnel supprimable. Aucun effacement de bibliothèque n’est autorisé.');}
// Read-only preflight before committing any metadata deletion. The application
// key never leaves the provider's fixed HTTPS endpoint and is never logged.
export async function verifyMediaPurgeAccess(env:StorageSettings,keys:string[]){
  keys.forEach(checkedUploadKey);if(!keys.length)return;
  if(env.APP_ENV!=='production'&&env.STORAGE_PROVIDER!=='b2'&&env.MEDIA)return;
  mediaStore(env); // Validate the pinned production provider/configuration first.
  try{
    const response=await fetch('https://api.backblazeb2.com/b2api/v4/b2_authorize_account',{
      headers:{Authorization:'Basic '+btoa(env.B2_KEY_ID+':'+env.B2_APPLICATION_KEY)},redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(10000),
    });
    if(!response.ok){await response.body?.cancel();throw storageError();}
    const result=z.object({apiInfo:z.object({storageApi:z.object({allowed:z.object({
      capabilities:z.array(z.string()),namePrefix:z.string().nullable(),buckets:z.array(z.object({name:z.string().nullable()})).nullable(),
    })})})}).parse(await readJson(response,65536));
    const allowed=result.apiInfo.storageApi.allowed;
    if(!['listFiles','deleteFiles','writeFiles'].every(p=>allowed.capabilities.includes(p))||
      (allowed.buckets&&!allowed.buckets.some(b=>b.name===env.B2_BUCKET))||
      (allowed.namePrefix&&!keys.every(k=>k.startsWith(allowed.namePrefix!))))throw storageError();
  }catch{throw new HttpError(503,'L’accès nécessaire à l’effacement des médias n’est pas confirmé. Aucun contenu n’a été supprimé ; réessayez ou contactez l’administrateur.');}
}
export async function purgeUploadedMedia(env:StorageSettings,key:string,uploadId:string|null){
  checkedUploadKey(key);
  if(env.APP_ENV!=='production'&&env.STORAGE_PROVIDER!=='b2'&&env.MEDIA){
    if(uploadId){try{await env.MEDIA.resumeMultipartUpload(key,uploadId).abort();}catch{if(await env.MEDIA.head(key))throw storageError();}}
    await env.MEDIA.delete(key);return (await env.MEDIA.head(key))===null;
  }
  const store=mediaStore(env);if(!(store instanceof BackblazeStore))throw storageError();
  return store.purgeUploaded(key,uploadId);
}
