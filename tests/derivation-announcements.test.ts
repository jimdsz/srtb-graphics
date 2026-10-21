import test from 'node:test';
import assert from 'node:assert/strict';
import {getTemplate,templateDefaults} from '../src/studio/domain';
import type {ProjectData} from '../src/studio/domain';
import {deriveProjects,derivationRequestSchema} from '../src/studio/derivation-model';
import type {DerivationAnnouncement,DerivationSource,DerivationTarget} from '../src/studio/derivation-model';

const template=getTemplate('BTV_BA_1P');
const profileId='00000000-0000-4000-8000-000000000041';
const keys=['day-time','tomorrow','today','tonight','now'] as const;
const weekdays=['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'] as const;
const formats=['tv','portrait','vertical'] as const;
type Key=typeof keys[number];
function source(patch:ProjectData={}):DerivationSource{
  return {templateId:template.id,templateVersion:template.version,libraryVersion:template.libraryVersion,title:'Le grand entretien',data:{
    ...templateDefaults(template),_studio_ba_mode:'multiple',_jour_1:'Lundi',_heure_1:'20h35',_jour_2:'Mardi',_heure_2:'09h00',_jour_3:'Jeudi',_heure_3:'14h30',
    _titre_ligne_1:'LE GRAND',_titre_ligne_2:'ENTRETIEN',_titre_ligne_3:'SPÉCIAL',...patch,
  }};
}
function announcement(key:Key,patch:Partial<DerivationAnnouncement>={}):DerivationAnnouncement{
  return {key,formats:['tv'],voice:{mode:'pending'},...patch} as DerivationAnnouncement;
}
function request(announcements:unknown,targets:unknown=[]){
  const input=source();
  return {requestId:'00000000-0000-4000-8000-000000000001',name:'Cinq annonces',sourceRevision:3,sourceTitle:input.title,sourceData:input.data,targets,announcements};
}
function deriveInvalid(announcements:unknown,targets:unknown=[]){
  return ()=>deriveProjects(source(),targets as DerivationTarget[],'',announcements as DerivationAnnouncement[]);
}
function ownProperty(value:object,key:string,entry:unknown){
  return Object.defineProperty({...value},key,{value:entry,enumerable:true,configurable:true,writable:true});
}
function expectSilent(data:ProjectData){
  assert.equal(data._audio_voice_enabled,false);
  assert.equal(data._audio_voice_url,'');
  assert.equal(data._audio_voice_in_seconds,0);
  assert.equal(data._audio_voice_out_seconds,.04);
}
function expectTdsSilent(data:ProjectData){assert.equal(data._audio_voice_enabled,false);assert.equal(data._audio_voice_url,'');}

test('five announcements map to complete simple BA projects with explicit independent metadata',()=>{
  const input=source(),before=structuredClone(input),selections=keys.map(key=>announcement(key));
  const children=deriveProjects(input,[],'',selections);
  assert.equal(children.length,5);
  assert.equal(new Set(children.map(child=>child.targetKey)).size,5);
  const days=['Lundi','Demain','Aujourd’hui','Ce soir','Tout de suite'];
  children.forEach((child,index)=>{
    const immediate=index===4;
    assert.equal(child.templateId,immediate?'BTV_BA_TDS':template.id);
    assert.equal(child.libraryVersion,template.libraryVersion);
    assert.equal(child.data._studio_format,'tv');
    if(immediate){
      assert.equal(Object.hasOwn(child.data,'_jour_1'),false);assert.equal(Object.hasOwn(child.data,'_heure_1'),false);expectTdsSilent(child.data);
    }else{
      assert.equal(child.data._studio_ba_mode,'simple');assert.equal(child.data._jour_1,days[index]);assert.equal(child.data._heure_1,'20h35');
      for(const field of ['_jour_2','_heure_2','_jour_3','_heure_3'])assert.equal(child.data[field],'');
      expectSilent(child.data);
    }
    assert.deepEqual(child.announcement,{key:keys[index],day:days[index],time:index===4?'':'20:35',format:'tv',voice:{mode:'pending',status:'pending'}});
    assert.ok(child.label.trim());assert.ok(child.title.trim());assert.ok(child.title.length<=120);
  });
  assert.deepEqual(input,before);
  assert.deepEqual(selections,keys.map(key=>announcement(key)));
});

