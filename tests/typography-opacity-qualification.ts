import {getTemplate,templateDefaults} from '../src/studio/domain';
import type {ProjectData} from '../src/studio/domain';
import {prepareGraphic} from '../src/studio/video/engine';
import {patchTextStyle} from '../src/studio/typography-model';
import {nativeLineMotion} from '../src/studio/typography-line-motion';

if(location.origin!=='http://127.0.0.1:5192')throw Error('Qualification locale uniquement.');
const button=document.querySelector<HTMLButtonElement>('#run')!,status=document.querySelector('#status')!,result=document.querySelector('#result')!,gallery=document.querySelector('#gallery')!;
const check=(ok:unknown,message:string)=>{if(!ok)throw Error(message);};
const cases=[{id:'BTV_Renvoi',variant:'1L',field:'subtitle',frames:[51,60,70]},{id:'BTV_Renvoi',variant:'2L',field:'subtitle',frames:[51,60,70]},{id:'BTV_Semainier',variant:'',field:'programme_1_title',frames:[99,108,118]}];
function copy(source:HTMLCanvasElement){const canvas=document.createElement('canvas');canvas.width=source.width;canvas.height=source.height;canvas.getContext('2d')!.drawImage(source,0,0);return canvas;}
function sourceElement(graphic:any,id:string){
  const animation=graphic.state?.animation||graphic.animation;check(animation,'Animation native indisponible.');
  const found:any[]=[];const walk=(container:any)=>{for(const item of container.elements||[]){if(!item)continue;if(item.data?.nm==='SOUSTEXTE'&&(id!=='BTV_Semainier'||item.data.ip===99))found.push(item);walk(item);}};walk(animation.renderer);
  check(found.length===1,'Sous-texte source ambigu ou absent.');return {element:found[0],animation};
}
function box(node:SVGGraphicsElement,graphic:any){const b=node.getBoundingClientRect(),host=graphic.getBoundingClientRect();return {x:(b.left-host.left)*1920/host.width,y:(b.top-host.top)*1080/host.height,width:b.width*1920/host.width,height:b.height*1080/host.height};}
function region(boxes:ReturnType<typeof box>[]){
  const left=Math.max(0,Math.floor(Math.min(...boxes.map(b=>b.x))-12)),top=Math.max(0,Math.floor(Math.min(...boxes.map(b=>b.y))-12));
  const right=Math.min(1920,Math.ceil(Math.max(...boxes.map(b=>b.x+b.width))+12)),bottom=Math.min(1080,Math.ceil(Math.max(...boxes.map(b=>b.y+b.height))+12));
  check(right>left&&bottom>top,'Zone de texte vide ou hors image.');return {x:left,y:top,width:right-left,height:bottom-top};
}
function crop(source:HTMLCanvasElement,roi:ReturnType<typeof region>){const canvas=document.createElement('canvas');canvas.width=roi.width;canvas.height=roi.height;canvas.getContext('2d')!.drawImage(source,roi.x,roi.y,roi.width,roi.height,0,0,roi.width,roi.height);return canvas;}
function compare(native:HTMLCanvasElement,styled:HTMLCanvasElement){
  const a=native.getContext('2d')!.getImageData(0,0,native.width,native.height),b=styled.getContext('2d')!.getImageData(0,0,styled.width,styled.height),diff=new ImageData(native.width,native.height);
  let rgb=0,alpha=0,maximum=0,changed=0;
  for(let i=0;i<a.data.length;i+=4){let different=false;for(let c=0;c<4;c++){const d=Math.abs(a.data[i+c]-b.data[i+c]);if(c<3)rgb+=d;else alpha+=d;maximum=Math.max(maximum,d);different||=d!==0;if(c<3)diff.data[i+c]=Math.min(255,d*8);}diff.data[i+3]=255;if(different)changed++;}
  const canvas=document.createElement('canvas');canvas.width=native.width;canvas.height=native.height;canvas.getContext('2d')!.putImageData(diff,0,0);
  return {canvas,metrics:{meanAbsoluteRgb:rgb/(native.width*native.height*3),meanAbsoluteAlpha:alpha/(native.width*native.height),maximumChannelDifference:maximum,differentPixels:changed,pixels:native.width*native.height}};
}
async function save(name:string,body:Blob|string){const response=await fetch('/__catalogue-visual-evidence/'+name,{method:'POST',headers:{'Content-Type':typeof body==='string'?'application/json':'image/png'},body});check(response.ok,'Preuve locale non enregistrée : '+name);}
async function png(name:string,canvas:HTMLCanvasElement){const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('PNG indisponible.')),'image/png'));const bytes=await blob.arrayBuffer(),sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');await save(name,blob);return {name,sha256,bytes:blob.size,width:canvas.width,height:canvas.height};}
function display(title:string,images:[string,HTMLCanvasElement][]){const section=document.createElement('section'),heading=document.createElement('h2'),pair=document.createElement('div');heading.textContent=title;pair.className='pair';for(const [label,canvas]of images){const figure=document.createElement('figure'),caption=document.createElement('figcaption');caption.textContent=label;figure.append(caption,canvas);pair.append(figure);}section.append(heading,pair);gallery.append(section);}

