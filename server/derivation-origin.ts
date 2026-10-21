import inventory from '../reports/library-intake.json';
import {getTemplate,isMediaField,isSequenceField} from '../src/studio/domain';
import type {ProjectData} from '../src/studio/domain';
import type {DerivationOrigin} from '../src/studio/derivation-types';

const assets=new Set(inventory.assets.map(asset=>asset.key));
export const snapshotHash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
export function canonicalJson(value:unknown):string {
  if(Array.isArray(value))return '['+value.map(canonicalJson).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.entries(value).filter(([,item])=>item!==undefined).sort(([left],[right])=>left<right?-1:left>right?1:0).map(([key,item])=>JSON.stringify(key)+':'+canonicalJson(item)).join(',')+'}';
  return JSON.stringify(value)??'null';
}
export function libraryReferences(templateId:string,libraryVersion:string,data:ProjectData):Set<string>{
  const template=getTemplate(templateId),result=new Set<string>();
  const prefix=`/library/v${libraryVersion}/${templateId}/`;
  function add(value:unknown){
    const url=typeof value==='string'?value:value&&typeof value==='object'&&'url'in value?value.url:undefined;
    if(typeof url!=='string'||!url)return;
    if(url.startsWith('/library/'))result.add(url);
    else if(/^(?:lib|sourceassets)\//.test(url))result.add(prefix+url);
    else if(/^img_\d+\.(?:png|jpe?g|webp)$/.test(url))result.add(prefix+'lib/images/'+url);
  }
  for(const [key,field]of Object.entries(template.fields)){
    if(isMediaField(key,field))add(data[key]);
    else if(isSequenceField(key,field)){
      const clips:unknown=JSON.parse(String(data[key]||'[]'));
      if(Array.isArray(clips))for(const clip of clips)if(clip&&typeof clip==='object'&&'url'in clip)add(clip.url);
    }
  }
  return result;
}
interface OriginRow {
  id:string;source_project_id:string;source_revision:number;source_template_id:string;source_template_version:string;source_library_version:string;
  source_snapshot_json:string;source_snapshot_sha256:string;template_id:string;template_version:string;library_version:string;data_json:string;announcement_json:string|null;
}
/** Authenticated callers only. The allowlist is immutable r1 provenance, never a client assertion or broad library prefix. */
export async function getValidatedProjectOrigin(db:D1Database,id:string):Promise<DerivationOrigin|null>{
  const row=await db.prepare(`SELECT b.id,b.source_project_id,b.source_revision,b.source_template_id,b.source_template_version,b.source_library_version,b.source_snapshot_json,b.source_snapshot_sha256,
    p.template_id,p.template_version,p.library_version,r.data_json,d.announcement_json FROM project_derivations d JOIN derivation_batches b ON b.id=d.batch_id
    JOIN projects p ON p.id=d.project_id JOIN revisions r ON r.project_id=d.project_id AND r.revision=d.initial_revision WHERE d.project_id=?`).bind(id).first<OriginRow>();
  if(!row)return null;
  if(await snapshotHash(row.source_snapshot_json)!==row.source_snapshot_sha256)return null;
  try{
    const source=getTemplate(row.source_template_id),target=getTemplate(row.template_id);
    if(source.version!==row.source_template_version||source.libraryVersion!==row.source_library_version||target.version!==row.template_version||target.libraryVersion!==row.library_version)return null;
    const snapshot=JSON.parse(row.source_snapshot_json) as {title:string;data:ProjectData};
    const sourceUrls=libraryReferences(source.id,source.libraryVersion,snapshot.data),targetUrls=libraryReferences(target.id,target.libraryVersion,JSON.parse(row.data_json));
    const sourcePrefix=`/library/v${source.libraryVersion}/`,targetPrefix=`/library/v${target.libraryVersion}/${target.id}/`;
    const allowedLibraryUrls=[...targetUrls].filter(url=>!url.startsWith(targetPrefix)&&url.startsWith(sourcePrefix+source.id+'/')&&sourceUrls.has(url)&&assets.has(decodeURIComponent(url.slice(sourcePrefix.length)))).sort();
    return {batchId:row.id,sourceProjectId:row.source_project_id,sourceRevision:row.source_revision,sourceTemplateId:source.id,sourceTemplateVersion:source.version,sourceLibraryVersion:source.libraryVersion,sourceSnapshotSha256:row.source_snapshot_sha256,allowedLibraryUrls,...(row.announcement_json?{announcement:JSON.parse(row.announcement_json)}:{})};
  }catch{return null;}
}