for(const day of weekdays)test(`day-time accepts explicit ${day} and canonical inherited lowercase day`,()=>{
  for(const selected of [announcement('day-time',{day}),announcement('day-time')]){
    const child=deriveProjects(source({_jour_1:day.toLocaleLowerCase('fr-FR')}),[],'',[selected])[0];
    assert.equal(child.data._jour_1,day);
    assert.equal(child.announcement?.day,day);
  }
});

test('day-time refuses a relative or missing source day unless a canonical day is explicitly supplied',()=>{
  for(const day of ['Ce soir','Demain','Aujourd’hui','Tout de suite','', 'Ce lundi']){
    assert.throws(()=>deriveProjects(source({_jour_1:day}),[],'',[announcement('day-time')]),day);
    assert.equal(deriveProjects(source({_jour_1:day}),[],'',[announcement('day-time',{day:'Mardi'})])[0].data._jour_1,'Mardi');
  }
});

test('omitted time is normalized from the source while explicit time is preserved',()=>{
  for(const [sourceTime,canonical] of [['20h35','20:35'],['08:15','08:15'],['8h05','08:05']] as const){
    const child=deriveProjects(source({_heure_1:sourceTime}),[],'',[announcement('tomorrow')])[0];
    assert.equal(child.announcement?.time,canonical);
    assert.equal(child.data._heure_1,canonical.replace(':','h'));
  }
  for(const time of ['00:00','23:59']){
    const child=deriveProjects(source(),[],'',[announcement('tonight',{time})])[0];
    assert.equal(child.announcement?.time,time);
    assert.equal(child.data._heure_1,time.replace(':','h'));
  }
});

test('an explicitly empty optional time stays empty for every announcement, without inheriting an old hour',()=>{
  for(const key of keys){
    const selections=[announcement(key,{time:''})];
    assert.equal(derivationRequestSchema.safeParse(request(selections)).success,true);
    const child=deriveProjects(source(),[],'',selections)[0];
    if(key==='now')assert.equal(Object.hasOwn(child.data,'_heure_1'),false);else assert.equal(child.data._heure_1,'');
    assert.equal(child.announcement?.time,'');
    assert.doesNotMatch(child.title,/20:35|00:00/);
  }
});

test('an omitted time inherits an empty source hour without inventing zero or a schedule',()=>{
  for(const key of keys){
    const child=deriveProjects(source({_heure_1:''}),[],'',[announcement(key)])[0];
    if(key==='now')assert.equal(Object.hasOwn(child.data,'_heure_1'),false);else assert.equal(child.data._heure_1,'');
    assert.equal(child.announcement?.time,'');
  }
});

test('omitted malformed source time is rejected instead of inventing a schedule',()=>{
  for(const time of ['25h00','20h99','demain soir'])assert.throws(()=>deriveProjects(source({_heure_1:time}),[],'',[announcement('tomorrow')]),time);
});

test('now ignores a former source time but rejects a newly supplied nonempty time',()=>{
  for(const selected of [announcement('now'),announcement('now',{time:''})]){
    const child=deriveProjects(source({_heure_1:'20h35'}),[],'',[selected])[0];
    assert.equal(Object.hasOwn(child.data,'_heure_1'),false);assert.equal(child.announcement?.time,'');
  }
  const invalid=[announcement('now',{time:'20:35'})];
  assert.equal(derivationRequestSchema.safeParse(request(invalid)).success,false);
  assert.throws(deriveInvalid(invalid));
});

