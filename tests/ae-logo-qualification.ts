import {installAELogoCompositing,installAELogoCompatibility} from '../src/studio/ae-logo-compatibility';
import {qualifiedLogoDifference,logoProofFrames} from './ae-logo-proof';
const NS='http://www.w3.org/2000/svg',result=document.querySelector('#result')!,scenes=document.querySelector('#scenes')!;
const graphics:any[]=[];
const importer=(url:string)=>import(/* @vite-ignore */url);
function assert(condition:unknown,message:string){if(!condition)throw Error(message);}
async function pixels(svg:SVGSVGElement){
  const clone=svg.cloneNode(true) as SVGSVGElement;clone.setAttribute('xmlns',NS);clone.setAttribute('width','1920');clone.setAttribute('height','1080');
  const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)],{type:'image/svg+xml'}));
  try{const image=new Image();image.src=url;await image.decode();const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;const context=canvas.getContext('2d',{willReadFrequently:true})!;context.drawImage(image,0,0);return context.getImageData(0,0,1920,1080).data;}finally{URL.revokeObjectURL(url);}
}
function difference(a:Uint8ClampedArray,b:Uint8ClampedArray){
  let changed=0,total=0,max=0,alphaChanged=0,alphaMax=0,premultipliedTotal=0,premultipliedMax=0,interiorChanged=0,offContourChanged=0;
  const bounds=[1920,1080,-1,-1];
  for(let i=0;i<a.length;i+=4){
    const alpha=Math.abs(a[i+3]-b[i+3]);alphaMax=Math.max(alphaMax,alpha);if(alpha>8)alphaChanged++;
    let significant=false;
    for(let c=0;c<4;c++){const d=Math.abs(a[i+c]-b[i+c]);total+=d;max=Math.max(max,d);if(d>8)changed++;const weighted=c===3?alpha:Math.abs(a[i+c]*a[i+3]/255-b[i+c]*b[i+3]/255);premultipliedTotal+=weighted;premultipliedMax=Math.max(premultipliedMax,weighted);if(weighted>8)significant=true;}
    if(significant){
      const pixel=i/4,x=pixel%1920,y=Math.floor(pixel/1920);bounds[0]=Math.min(bounds[0],x);bounds[1]=Math.min(bounds[1],y);bounds[2]=Math.max(bounds[2],x);bounds[3]=Math.max(bounds[3],y);
      if(a[i+3]>250&&b[i+3]>250)interiorChanged++;
      // A cut polygon and a subtract-mask can differ on a raster edge. Require
      // that edge to exist in the reference, not merely in the candidate.
      let contour=false;const centre=a[i+3];
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(x+dx<0||x+dx>=1920||y+dy<0||y+dy>=1080)continue;const adjacent=a[((y+dy)*1920+x+dx)*4+3];if(adjacent!==centre||adjacent>0&&adjacent<255)contour=true;}
      if(!contour)offContourChanged++;
    }
  }
  return {changed,mean:total/a.length,max,alphaChanged,alphaMax,premultipliedMean:premultipliedTotal/a.length,premultipliedMax,interiorChanged,offContourChanged,bounds:bounds[2]===-1?null:bounds};
}
function coverage(pixels:Uint8ClampedArray){let count=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]>8)count++;return count;}
async function logoReference(composition:string){
  const [{default:lottie},{installLogoCompositing},{repairAEMergePaths}]=await Promise.all([importer('/library/v1.7.0/BTV_Evenement/lib/lottie-web.esm.mjs'),importer('/library/v1.7.0/BTV_BA_1P/logo-compositing.mjs'),importer('/library/v1.7.0/_shared/ae-live-media.mjs')]);
  const source=await (await fetch('/library/v1.7.0/BTV_Semainier/source/animation.json')).json(),comp=source.assets.find((a:any)=>a.nm===composition);
  const original={v:source.v,fr:25,ip:0,op:80,w:1920,h:1080,assets:[comp],layers:[{ddd:0,ind:1,ty:0,nm:'logo',refId:comp.id,w:1920,h:1080,ks:{o:{a:0,k:100},r:{a:0,k:0},p:{a:0,k:[0,0,0]},a:{a:0,k:[0,0,0]},s:{a:0,k:[100,100,100]}},ip:0,op:80,st:0,sr:1}]};
  const animations=[];
  try{
    for(const mode of ['reference','adapted']){const container=document.createElement('div');document.querySelector('#isolated')!.append(container);const animation=lottie.loadAnimation({container,renderer:'svg',autoplay:false,loop:false,animationData:mode==='reference'?structuredClone(original):repairAEMergePaths(structuredClone(original))});animations.push(animation);await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Logo isolé indisponible')),15000);animation.addEventListener('DOMLoaded',()=>{clearTimeout(timeout);resolve();});});animation.setSubframe(false);if(mode==='reference')installLogoCompositing(animation);else installAELogoCompositing(animation);}
    const comparisons=[];
    for(const frame of logoProofFrames){
      result.textContent=`${composition} · image ${frame+1}/${logoProofFrames.length}`;
      for(const animation of animations)animation.goToAndStop(frame,true);
      const [a,b]=await Promise.all(animations.map(a=>pixels(a.renderer.svgElement)));
      const delta=difference(a,b),alphaPixels=coverage(a);comparisons.push({composition,frame,alphaPixels,...delta});
      assert(alphaPixels>1000,'Référence raster vide, frame '+frame);
    }
    return comparisons;
  }finally{for(const animation of animations)animation.destroy();document.querySelector('#isolated')!.replaceChildren();}
}
document.querySelector<HTMLButtonElement>('#run')!.onclick=async()=>{
  const button=document.querySelector<HTMLButtonElement>('#run')!;button.disabled=true;result.textContent='Chargement et contrôle…';
  try{
    for(const g of graphics)await g.dispose();graphics.length=0;scenes.replaceChildren();
    const records=[];
    for(const [id,time]of [['BTV_Evenement',10.68],['BTV_Semainier',5.16]] as const){
      const base=`/library/v1.7.0/${id}/`,module=base+'graphic-v2.mjs';
      const [{default:Graphic},{DEFAULTS}]=await Promise.all([importer(module),importer(base+'config.mjs')]);
      const tag=id.toLowerCase().replaceAll('_','-')+'-logo';if(!customElements.get(tag))customElements.define(tag,Graphic);
      const title=document.createElement('h2');title.textContent=id+' · '+time+' s';scenes.append(title);const pair=document.createElement('div');pair.className='pair';scenes.append(pair);
      for(const adapted of [false,true]){
        const section=document.createElement('section'),label=document.createElement('h3'),host=document.createElement('div');label.textContent=adapted?'Après — opérations natives rétablies':'Avant — moteur AE actuel';host.className='scene';section.append(label,host);pair.append(section);
        const g=document.createElement(tag) as any;graphics.push(g);host.append(g);
        if(adapted)installAELogoCompatibility(g,{id,version:'1.0.0',libraryVersion:'1.7.0',module});
        await g.load({data:DEFAULTS,previewMuted:true});await g.goToTime({seconds:time});
        const outputs=g.shadowRoot.querySelectorAll('[data-studio-ae-logo-output]').length,animation=g.animation;
        if(adapted){assert(outputs>0,'Logo non adapté');installAELogoCompositing(animation);assert(g.shadowRoot.querySelectorAll('[data-studio-ae-logo-output]').length===outputs,'Adaptateur dupliqué');await g.updateAction({...DEFAULTS});await g.goToTime({seconds:time});assert(!animation.renderer,'Ancien moteur non libéré');assert(g.shadowRoot.querySelectorAll('[data-studio-ae-logo-output]').length===outputs,'Accumulation après modification');}
        records.push({id,time,adapted,outputs,frame:g.getStatus().frame});
      }
    }
    const reference=[...await logoReference('Anim_TV_Roll'),...await logoReference('Anim_TV_Roll_Color OUT')];
    const report={pass:reference.every(qualifiedLogoDifference),criterion:'160 poses entières ; après image 20 tous les octets RGBA identiques (max=0) ; différences précoces limitées à 1 pixel du contour de référence, sans pixels intérieurs, couverture ≤64/255, moyenne prémultipliée ≤0.01/255.',records,reference};
    result.textContent=JSON.stringify(report,null,2);
    if(location.origin==='http://127.0.0.1:5192'){
      const response=await fetch(`/__video-evidence/ae-logo-all-poses-${Date.now()}.json`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report,null,2)});
      assert(response.ok,'Mesures terminées, mais rapport local non enregistré.');
    }
  }catch(error){result.textContent=String(error instanceof Error?error.stack:error);}finally{button.disabled=false;}
};
