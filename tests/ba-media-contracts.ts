import {getTemplate,templateDefaults} from '../src/studio/domain';
import {installBAMediaReadiness} from '../src/studio/media-readiness';
import {liveSocialPictures,type PictureCache} from '../src/studio/social-renderer';
const assert=(value:unknown,message:string)=>{if(!value)throw Error(message);};
export async function baMediaContracts(signal:AbortSignal){
  const t=getTemplate('BTV_BA_1P'),base=new URL(t.module,location.href).href;
  await installBAMediaReadiness(t);
  const {MediaEngine}=await import(/* @vite-ignore */new URL('media.mjs',base).href);
  const source='/library/v1.7.0/BTV_BA_1P/lib/media/programme.mp4';
  const config={...templateDefaults(t),_media_body_sequence:JSON.stringify([0,10,20,30].map(start=>({url:source,start,end:start+1}))),_media_body_loop:true};
  const engine=new MediaEngine({baseUrl:base}),results=[];
  try{
    await engine.prepare(config,{signal});
    assert(engine.tracks.body.clips.filter((c:any)=>c.node).length===2,'Unbounded initial video decoders');
    for(const time of [0,1.2,2.2,3.2,4.2]){
      await engine.position('body',time,{exact:true});const current=engine.node('body');
      assert(current.readyState>=2&&!current.seeking,'Video not ready after exact position');
      assert(engine.tracks.body.clips.filter((c:any)=>c.node).length<=2,'Unbounded playback decoders');
    }
    results.push({case:'four clips, loop, exact seek, two resident decoders',pass:true});
    const cache:PictureCache=new Map(),track=engine.tracks.body;
    const picture=liveSocialPictures({body:track},{body:4.2},cache).body;
    assert(picture instanceof HTMLCanvasElement,'Complete preview picture absent');
    const clip=track.clips[0],node=clip.node;clip.node=null;
    assert(liveSocialPictures({body:track},{body:4.2},cache).body===picture,'Last picture lost between clips');clip.node=node;
    cache.clear();assert(cache.size===0,'Frame cache not clearable');
    results.push({case:'hold a complete picture during decoder handover',pass:true});
  }finally{engine.dispose();}
  for(const [label,overrides]of [
    ['invalid IN',{_media_body_start_seconds:86000,_media_body_end_seconds:0}],
    ['invalid OUT',{_media_body_start_seconds:10,_media_body_end_seconds:2}],
    ['too many clips',{_media_body_sequence:JSON.stringify(Array.from({length:21},()=>({url:source,start:0,end:1})))}],
  ] as const){
    const invalid=new MediaEngine({baseUrl:base});let failed=false;
    try{await invalid.prepare({...templateDefaults(t),...overrides},{signal});}catch{failed=true;}finally{invalid.dispose();}
    assert(failed,'Invalid case was accepted: '+label);results.push({case:label,pass:true});
  }
  const cancelled=new MediaEngine({baseUrl:base}),abort=new AbortController();abort.abort();let rejected=false;
  try{await cancelled.prepare(templateDefaults(t),{signal:abort.signal});}catch{rejected=true;}finally{cancelled.dispose();}
  assert(rejected,'Cancelled load was accepted');results.push({case:'cancelled preparation',pass:true});return results;
}