test('one announcement expands once per selected format without changing selection order',()=>{
  const children=deriveProjects(source(),[],'',[announcement('today',{formats:['vertical','tv','portrait']})]);
  assert.deepEqual(children.map(child=>child.data._studio_format),['vertical','tv','portrait']);
  assert.deepEqual(children.map(child=>child.announcement?.format),['vertical','tv','portrait']);
  assert.equal(new Set(children.map(child=>child.targetKey)).size,3);
  assert.ok(children.every(child=>child.announcement?.key==='today'));
});

test('eight counts expanded announcement formats and classic targets together, and nine is rejected',()=>{
  const selections=[announcement('day-time',{formats:[...formats]}),announcement('tomorrow',{formats:[...formats]})];
  assert.equal(deriveProjects(source(),['ba-portrait','ba-vertical'],'',selections).length,8);
  assert.equal(derivationRequestSchema.safeParse(request(selections,['ba-portrait','ba-vertical'])).success,true);
  assert.throws(()=>deriveProjects(source(),['ba-portrait','ba-vertical','popup-1'],'',selections));
  assert.equal(derivationRequestSchema.safeParse(request(selections,['ba-portrait','ba-vertical','popup-1'])).success,false);
});

test('announcement-only requests and legacy target-only requests remain valid, but an empty batch does not',()=>{
  assert.equal(derivationRequestSchema.safeParse(request([announcement('today')])).success,true);
  const legacy=request(undefined,['ba-vertical']);delete (legacy as {announcements?:unknown}).announcements;
  assert.equal(derivationRequestSchema.safeParse(legacy).success,true);
  assert.equal(deriveProjects(source(),['ba-vertical']).length,1);
  assert.equal(derivationRequestSchema.safeParse(request([])).success,false);
  assert.throws(()=>deriveProjects(source(),[],'',[]));
});

test('five unique keys are accepted and duplicates are rejected even when their formats differ',()=>{
  assert.equal(derivationRequestSchema.safeParse(request(keys.map(key=>announcement(key)))).success,true);
  const duplicate=[announcement('today'),announcement('today',{formats:['portrait']})];
  assert.equal(derivationRequestSchema.safeParse(request(duplicate)).success,false);
  assert.throws(deriveInvalid(duplicate));
  const six=[...keys.map(key=>announcement(key)),announcement('tomorrow',{formats:['portrait']})];
  assert.equal(derivationRequestSchema.safeParse(request(six)).success,false);
  assert.throws(deriveInvalid(six));
});

for(const invalid of [[],['tv','tv'],['square'],['tv','portrait','vertical','tv']])test(`formats refuse ${JSON.stringify(invalid)}`,()=>{
  const selections=[{...announcement('today'),formats:invalid}];
  assert.equal(derivationRequestSchema.safeParse(request(selections)).success,false);
  assert.throws(deriveInvalid(selections));
});

for(const time of ['8:05','08h05','24:00','20:60','20:30:00',' 20:30','20:30 ','tomorrow'])test(`strict announcement time refuses ${JSON.stringify(time)}`,()=>{
  const selections=[{...announcement('tomorrow'),time}];
  assert.equal(derivationRequestSchema.safeParse(request(selections)).success,false);
  assert.throws(deriveInvalid(selections));
});

test('announcement keys and canonical day choices cannot be supplied from an arbitrary string or object',()=>{
  const invalid=[
    {...announcement('today'),key:'yesterday'},
    {...announcement('today'),key:'constructor'},
    {...announcement('today'),key:'__proto__'},
    {...announcement('day-time'),day:'Ce soir'},
    {...announcement('day-time'),day:'Funday'},
    {...announcement('day-time'),day:1},
  ];
  for(const selection of invalid){assert.equal(derivationRequestSchema.safeParse(request([selection])).success,false);assert.throws(deriveInvalid([selection]));}
});