button.onclick=async()=>{
  button.disabled=true;gallery.replaceChildren();const stamp=Date.now(),records:any[]=[],images:Record<string,unknown>={},report:any={scope:'Native subtitle versus identical text styled white; current export compositor; descriptive pixels only',stamp,comparisonCompleted:false,pixelVerdict:'NOT_ASSIGNED',records,images};
  try{
    for(const item of cases){
      status.textContent=`${item.id} ${item.variant} : préparation du natif et de la couleur Blanc…`;
      const template=getTemplate(item.id),data:ProjectData={...templateDefaults(template),_studio_format:'tv'};for(const key of Object.keys(data))if(key.startsWith('_media_')&&key.endsWith('_url'))data[key]='';
      if(item.variant)data.variant=item.variant;
      if(item.variant==='2L'){data.title='STREET ART';data.title2='SANS FRONTIÈRES';}
      const styledData={...data,...patchTextStyle(data,item.field,{colour:'#ffffff'})},signal=new AbortController().signal;
      const native=await prepareGraphic(template,data,12,false,signal);let styled:Awaited<ReturnType<typeof prepareGraphic>>|undefined;
      try{
        styled=await prepareGraphic(template,styledData,12,false,signal);
        const n=sourceElement(native.graphic,item.id),s=sourceElement(styled.graphic,item.id);
        const overlay=styled.graphic.shadowRoot!.querySelector<SVGGElement>(`[data-studio-text-field="${item.field}"]`),text=overlay?.querySelector('text');check(overlay&&text,'Personnalisation ciblée absente.');
        for(const frame of item.frames){
          status.textContent=`${item.id} ${item.variant} : image native ${frame} (${frame/25} s)…`;
          const nativeFrame=copy(await native.frame(frame,null)),styledFrame=copy(await styled.frame(frame,null));
          check(Math.round(n.animation.currentFrame)===frame&&Math.round(s.animation.currentFrame)===frame,'Temps source inattendu.');
          const nativeMotion=nativeLineMotion(n.element,item.id),styledMotion=nativeLineMotion(s.element,item.id);check(nativeMotion&&styledMotion,'Animateur hors contrat.');
          check(nativeMotion!.opacity===styledMotion!.opacity&&nativeMotion!.y===styledMotion!.y,'La personnalisation a changé le calcul natif.');
          check(Number(text!.getAttribute('opacity'))===nativeMotion!.opacity&&text!.getAttribute('transform')===`translate(0 ${nativeMotion!.y})`,'Raccordement de révélation absent.');
          const roi=region([box(n.element.layerElement,native.graphic),box(text!,styled.graphic)]),a=crop(nativeFrame,roi),b=crop(styledFrame,roi),difference=compare(a,b);
          const prefix=`typography-opacity-${stamp}-${item.id.toLowerCase().replaceAll('_','-')}-${item.variant.toLowerCase()||'programme1'}-${frame}`;
          images[prefix+'-native']=await png(prefix+'-native.png',nativeFrame);images[prefix+'-white']=await png(prefix+'-white.png',styledFrame);images[prefix+'-difference']=await png(prefix+'-difference.png',difference.canvas);
          records.push({id:item.id,variant:item.variant,field:item.field,frame,seconds:frame/25,sourceFrame:n.animation.currentFrame,nativeMotion,styledMotion,overlay:{opacity:text!.getAttribute('opacity'),transform:text!.getAttribute('transform'),fill:text!.getAttribute('fill'),font:text!.getAttribute('font-family')},roi,...difference.metrics});
          display(`${item.id} ${item.variant} · ${frame}/25 = ${frame/25} s`,[['Natif — zone du texte',a],['Couleur Blanc — même zone',b],['Écart RGB ×8 (descriptif)',difference.canvas]]);
        }
      }finally{await styled?.dispose();await native.dispose();}
    }
    report.comparisonCompleted=true;status.textContent='9 poses comparées. Contrat du raccordement vérifié ; inspection visuelle et mesures de pixels à interpréter, sans verdict global.';
  }catch(error){report.error=error instanceof Error?error.stack:String(error);status.textContent='Comparaison interrompue : '+String(error);}
  finally{
    const name=`typography-opacity-${stamp}.json`;
    try{await save(name,JSON.stringify(report,null,2));report.localEvidence={diagnosticSaved:true,comparisonCompleted:report.comparisonCompleted,json:name};}catch(error){report.localEvidence={diagnosticSaved:false,error:String(error)};}
    result.textContent=JSON.stringify(report,null,2);button.disabled=false;
  }
};
