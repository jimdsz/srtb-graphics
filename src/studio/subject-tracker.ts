/** Lightweight, local appearance tracking. It follows a user-selected patch,
 * not an identity. Low texture, occlusion or ambiguous matches stop the proposal.
 * This deliberately does not pretend to understand editorial subject choice. */
export type SubjectBox={x:number;y:number;w:number;h:number};
export type GrayFrame={width:number;height:number;pixels:Uint8Array};
export type TrackSample={at:number;box:SubjectBox;confidence:number};
const grid=14,clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
function patch(frame:GrayFrame,box:SubjectBox){
 const values=new Float32Array(grid*grid);let sum=0,squares=0;
 for(let y=0;y<grid;y++)for(let x=0;x<grid;x++){
  const px=clamp(Math.round(box.x+(x+.5)*box.w/grid),0,frame.width-1),py=clamp(Math.round(box.y+(y+.5)*box.h/grid),0,frame.height-1);
  const v=frame.pixels[py*frame.width+px];values[y*grid+x]=v;sum+=v;squares+=v*v;
 }
 const mean=sum/values.length,energy=Math.sqrt(Math.max(0,squares-sum*mean));
 for(let i=0;i<values.length;i++)values[i]=(values[i]-mean)/(energy||1);
 return {values,contrast:energy/Math.sqrt(values.length)};
}
const correlation=(a:Float32Array,b:Float32Array)=>{let sum=0;for(let i=0;i<a.length;i++)sum+=a[i]*b[i];return sum;};
export class SubjectTracker{
 private original:Float32Array;private previous:Float32Array;private box:SubjectBox;private width:number;private height:number;
 constructor(frame:GrayFrame,box:SubjectBox){
  if(box.w<12||box.h<12||box.x<0||box.y<0||box.x+box.w>frame.width||box.y+box.h>frame.height)throw Error('Entourez une zone du sujet suffisamment grande.');
  const selected=patch(frame,box);if(selected.contrast<12)throw Error('Cette zone est trop uniforme. Choisissez un détail contrasté du sujet.');
  this.original=selected.values;this.previous=selected.values;this.box={...box};this.width=frame.width;this.height=frame.height;
 }
 next(frame:GrayFrame):{box:SubjectBox;confidence:number;stopped:boolean}{
  if(frame.width!==this.width||frame.height!==this.height)throw Error('Le format de l’image a changé.');
  const old=this.box,cx=old.x+old.w/2,cy=old.y+old.h/2,radius=Math.min(42,Math.max(18,old.w*.8));
  const candidates:{box:SubjectBox;score:number;original:number;values:Float32Array}[]=[];
  const evaluate=(dx:number,dy:number,scale:number)=>{
   const w=old.w*scale,h=old.h*scale,box={x:cx+dx-w/2,y:cy+dy-h/2,w,h};
   if(box.x<0||box.y<0||box.x+w>frame.width||box.y+h>frame.height)return;
   const p=patch(frame,box);if(p.contrast<9)return;
   const initial=correlation(this.original,p.values),recent=correlation(this.previous,p.values);
   candidates.push({box,score:recent*.7+initial*.3,original:initial,values:p.values});
  };
  for(const scale of [.96,1,1.04]){const step=scale===1?1:3;for(let dy=-Math.floor(radius);dy<=radius;dy+=step)for(let dx=-Math.floor(radius);dx<=radius;dx+=step)evaluate(dx,dy,scale);}
  candidates.sort((a,b)=>b.score-a.score);const coarse=candidates[0];
  if(!coarse)return {box:old,confidence:0,stopped:true};
  const seeds=[coarse];for(const candidate of candidates){if(seeds.length>=4)break;if(seeds.every(s=>Math.hypot(s.box.x-candidate.box.x,s.box.y-candidate.box.y)>Math.max(12,old.w*.7)))seeds.push(candidate);}
  // Refine independent peaks too: refining only the winner would miss a second
  // identical subject between coarse grid points and give false confidence.
  for(const seed of seeds){const dx=seed.box.x+seed.box.w/2-cx,dy=seed.box.y+seed.box.h/2-cy;
   for(let y=-2;y<=2;y++)for(let x=-2;x<=2;x++)evaluate(dx+x,dy+y,seed.box.w/old.w);}
  candidates.sort((a,b)=>b.score-a.score);const best=candidates[0];
  const competitor=candidates.find(c=>Math.hypot(c.box.x-best.box.x,c.box.y-best.box.y)>Math.max(12,old.w*.7));
  const ambiguous=!!competitor&&best.score-competitor.score<.07;
  if(best.score<.72||best.original<.48||ambiguous)return {box:old,confidence:best.score,stopped:true};
  this.box=best.box;this.previous=best.values;
  return {box:best.box,confidence:best.score,stopped:false};
 }
}
export function subjectCrop(box:SubjectBox,width:number,height:number,ratio:number){
 const visibleW=Math.min(width,height*ratio),visibleH=Math.min(height,width/ratio);
 return {x:width-visibleW<1?50:clamp((box.x+box.w/2-visibleW/2)/(width-visibleW)*100,0,100),y:height-visibleH<1?50:clamp((box.y+box.h/2-visibleH/2)/(height-visibleH)*100,0,100)};
}
export function subjectPoints(samples:TrackSample[],width:number,height:number,ratio:number){
 const points:{at:number;x:number;y:number;transition:'linear'}[]=[];
 const goals=samples.map(sample=>subjectCrop(sample.box,width,height,ratio));
 const visibleW=Math.min(width,height*ratio),visibleH=Math.min(height,width/ratio);
 // Analysis already has the whole excerpt: use neighbours on both sides so
 // smoothing does not lag behind a moving subject. Never run this in playback.
 const contain=(value:number,start:number,length:number,visible:number,extent:number)=>{
  const travel=extent-visible;if(travel<1)return 50;
  const margin=Math.min(visible*.08,Math.max(0,(visible-length)/2));
  const low=clamp((start+length+margin-visible)/travel*100,0,100),high=clamp((start-margin)/travel*100,0,100);
  return low<=high?clamp(value,low,high):clamp((start+length/2-visible/2)/travel*100,0,100);
 };
 for(let i=0;i<samples.length;i++){
  const sample=samples[i];let x=0,y=0,weight=0;
  for(let j=Math.max(0,i-3);j<Math.min(samples.length,i+4);j++){
   const w=Math.max(0,1-Math.abs(samples[j].at-sample.at)/.45);
   x+=goals[j].x*w;y+=goals[j].y*w;weight+=w;
  }
  const last=points.at(-1),goal={x:x/weight,y:y/weight};
  // Hold sub-pixel measurement noise, unless doing so would crop the subject.
  if(last&&Math.abs(goal.x-last.x)<.6)goal.x=last.x;
  if(last&&Math.abs(goal.y-last.y)<.6)goal.y=last.y;
  points.push({at:sample.at,x:contain(goal.x,sample.box.x,sample.box.w,visibleW,width),y:contain(goal.y,sample.box.y,sample.box.h,visibleH,height),transition:'linear'});
 }
 // Linear interpolation of the smoothed path maintains travel through each
 // measurement, unlike easing every 200 ms (which repeatedly stops the camera).
 // Keep timing endpoints and reduce redundant points to the renderer contract.
 let tolerance=.35;
 function simplify(values:typeof points):typeof points{
  if(values.length<3)return values;const a=values[0],b=values.at(-1)!;let max=0,index=0;
  for(let i=1;i<values.length-1;i++){const p=values[i],t=(p.at-a.at)/(b.at-a.at);const d=Math.hypot(p.x-a.x-(b.x-a.x)*t,p.y-a.y-(b.y-a.y)*t);if(d>max){max=d;index=i;}}
  return max>tolerance?[...simplify(values.slice(0,index+1)).slice(0,-1),...simplify(values.slice(index))]:[a,b];
 }
 let result=simplify(points);while(result.length>120){tolerance*=1.5;result=simplify(points);}return result;
}