test('none is explicitly silent and a pinned profile is pending, never replaced with old source audio in preview',()=>{
  const selections=[announcement('today',{voice:{mode:'none'}}),announcement('tomorrow',{voice:{mode:'profile',profileId,revision:7}})];
  const input=source({_audio_voice_enabled:true,_audio_voice_gain:.73,_audio_voice_in_seconds:3.2,_audio_voice_out_seconds:5.36});
  const children=deriveProjects(input,[],'',selections);
  assert.deepEqual(children[0].announcement?.voice,{mode:'none',status:'none'});
  assert.deepEqual(children[1].announcement?.voice,{mode:'profile',status:'pending',profileId,revision:7});
  for(const child of children){expectSilent(child.data);assert.equal(child.data._audio_voice_gain,.73);}
});

test('voice profile schema refuses malformed pins and caller-forged resolution state',()=>{
  const invalid=[
    {mode:'profile',profileId:'not-a-uuid',revision:1},
    {mode:'profile',profileId,revision:0},
    {mode:'profile',profileId,revision:1.5},
    {mode:'profile',profileId,revision:'1'},
    {mode:'profile',profileId},
    {mode:'profile',profileId,revision:1,status:'resolved'},
    {mode:'profile',profileId,revision:1,source:{url:'/api/graphics/media/forged/content'}},
    {mode:'pending',profileId,revision:1},
    {mode:'none',revision:1},
    {mode:'inherit'},
  ];
  for(const voice of invalid){const selections=[{...announcement('today'),voice}];assert.equal(derivationRequestSchema.safeParse(request(selections)).success,false);assert.throws(deriveInvalid(selections));}
});

test('unknown own fields, including prototype-shaped keys, are rejected rather than silently stripped',()=>{
  for(const key of ['untrusted','constructor','toString','__proto__']){
    const selection=ownProperty(announcement('today'),key,{polluted:true});
    assert.equal(derivationRequestSchema.safeParse(request([selection])).success,false,`announcement.${key}`);
    assert.throws(deriveInvalid([selection]),`announcement.${key}`);
    const voice=ownProperty({mode:'pending'},key,{polluted:true});
    assert.equal(derivationRequestSchema.safeParse(request([{...announcement('today'),voice}])).success,false,`voice.${key}`);
    assert.throws(deriveInvalid([{...announcement('today'),voice}]),`voice.${key}`);
    assert.equal(derivationRequestSchema.safeParse(ownProperty(request([announcement('today')]),key,{})).success,false,`request.${key}`);
  }
  assert.equal(Object.hasOwn(Object.prototype,'polluted'),false);
});

test('unknown source own keys remain rejected before announcement mapping',()=>{
  for(const key of ['untrusted','constructor','__proto__']){
    const input=source();input.data=ownProperty(input.data,key,'forged') as ProjectData;
    assert.throws(()=>deriveProjects(input,[],'',[announcement('today')]));
  }
});

test('announcements preserve every unrelated source setting, media descriptor, cut, music and commentary',()=>{
  const local={url:`local-media:${'a'.repeat(64)}:1200`,name:'Commentaire et programme.mp4',mimeType:'video/mp4'};
  const bed={url:'/api/graphics/media/00000000-0000-4000-8000-000000000042/content',name:'Musique.wav',mimeType:'audio/wav'};
  const input=source({_studio_format:'tv',_media_body_url:local,_media_body_sequence:JSON.stringify([{url:local,start:2.04,end:5.28},{url:local,start:11.16,end:14.44}]),
    _media_body_audio_enabled:true,_media_body_volume:.67,_media_body_rate:.5,_audio_bed_url:bed,_audio_bed_gain:.8,_audio_voice_gain:.63,
    _audio_voice_intro_offset_seconds:1.92,_audio_voice_outro_offset_seconds:68.48,_out_mode:'duration',_out_duration_seconds:24,
    _sponsor_visible:true,_sponsor_original:false,_sponsor_url:'lib/media/sponsor.png',_studio_typography:JSON.stringify({'tv:_titre_ligne_1':{x:12,y:-18,font:'suisse',size:85}}),
  });
  const before=structuredClone(input),changed=new Set(['_studio_ba_mode','_studio_format','_jour_1','_heure_1','_jour_2','_heure_2','_jour_3','_heure_3','_audio_voice_enabled','_audio_voice_url','_audio_voice_in_seconds','_audio_voice_out_seconds']);
  const children=deriveProjects(input,[],'',keys.filter(key=>key!=='now').map(key=>announcement(key)));
  for(const child of children)for(const [key,value] of Object.entries(input.data))if(!changed.has(key))assert.deepEqual(child.data[key],value,`${child.announcement?.key}: ${key}`);
  assert.deepEqual(input,before);
  (children[0].data._media_body_url as typeof local).name='Une retouche de la première sortie';
  assert.deepEqual(input,before);
  assert.deepEqual(children[1].data._media_body_url,local);
});

