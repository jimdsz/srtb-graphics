import test from 'node:test';
import assert from 'node:assert/strict';
import {projectRoutes} from '../server/projects';
import {getTemplate,validateProjectData} from '../src/studio/domain';
import type {ProjectData} from '../src/studio/domain';
import {DEFAULT_TEXT_CASE,defaultTextCaseData} from '../src/studio/typography-model';

/** Only the D1 persistence port is stubbed; execute the actual POST route and
 * shared validation. No server, account, authentication or external writes. */
async function create(data?:ProjectData){
  let row:any;
  const DB={prepare(sql:string){let values:any[]=[];const statement={bind(...args:any[]){values=args;return statement;},async run(){
    assert.match(sql,/^INSERT INTO projects/);row={id:values[0],title:values[1],template_id:values[2],template_version:values[3],library_version:values[4],data_json:values[5],created_by:values[6],updated_by:values[7],visibility:'private',status:'draft',revision:1,archived:0};return {success:true};
  },async first(){assert.match(sql,/^SELECT \*/);return row;},async all(){throw Error('Unexpected DB read: '+sql);}};return statement;}};
  const response=await projectRoutes(new Request('https://studio.example/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'Nouveau projet',templateId:'BTV_PopUp',...(data?{data}:{})})}),{DB} as any,{email:'recette@example.test',name:'Recette',role:'designer',active:1});
  assert.equal(response?.status,201);return await response!.json() as {data:ProjectData};
}

test('actual creation route fills uppercase-mode and empty popup defaults even for partial input',async()=>{
  const empty=await create();assert.equal(empty.data[DEFAULT_TEXT_CASE],'upper');assert.equal(empty.data._media_background_url,'');assert.equal(empty.data._background_visible,false);
  const partial=await create({_title:'Été au Bénin'});assert.equal(partial.data._title,'Été au Bénin');assert.equal(partial.data[DEFAULT_TEXT_CASE],'upper');
  assert.equal(defaultTextCaseData(getTemplate('BTV_PopUp'),partial.data)._title,'ÉTÉ AU BÉNIN');
});

test('copying validated legacy data preserves its original mode, mixed casing and background choice',async()=>{
  const template=getTemplate('BTV_PopUp'),legacy=validateProjectData(template,{_title:'Été au Bénin'}),before=structuredClone(legacy),copy=await create(legacy);
  assert.deepEqual(copy.data,legacy);assert.equal(copy.data[DEFAULT_TEXT_CASE],'original');assert.deepEqual(legacy,before);
  assert.equal(copy.data._media_background_url,template.fields._media_background_url.default);
});
