import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {getTemplate,templateDefaults,validateProjectData} from '../src/studio/domain.ts';
import {TIMINGS,makeTimeline} from '../src/studio/video/timeline.ts';
import {programmeTargets,proposeProgramme} from '../src/studio/preparation-proposal.ts';
import {programmeDataSchema} from '../src/studio/preparation-profile-model.ts';
import {socialTrackTimes} from '../src/studio/social-renderer.ts';

const root=new URL('../public/library/v1.7.0/',import.meta.url);

test('event and weekly templates ship their immutable AE sources and complete native OUT',()=>{
  const expected={BTV_Evenement:{frames:526,stop:17.72,out:3.32,defaultOut:18.04,extra:8},BTV_Semainier:{frames:658,stop:23.24,out:3.08,defaultOut:23.32,extra:2}};
  for(const [id,contract]of Object.entries(expected)){
    const template=getTemplate(id),defaults=templateDefaults(template),timing=TIMINGS[id];
    assert.deepEqual({stop:timing.stop,out:timing.out},{stop:contract.stop,out:contract.out});
    assert.equal(defaults._out_duration_seconds,contract.defaultOut,'Operator/default request is preserved.');
    assert.equal(makeTimeline(id,defaults,{},0).frames,contract.frames+contract.extra,'Entire pre-fade is included after the unchanged request.');
    for(const file of ['graphic.mjs','config.mjs','preview.html','source/animation.json'])assert.equal(existsSync(new URL(`${id}/${file}`,root)),true,`${id}/${file}`);
    const source=JSON.parse(readFileSync(new URL(`${id}/source/animation.json`,root),'utf8'));
    assert.equal(source.op,contract.frames);assert.equal(source.fr,25);assert.equal(source.w,1920);assert.equal(source.h,1080);
    assert.deepEqual(validateProjectData(template,defaults),defaults);
  }
});

test('weekly planner exposes seven current programmes with a distinct media for every slot',()=>{
  const template=getTemplate('BTV_Semainier'),defaults=templateDefaults(template),targets=programmeTargets(template);
  assert.deepEqual(targets.map(target=>target.id),['1','2','3','4','5','6','7']);
  for(let n=1;n<=7;n++){
    for(const key of [`programme_${n}_category`,`programme_${n}_title`,`_media_programme_${n}_url`])assert.ok(key in template.fields,key);
    const proposal=proposeProgramme(template,defaults,'Programme',programmeDataSchema.parse({title:`Programme ${n}`,palette:['#007300'],appointments:[]}),String(n));
    assert.equal(proposal.patch[`programme_${n}_title`],`Programme ${n}`);
  }
});

test('social routing follows event assets and each weekly slot without reusing an unrelated schedule',()=>{
  assert.deepEqual(socialTrackTimes('BTV_Evenement',8,18.04),{intro:8,event:8,event_logo:8});
  assert.deepEqual(socialTrackTimes('BTV_Semainier',1,23.32),{intro:1});
  assert.deepEqual(Object.keys(socialTrackTimes('BTV_Semainier',3,23.32)),['programme_1']);
  assert.deepEqual(Object.keys(socialTrackTimes('BTV_Semainier',6,23.32)),['programme_2']);
  assert.deepEqual(Object.keys(socialTrackTimes('BTV_Semainier',18,23.32)),['programme_7']);
  assert.ok(Math.abs(socialTrackTimes('BTV_Semainier',21,23.32).final-1.2)<1e-9);
});