test('now uses the dedicated TDS engine, carries the programme body and never creates an appointment hour',()=>{
  const input=source({_media_body_audio_enabled:true,_media_body_url:'lib/media/programme.mp4',_media_body_start_seconds:4,_media_body_end_seconds:18});
  for(const format of formats){
    const child=deriveProjects(input,[],'',[announcement('now',{formats:[format],voice:{mode:'none'}})])[0];
    assert.equal(child.templateId,'BTV_BA_TDS');
    assert.notEqual(child.targetKey,'tds');
    assert.equal(child.data._studio_format,format);
    assert.equal(Object.hasOwn(child.data,'_jour_1'),false);assert.equal(Object.hasOwn(child.data,'_heure_1'),false);
    assert.equal(child.data._media_background_url,'/library/v1.7.0/BTV_BA_1P/lib/media/programme.mp4');
    assert.equal(child.data._media_background_start_seconds,4);assert.equal(child.data._media_background_end_seconds,18);
    assert.equal(child.data._media_background_audio_enabled,false);
    assert.equal(child.data._titre_ligne_1,'LE GRAND');assert.equal(child.data._titre_ligne_2,'ENTRETIEN');assert.equal(child.data._titre_ligne_3,'SPÉCIAL');
    assert.equal(child.data._audio_voice_enabled,false);assert.equal(child.data._audio_voice_url,'');
    assert.equal(child.announcement?.day,'Tout de suite');assert.equal(child.announcement?.time,'');
  }
});

test('mixing classic and announcement outputs does not silence or relabel the classic source clone',()=>{
  const input=source({_audio_voice_enabled:true}),children=deriveProjects(input,['ba-vertical'],'',[announcement('today')]);
  const classic=children.find(child=>child.targetKey==='ba-vertical')!;
  assert.ok(classic);assert.equal(classic.announcement,undefined);
  assert.equal(classic.data._audio_voice_enabled,true);assert.equal(classic.data._jour_1,'Lundi');
  assert.deepEqual(classic.data,{...input.data,_studio_format:'vertical'});
  expectSilent(children.find(child=>child.announcement?.key==='today')!.data);
});

test('the neutral disabled voice range passes the frozen audio plan without altering bed insertions',async()=>{
  const {AUDIO_DEFAULTS,audioPlan}=await import(new URL('../public/library/v1.7.0/BTV_BA_1P/audio.mjs',import.meta.url).href);
  const baseline=audioPlan(AUDIO_DEFAULTS);
  for(const child of deriveProjects(source(),[],'',keys.filter(key=>key!=='now').map(key=>announcement(key)))){
    expectSilent(child.data);
    const plan=audioPlan({...AUDIO_DEFAULTS,...child.data});
    assert.deepEqual(plan.bed,baseline.bed);
    assert.deepEqual(plan.voice.map((insertion:{mainIn:number;sourceIn:number;sourceOut:number})=>({mainIn:insertion.mainIn,sourceIn:insertion.sourceIn,sourceOut:insertion.sourceOut})),[
      {mainIn:1.92,sourceIn:0,sourceOut:.04},{mainIn:68.48,sourceIn:0,sourceOut:.04},
    ]);
  }
  assert.throws(()=>audioPlan({...AUDIO_DEFAULTS,_audio_voice_enabled:false,_audio_voice_in_seconds:0,_audio_voice_out_seconds:0}));
});
