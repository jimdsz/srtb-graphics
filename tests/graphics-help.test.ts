import assert from 'node:assert/strict';
import {test} from 'node:test';
import {availableHelpTopics,emptyHelpProgress,HELP_TOPIC_ORDER,HELP_VERSION,helpStorageKey,helpTopic,isHelpTopic,parseHelpProgress,readHelpProgress,safeHelpDestination,writeHelpProgress} from '../src/studio/graphics-help.ts';
import type {HelpStorage} from '../src/studio/graphics-help.ts';

test('progress recovers safely from blocked, stale and malformed browser storage',()=>{
  for(const raw of [null,'invalid','null','[]','3','{"version":99}','{"version":1,"last":{"topic":"__proto__","step":0},"completed":["toString"]}']){
    assert.deepEqual(parseHelpProgress(raw),emptyHelpProgress());
  }
  const blocked:HelpStorage={getItem(){throw Error('Denied');},setItem(){throw Error('Denied');}};
  assert.deepEqual(readHelpProgress('one@example.test',blocked),emptyHelpProgress());
  assert.equal(writeHelpProgress('one@example.test',emptyHelpProgress(),blocked),false);
  for(const step of [-1,1.5,100,'1'])assert.equal(parseHelpProgress(JSON.stringify({version:HELP_VERSION,last:{topic:'start',step}})).last,null);
});

test('resume position is local, versioned and separate for each member',()=>{
  const values=new Map<string,string>();
  const storage:HelpStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>{values.set(key,value);}};
  const progress={...emptyHelpProgress(),dismissed:true,last:{topic:'programmes' as const,step:2},completed:['start' as const]};
  assert.equal(writeHelpProgress(' ONE@example.test ',progress,storage),true);
  assert.deepEqual(readHelpProgress('one@example.test',storage),progress);
  assert.deepEqual(readHelpProgress('two@example.test',storage),emptyHelpProgress());
  assert.deepEqual([...values.keys()],[helpStorageKey('one@example.test')]);
  assert.equal(writeHelpProgress('',progress,storage),false);
  assert.match(helpStorageKey('one@example.test'),/\.v1:/);
});

test('only permitted page destinations are exposed, with role-specific validation labels',()=>{
  const pages=new Set(['home','planner','projects','programmes','library','media','validation','admin']);
  for(const role of ['designer','broadcaster','admin'] as const){
    for(const topic of availableHelpTopics(role)){
      const destination=safeHelpDestination(topic,role);
      if(destination)assert.ok(pages.has(destination));
      if(role!=='admin')assert.notEqual(destination,'admin');
    }
  }
  assert.equal(helpTopic('validation','designer').title,'Mes envois');
  assert.equal(helpTopic('validation','broadcaster').title,'À valider');
  assert.equal(safeHelpDestination(helpTopic('admin'),'designer'),undefined);
  assert.deepEqual(availableHelpTopics('commercial'),[]);
  for(const id of HELP_TOPIC_ORDER)assert.equal(safeHelpDestination(helpTopic(id),'commercial'),undefined);
  for(const section of ['connector','channels','export','audio','crop'])assert.equal(helpTopic(section).destination,undefined);
  assert.equal(isHelpTopic('__proto__'),false);
  assert.equal(helpTopic('invalid').id,'home');
});

test('each guide has concrete scene labels and concise steps without missing content',()=>{
  assert.equal(new Set(HELP_TOPIC_ORDER).size,HELP_TOPIC_ORDER.length);
  for(const id of HELP_TOPIC_ORDER){
    const topic=helpTopic(id);assert.equal(topic.id,id);assert.ok(topic.steps.length>=2);
    for(const step of topic.steps){
      assert.ok(step.title.length>5);assert.ok(step.body.length<330);assert.ok(step.cue.length<180);
      assert.equal(step.labels.length,3);assert.ok(step.labels.every(label=>label.length>0));
    }
  }
});

test('progress serialization removes foreign fields and deduplicates completion',()=>{
  const parsed=parseHelpProgress(JSON.stringify({version:HELP_VERSION,dismissed:'yes',project:{secret:true},completed:['start','start','invalid'],last:{topic:'audio',step:1,projectId:'not retained'}}));
  assert.deepEqual(parsed,{version:HELP_VERSION,dismissed:false,completed:['start'],last:{topic:'audio',step:1}});
});
