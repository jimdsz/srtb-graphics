import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {getTemplate} from '../src/studio/domain';
import type {Project,ProjectData} from '../src/studio/domain';
import {bindLocalFile,resolveLocalData} from '../src/studio/local-media';
import {prepareGraphic} from '../src/studio/video/engine';
import TypographySettings from '../src/studio/TypographySettings';
import {measureWeeklyTitleFit} from '../src/studio/weekly-title-measure';
import {applyWeeklyTitleFit} from '../src/studio/weekly-title-fit';
import {currentStyle} from '../src/studio/typography-model';
import {fontFamily} from '../src/studio/typography-fonts';
import {weeklyTitleFitRequest} from '../src/studio/weekly-title-fit';

const run=document.querySelector<HTMLButtonElement>('#run')!,cancel=document.querySelector<HTMLButtonElement>('#cancel')!,render=document.querySelector<HTMLButtonElement>('#render')!,status=document.querySelector('#status')!,result=document.querySelector('#result')!,frames=document.querySelector('#frames')!;
const projectIds=['42df8b4a-f8d5-4138-bd07-e551024861d0','aa3f3652-46c1-450c-81d1-d2b32c1c7fed','6cf9b7ca-0e7e-44c0-af8a-97f2cb5167ef'];
const centres=[4.96,7.36,9.76,12.16,14.56,16.96,19.36];
const longTitle='LES GRANDES HISTOIRES DU MONDE ET LES CULTURES, LES TRADITIONS, LES RENCONTRES ET LES VOYAGES A TRAVERS LE CONTINENT AFRICAIN';
let controller:AbortController|undefined,draft:ProjectData|undefined;
const template=getTemplate('BTV_Semainier');
function ensure(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
async function getProject(id:string):Promise<Project>{const response=await fetch(`/api/graphics/projects/${id}`);ensure(response.ok,`Projet local ${response.status}`);return response.json();}
async function save(name:string,body:BodyInit){ensure((await fetch(`/__video-evidence/${name}`,{method:'POST',body})).ok,'Écriture du témoin impossible');}
function picture(frame:CanvasImageSource,label:string){const canvas=document.createElement('canvas');canvas.width=480;canvas.height=Math.round(480*(frame as HTMLCanvasElement).height/(frame as HTMLCanvasElement).width);canvas.getContext('2d')!.drawImage(frame,0,0,canvas.width,canvas.height);const fig=document.createElement('figure'),img=new Image(),caption=document.createElement('figcaption');img.src=canvas.toDataURL();img.alt=label;caption.textContent=label;fig.append(img,caption);frames.append(fig);return canvas;}
function region(frame:CanvasImageSource){const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;const c=canvas.getContext('2d',{willReadFrequently:true})!;c.drawImage(frame,0,0,160,90);return c.getImageData(70,4,20,30).data;}
const difference=(a:Uint8ClampedArray,b:Uint8ClampedArray)=>a.reduce((n,v,i)=>n+Math.abs(v-b[i]),0)/a.length;
async function titleFrame(data:ProjectData,label:string,signal:AbortSignal){const prepared=await prepareGraphic(template,resolveLocalData(template,data),23.32,false,signal);try{const frame=await prepared.frame(129,null),boxes=prepared.graphic.__typography?.boxes().filter((box:{field:string})=>box.field==='programme_1_title');ensure(boxes?.length===1,'Une zone de titre visible attendue');const png=await new Promise<Blob>(resolve=>frame.toBlob(blob=>resolve(blob!)));picture(frame,label);return {boxes,png};}finally{await prepared.dispose();}}
function Editor({initial}:{initial:ProjectData}){const [data,setData]=useState(initial);draft=data;return <><TypographySettings template={template} data={data} disabled={false} selectedElement={undefined} onChange={patch=>setData(previous=>({...previous,...patch}))}/><pre>{JSON.stringify({field:'programme_1_title',title:data.programme_1_title,style:currentStyle(data,'programme_1_title')??null},null,2)}</pre></>;}
document.querySelector<HTMLButtonElement>('#metrics')!.onclick=()=>{if(!draft)return;const request=weeklyTitleFitRequest(template,draft,'programme_1_title')!,svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),text=document.createElementNS(svg.namespaceURI,'text') as SVGTextElement,span=document.createElementNS(svg.namespaceURI,'tspan');svg.style.cssText='position:fixed;left:-10000px;width:1px;height:1px;overflow:visible';text.setAttribute('font-family',fontFamily(request.style.font,true));text.setAttribute('text-anchor','end');text.setAttribute('font-weight','400');text.setAttribute('font-style','normal');text.setAttribute('letter-spacing','0');text.setAttribute('xml:space','preserve');span.setAttribute('x','0');span.setAttribute('y','0');span.textContent=request.text;text.append(span);svg.append(text);document.body.append(svg);try{document.querySelector('#draft-state')!.textContent=JSON.stringify([100,57,10].map(size=>{text.setAttribute('font-size',String(41*size/100));const b=text.getBBox();return{size,x:b.x,y:b.y,width:b.width,height:b.height,right:b.x+b.width};}),null,2);}finally{svg.remove();}};
render.onclick=async()=>{if(!draft)return;render.disabled=true;const stamp=Date.now();try{const proof=await titleFrame(draft,'Brouillon après commande utilisateur',new AbortController().signal);document.querySelector('#draft-state')!.textContent=JSON.stringify({title:draft.programme_1_title,style:currentStyle(draft,'programme_1_title')??null,boxes:proof.boxes},null,2);await save(`weekly-editor-${stamp}.png`,proof.png);}catch(error){document.querySelector('#draft-state')!.textContent=String(error);}finally{render.disabled=false;}};
cancel.onclick=()=>controller?.abort();
run.onclick=async()=>{
 run.disabled=true;cancel.disabled=false;controller=new AbortController();const signal=controller.signal,stamp=Date.now(),records:unknown[]=[],timer=setTimeout(()=>controller?.abort(),180000);frames.replaceChildren();
 try{
  ensure(location.origin==='http://127.0.0.1:5192','Recette locale uniquement');
  for(let i=1;i<=7;i++){status.textContent=`Lecture du témoin ${i}/7`;const response=await fetch(`/tests/fixtures/weekly-witnesses-v2/media-${i}.mp4`,{signal});ensure(response.ok,'Témoin absent');await bindLocalFile(new File([await response.blob()],`media-${i}.mp4`,{type:'video/mp4'}),()=>{},undefined,undefined,signal);}
  const projects=await Promise.all(projectIds.map(getProject)),original=projects[0],longData={...original.data,programme_1_title:longTitle};
  status.textContent='Comparaison du titre long avant et après proposition';
  const before=await titleFrame(longData,'Titre long — avant proposition',signal),proposal=await measureWeeklyTitleFit(template,longData,'programme_1_title');ensure(proposal.kind==='resize','Réduction proposée attendue');
  const adjusted={...longData,...applyWeeklyTitleFit(template,longData,'programme_1_title',proposal)},after=await titleFrame(adjusted,'Titre long — proposition appliquée',signal);
  ensure(before.boxes[0].x<0,'Débordement initial non reproduit');ensure(after.boxes[0].x>=119/1920-.002&&after.boxes[0].x+after.boxes[0].width<=1802/1920+.002,'Titre corrigé hors zone');
  await save(`weekly-title-${stamp}-before.png`,before.png);await save(`weekly-title-${stamp}-after.png`,after.png);records.push({kind:'title-fit',proposal,before:before.boxes,after:after.boxes});
  for(const project of projects){
   const short={...project.data};for(let i=1;i<=7;i++){short[`_media_programme_${i}_start_seconds`]=1;short[`_media_programme_${i}_end_seconds`]=1.4;}
   const prepared=await prepareGraphic(template,resolveLocalData(template,short),23.32,false,signal);
   try{for(let i=0;i<7;i++){
    status.textContent=`Extrait court · ${short._studio_format} · programme ${i+1}/7`;let previous:Uint8ClampedArray|undefined;
    for(const seconds of [centres[i]-.2,centres[i]+.2]){signal.throwIfAborted();const frame=await prepared.frame(Math.round(seconds*25),null),pixels=region(frame),delta=previous?difference(previous,pixels):null,track=prepared.tracks[`programme_${i+1}`],node=track.clips[0].node as HTMLVideoElement;
     if(short._studio_format==='tv')ensure(Math.abs(node.currentTime-1.36)<.002,`Mauvaise fin tenue : ${node.currentTime}`);
     ensure(delta===null||delta<.2,`Le média tenu bouge : ${short._studio_format} P${i+1}: ${delta}`);
     records.push({kind:'short-excerpt',format:short._studio_format,slot:i+1,seconds,heldSource:short._studio_format==='tv'?node.currentTime:null,regionDifference:delta});previous=pixels;
    }
   }}finally{await prepared.dispose();}
   const reloaded=await getProject(project.id);ensure(reloaded.revision===project.revision&&JSON.stringify(reloaded.data)===JSON.stringify(project.data),'Projet original modifié');
  }
  createRoot(document.querySelector('#editor')!).render(<Editor initial={longData}/>);render.disabled=false;
  const report={status:'PASS',scope:'Rendu déterministe local avant encodage; aucun test Mac ou temps réel',records};result.textContent=JSON.stringify(report,null,2);await save(`weekly-edge-cases-${stamp}.json`,JSON.stringify(report,null,2));status.textContent='PASS — titre long ajustable et 42 images d’extraits courts tenues.';
 }catch(error){status.textContent='FAIL — '+String(error);result.textContent=JSON.stringify({records,error:String(error)},null,2);}finally{clearTimeout(timer);controller=undefined;run.disabled=false;cancel.disabled=true;}
};
