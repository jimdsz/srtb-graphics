import {test} from 'node:test';
import assert from 'node:assert/strict';
import {broadcastTemplates,templateDefaults} from '../src/studio/domain';
import type {Project,MediaAsset} from '../src/studio/domain';
import {buildDeliveryPlan} from '../src/studio/delivery-plan';
import {packageDocuments} from '../src/studio/delivery-runtime';
import inventory from '../reports/library-intake.json';

const id='00000000-0000-4000-8000-000000000099',url=`/api/graphics/media/${id}/content`,media:MediaAsset={id,name:'logo.png',mime_type:'image/png',bytes:30,status:'ready',created_by:'local-test',created_at:''};
const key='_studio_overlay_logo_url';
test('every template packages an enabled shared logo once and preserves its versioned HTML settings',()=>{
  for(const template of broadcastTemplates){
    const project:Project={id:'00000000-0000-4000-8000-000000000001',title:'Logo recipe',template_id:template.id,template_version:template.version,library_version:template.libraryVersion,status:'draft',revision:1,data:{...templateDefaults(template),_studio_overlay_logo_enabled:true,[key]:{url,name:'logo.png',mimeType:'image/png'}},created_by:'test',updated_by:'test',created_at:'',updated_at:'',archived:0};
    const plan=buildDeliveryPlan(project,template,inventory.assets,[media]);
    assert.equal(plan.files.filter(file=>file.url===url).length,1);assert.equal((plan.data[key] as {url:string}).url,`lib/shared/${id}.png`);
    const docs=packageDocuments(plan,template);assert.ok(docs['studio-typography.mjs'].includes('data-studio-overlay-logo'));
    assert.ok(docs['srtb-project.mjs'].includes('_studio_overlay_logo_version'));assert.equal(JSON.parse(docs['PROJET.json']).data._studio_overlay_logo_enabled,true);
    const hidden=buildDeliveryPlan({...project,data:{...project.data,_studio_overlay_logo_enabled:false}},template,inventory.assets,[]);
    assert.equal(hidden.files.some(file=>file.url===url),false);assert.equal(hidden.data[key],'');assert.equal((project.data[key] as {url:string}).url,url);
  }
});
test('local logo descriptors become fingerprinted relative package assets',()=>{
  const template=broadcastTemplates[0],sha='a'.repeat(64),local={url:`local-media:${sha}:120`,name:'logo.png',mimeType:'image/png'};
  const project:Project={id:'00000000-0000-4000-8000-000000000001',title:'Local logo recipe',template_id:template.id,template_version:template.version,library_version:template.libraryVersion,status:'draft',revision:1,data:{...templateDefaults(template),_studio_overlay_logo_enabled:true,[key]:local},created_by:'test',updated_by:'test',created_at:'',updated_at:'',archived:0};
  const plan=buildDeliveryPlan(project,template,inventory.assets,[]);
  assert.deepEqual(plan.files.find(file=>file.url===local.url),{path:`lib/local/${sha}.png`,url:local.url,bytes:120,sha256:sha});
  assert.equal((plan.data[key] as {url:string}).url,`lib/local/${sha}.png`);assert.deepEqual(project.data[key],local);
});
