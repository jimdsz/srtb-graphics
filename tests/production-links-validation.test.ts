import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProductionLinksPage} from '../src/studio/production-links-validation';
import type {ProductionLinksPage,ProductionProjectItem} from '../src/studio/production-links-model';
const id=(n:number)=>`88888888-8888-4888-8888-${String(n).padStart(12,'0')}`;
function page():ProductionLinksPage{
 const project={id:id(2),title:'Projet visible',templateId:'BTV_BA_1P',templateVersion:'1',libraryVersion:'1',revision:2,status:'draft' as const,archived:false,format:'tv' as const};
 const item:ProductionProjectItem={type:'project',id:project.id,relation:'direct',taskKey:'ba:tv:ligne',kind:'ba',format:'tv',sourceRevision:1,edition:null,linkage:'missing-history',origins:[{rowId:'ligne',linkage:'missing-history',occurrence:null}],project};
 return {context:{channelId:'benin-tv',planId:id(1),planRevision:2,planName:'Préparation',rowId:'ligne',scope:'programme',programmeId:id(3),title:'Émission',snapshot:'a'.repeat(64)},section:'deliverables',items:[item],next:null};
}
test('the dossier contract preserves missing history and real project model without a snapshot',()=>{const input=page();assert.deepEqual(validateProductionLinksPage(input),input);});
test('no raw project data, source snapshot, voice or media field can enter the contract',()=>{
 for(const name of ['data','data_json','sourceSnapshot','media','voice','token']){
  const input=page();Object.assign((input.items[0] as ProductionProjectItem).project,{[name]:{secret:'not-a-summary'}});assert.throws(()=>validateProductionLinksPage(input),/incohérente/);
 }
});
test('project ids must agree and may not masquerade as occurrence ids',()=>{
 const input=page();input.items[0].id=id(4);assert.throws(()=>validateProductionLinksPage(input),/incohérente/);
 const mismatch=page();mismatch.section='occurrences';assert.throws(()=>validateProductionLinksPage(mismatch),/incohérente/);
});
test('scope and section cannot silently widen',()=>{
 const input=page();input.context.scope='line';assert.throws(()=>validateProductionLinksPage(input),/incohérente/);
 const mismatch=page();mismatch.section='derivations';assert.throws(()=>validateProductionLinksPage(mismatch),/incohérente/);
});
test('duplicates and pages beyond thirty are rejected without truncation',()=>{
 const duplicate=page();duplicate.items.push(structuredClone(duplicate.items[0]));assert.throws(()=>validateProductionLinksPage(duplicate),/incohérente/);
 const oversized=page();oversized.items=Array.from({length:31},(_,n)=>{const item=structuredClone(oversized.items[0]) as ProductionProjectItem;item.id=id(n+20);item.project.id=item.id;return item;});assert.throws(()=>validateProductionLinksPage(oversized),/incohérente/);
});
test('no invented delivery/export status or unsupported format is accepted',()=>{
 for(const patch of [{status:'exported'},{status:'delivered'},{format:'square'}]){const input=page();Object.assign((input.items[0] as ProductionProjectItem).project,patch);assert.throws(()=>validateProductionLinksPage(input),/incohérente/);}
});
test('an empty candidate page can continue without claiming the dossier ends',()=>{const input=page();input.items=[];input.next='opaque-next';assert.deepEqual(validateProductionLinksPage(input),input);});
test('transport bytes, cursors and metadata strings are explicitly bounded',()=>{
 const longTitle=page();longTitle.context.title='x'.repeat(201);assert.throws(()=>validateProductionLinksPage(longTitle),/incohérente/);
 const longCursor=page();longCursor.next='x'.repeat(4097);assert.throws(()=>validateProductionLinksPage(longCursor),/incohérente/);
 assert.throws(()=>validateProductionLinksPage({payload:'x'.repeat(1024*1024)}),/limite/);
});
