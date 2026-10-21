import {SubjectTracker} from './subject-tracker';
import type {GrayFrame,SubjectBox} from './subject-tracker';
let tracker:SubjectTracker|undefined;
self.onmessage=(event:MessageEvent<{id:number;frame:GrayFrame;box?:SubjectBox}>)=>{
 const {id,frame,box}=event.data;
 try{if(box){tracker=new SubjectTracker(frame,box);self.postMessage({id,box,confidence:1,stopped:false});}
 else{if(!tracker)throw Error('Choisissez d’abord le sujet.');self.postMessage({id,...tracker.next(frame)});}}
 catch(error){self.postMessage({id,error:error instanceof Error?error.message:String(error)});}
};
