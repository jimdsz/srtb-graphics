import {TeamMediaMatcher} from './planner-team-search';
import type {DirectoryIndex,PlannerRecord,PlannerRow,ProgrammeRule} from './day-planner-model';
type SearchMessage={id:number}&({type:'init';rows:PlannerRow[];rules:PlannerRecord<ProgrammeRule>[]}|
 {type:'directory';directory:PlannerRecord<DirectoryIndex>}|{type:'result';complete:boolean});
let matcher:TeamMediaMatcher|undefined;
self.onmessage=(event:MessageEvent<SearchMessage>)=>{
 const m=event.data;
 try{
  if(m.type==='init')matcher=new TeamMediaMatcher(m.rows,m.rules);
  else if(!matcher)throw Error('Recherche non initialisée.');
  else if(m.type==='directory')matcher.add(m.directory);
  self.postMessage({id:m.id,...(m.type==='result'?{proposals:matcher!.result(m.complete)}:{})});
 }catch(error){self.postMessage({id:m.id,error:error instanceof Error?error.message:'Recherche impossible.'});}
};
