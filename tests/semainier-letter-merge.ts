import {getTemplate,templateDefaults} from '../src/studio/domain';
import type {ProjectData} from '../src/studio/domain';
import {prepareGraphic} from '../src/studio/video/engine';
import {FrameRaster} from '../src/studio/video/raster';
import {installAELogoCompositing} from '../src/studio/ae-logo-compatibility';
const button=document.querySelector<HTMLButtonElement>('#run')!,status=document.querySelector('#status')!,output=document.querySelector('#result')!,gallery=document.querySelector('#gallery')!;
function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const hash=async(value:string|ArrayBuffer)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):value)),n=>n.toString(16).padStart(2,'0')).join('');
async function bound<T>(promise:Promise<T>,label:string){let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' timeout')),30000);})]);}finally{clearTimeout(timer);}}
async function save(name:string,body:Blob|string){assert(location.origin==='http://127.0.0.1:5192','Local origin only');const response=await bound(fetch('/__catalogue-visual-evidence/'+name,{method:'POST',headers:{'Content-Type':typeof body==='string'?'application/json':'image/png'},body}),'Evidence');assert(response.status===201,'Evidence not saved');}
function findLetters(animation:any){const names=new Map(animation.animationData.assets.map((a:any)=>[a.id,a.nm])),items:any[]=[];const walk=(container:any,scope='')=>{for(const element of container.elements||[]){if(!element)continue;if(element.data?.nm==='é'&&['BENINTV_Roll','BTV_to_BENINTV_Gauche'].includes(scope))items.push({element,scope});walk(element,String(names.get(element.data?.refId)||''));}};walk(animation.renderer);return items;}
function invariant(svg:SVGSVGElement){const copy=svg.cloneNode(true) as SVGSVGElement;for(const node of copy.querySelectorAll('[data-studio-ae-logo-merge-paint]'))node.removeAttribute('display');return new XMLSerializer().serializeToString(copy);}
function region(frame:number){return {left:frame===640?790:200,right:frame===640?880:290,top:470,bottom:605};}
function stats(pixels:Uint8ClampedArray,frame:number){const box=region(frame);let white=0,black=0;for(let y=box.top;y<box.bottom;y++)for(let x=box.left;x<box.right;x++){const i=(y*1920+x)*4;if(pixels[i+3]>200){if(pixels[i]>240&&pixels[i+1]>240&&pixels[i+2]>240)white++;if(pixels[i]<15&&pixels[i+1]<15&&pixels[i+2]<15)black++;}}return {white,black};}
button.onclick=async()=>{
  button.disabled=true;gallery.replaceChildren();const stamp=Date.now(),rows:any[]=[],report:any={stamp,scope:'Exact pinned native Merge Add conversion; no independent Semainier AE pixel certification',userAgent:navigator.userAgent,pass:false,rows};
  const controller=new AbortController();let prepared:Awaited<ReturnType<typeof prepareGraphic>>|undefined,raster:FrameRaster|undefined;
  try{
    const template=getTemplate('BTV_Semainier'),data:ProjectData={...templateDefaults(template),_studio_format:'tv',_out_mode:'manual',_audio_enabled:false};
    for(const key of Object.keys(data))if(key.startsWith('_media_')&&key.endsWith('_url'))data[key]='';
    prepared=await bound(prepareGraphic(template,data,28,false,controller.signal),'Graphic');const g=prepared.graphic as any;
    document.querySelector('#host')!.append(g);g.pause();g.stage.style.visibility='visible';
    const animation=g.animation,adapter=installAELogoCompositing(animation);assert(adapter.letterCount===2,'Expected two pinned letter instances');
    raster=new FrameRaster(g.shadowRoot,new URL(template.module,location.href).href,controller.signal);await bound(raster.prepare(),'Raster');
    const letters=findLetters(animation),consumed=[...g.shadowRoot.querySelectorAll('[data-studio-ae-logo-merge-paint]')] as SVGPathElement[];
    assert(letters.length===2&&consumed.length===4,'Four consumed paints required');
    const seenPaths=new Map<string,string>();
    for(const frame of [580,581,582,640,581]){
      animation.goToAndStop(frame,true);g.__typography?.refresh();status.textContent='Comparaison source '+frame;
      const svg=animation.renderer.svgElement as SVGSVGElement,beforeInvariant=invariant(svg),dataAtPose=JSON.stringify(animation.animationData);
      const unionPaths=letters.map(({element,scope})=>({scope,d:element.itemsData[3].style.pElem.getAttribute('d'),fill:element.itemsData[3].style.pElem.getAttribute('fill'),rule:element.itemsData[3].style.pElem.getAttribute('fill-rule')||'nonzero'}));
      for(const path of unionPaths){if(!path.d)continue;assert(path.fill==='rgb(255,255,255)'&&path.rule==='nonzero','Final white nonzero fill required');assert((path.d.match(/M/g)||[]).length===2,'Combined white path must contain both source contours');if(seenPaths.has(path.scope))assert(seenPaths.get(path.scope)===path.d,'Static union path changed during seek');seenPaths.set(path.scope,path.d);}
      const section=document.createElement('section'),heading=document.createElement('h2'),pair=document.createElement('div');heading.textContent='Image source '+frame;pair.className='pair';section.append(heading,pair);gallery.append(section);
      const samples:{pixels:Uint8ClampedArray;name:string;sha256:string;stats:ReturnType<typeof stats>}[]=[];
      for(const mode of ['before','after']){
        for(const node of consumed)mode==='before'?node.removeAttribute('display'):node.setAttribute('display','none');
        assert(invariant(svg)===beforeInvariant,'DOM changed beyond consumed paints');assert(JSON.stringify(animation.animationData)===dataAtPose,'Source geometry/animation mutated');
        const source=await bound(raster.draw(null),'Frame'),canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;const ctx=canvas.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(source,0,0);
        const pixels=ctx.getImageData(0,0,1920,1080).data,blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('PNG unavailable')),'image/png'));
        const name=`semainier-letter-merge-${stamp}-${rows.length}-${frame}-${mode}.png`;await save(name,blob);samples.push({pixels,name,sha256:await hash(await blob.arrayBuffer()),stats:stats(pixels,frame)});
        const figure=document.createElement('figure'),caption=document.createElement('figcaption');caption.textContent=mode==='before'?'Avant — peintures noires superposées':'Après — chemin blanc final';figure.append(caption,canvas);pair.append(figure);
      }
      let changed=0,outside=0;const bounds=[1920,1080,-1,-1],box=region(frame);
      for(let i=0;i<samples[0].pixels.length;i+=4)if([0,1,2,3].some(c=>samples[0].pixels[i+c]!==samples[1].pixels[i+c])){const p=i/4,x=p%1920,y=Math.floor(p/1920);changed++;bounds[0]=Math.min(bounds[0],x);bounds[1]=Math.min(bounds[1],y);bounds[2]=Math.max(bounds[2],x);bounds[3]=Math.max(bounds[3],y);if(x<box.left||x>=box.right||y<box.top||y>=box.bottom)outside++;}
      assert(outside===0,'Pixels changed outside the É region');
      if(frame<600)assert(changed>3000&&samples[0].stats.black>3000&&samples[1].stats.black===0&&samples[1].stats.white>3000,'Expected opaque black É to become white');
      rows.push({frame,changed,outsideChanged:outside,checkedRegion:box,bounds:changed?bounds:null,sourceUnchanged:true,domUnchangedExceptConsumedPaints:true,unionPaths,images:samples.map(({pixels,...metadata})=>metadata)});
    }
    assert(seenPaths.size===2,'Both native union paths must be observed');
    const first=rows[1].images[1].sha256,replayed=rows[4].images[1].sha256;assert(first===replayed,'Replay at581 differs');
    adapter.dispose();assert(consumed.every(node=>node.getAttribute('display')===null&&!node.hasAttribute('data-studio-ae-logo-merge-paint')),'Dispose did not restore paints');
    const rebuilt=installAELogoCompositing(animation);assert(rebuilt.letterCount===2&&g.shadowRoot.querySelectorAll('[data-studio-ae-logo-merge-paint]').length===4,'Reinstall duplicated or missed paints');
    report.lifecycle={disposeRestored:true,reinstallCount:rebuilt.letterCount,replayExact:true};report.pass=true;status.textContent='PASS — É corrigé, invariants conservés ; pas de certification AE pixel à pixel.';
  }catch(error){report.error=String(error instanceof Error?error.stack:error);status.textContent='ÉCHEC : '+String(error);}
  finally{controller.abort();raster?.dispose();await prepared?.dispose();try{const name=`semainier-letter-merge-${stamp}.json`;await save(name,JSON.stringify(report,null,2));report.evidence=name;}catch(error){report.evidenceError=String(error);}output.textContent=JSON.stringify(report,null,2);button.disabled=false;}
};
