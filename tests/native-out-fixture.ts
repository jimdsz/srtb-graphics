import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import type {ProjectData} from '../src/studio/domain';
const root=new URL('../',import.meta.url);
const native=(id:string,file:string)=>new URL(`public/library/v1.7.0/${id}/${file}`,root);
/** Execute the active native duration normalizer, not a copied rounding rule. */
export async function nativeOutDuration(id:string,settings:ProjectData):Promise<number>{
  if(id==='BTV_BA_1P'){
    const current=await readFile(new URL('public/studio-engines/ba-text-v2/config.mjs',root),'utf8');
    const body=current.slice(current.indexOf('export function normalizeConfig('),current.indexOf('\nfunction setText('));
    assert.ok(body.length);
    const {DEFAULTS,SCHEMA}=await import(native(id,'config.mjs').href);
    const normalize=runInNewContext(body.replace('export ','')+';normalizeConfig',{DEFAULTS,SCHEMA,structuredClone});
    // Studio voice/text adapters remove their private keys before this native
    // boundary. This fixture qualifies only the OUT pair, using native defaults
    // for all unrelated fields rather than imitating those adapters.
    return normalize({_out_mode:settings._out_mode,_out_duration_seconds:settings._out_duration_seconds})._out_duration_seconds;
  }
  if(id==='BTV_BA_TDS_SUIVI_DE'){
    const source=await readFile(native(id,'dynamic-graphic.mjs'),'utf8'),start=source.indexOf('    _configuration(raw) {'),end=source.indexOf('\n    _monitored(',start);
    assert.ok(start>=0&&end>start);
    const method=source.slice(start,end).trim().replace(/^_configuration\(raw\)/,'function(raw)');
    const normalize=runInNewContext('('+method+')',{FPS:25,START_END:607,KINDS:['programme_1','programme_2'],clonePayload:(raw:any)=>({...raw}),bool:(v:any)=>v===true||v===1||['true','1','oui','yes','on'].includes(String(v).toLowerCase())});
    return normalize.call({media:{data:{}}},settings)._out_duration_seconds;
  }
  const {validateOutConfiguration}=await import(native(id,'auto-out.mjs').href),config={...settings};
  validateOutConfiguration(config);return Number(config._out_duration_seconds);
}
