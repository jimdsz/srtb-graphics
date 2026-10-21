// The original shadow DOM is the source of truth. No recreation of the artwork.
import type {ExportProfile} from './export-profile';
const SVG='http://www.w3.org/2000/svg',HTML='http://www.w3.org/1999/xhtml';
export class FrameRaster {
  readonly canvas=document.createElement('canvas');
  private readonly context:CanvasRenderingContext2D;
  private assets=new Map<string,Promise<string>>();
  private fontCss='';
  readonly timings={clone:0,svg:0,draw:0,png:0};
  private omitCanvases=false;
  private exactBitmaps=false;
  private bitmapCache=new Map<HTMLCanvasElement,string>();
  private underlay?:HTMLElement;
  private skipUnderlay=false;
  private underlayAccepted:boolean|undefined;
  private drawn=0;
  private composition=document.createElement('canvas');
  setUnderlay(node:HTMLElement|undefined){this.underlay=node;this.composition.width=1920;this.composition.height=1080;}
  constructor(private root:ShadowRoot,private base:string,private signal:AbortSignal,private videoFrame?:(node:HTMLVideoElement)=>Promise<HTMLCanvasElement|OffscreenCanvas>,private canonicalCanvas?:(node:HTMLCanvasElement)=>HTMLCanvasElement,private profile?:ExportProfile){
    this.canvas.width=1920;this.canvas.height=1080;
    const context=this.canvas.getContext('2d',{alpha:true,willReadFrequently:true});
    if(!context)throw Error('Le navigateur ne peut pas calculer les images du fichier.');
    this.context=context;
  }
  private bitmap(canvas:HTMLCanvasElement){
    canvas=this.canonicalCanvas?.(canvas)||canvas;
    const previous=this.bitmapCache.get(canvas);if(previous)return previous;
    const started=this.profile?.now();
    let opaque=!this.exactBitmaps;
    if(opaque){const pixels=canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data;for(let i=3;i<pixels.length;i+=4)if(pixels[i]!==255){opaque=false;break;}}
    if(started!==undefined)this.profile?.record('raster.bitmapScan',started);
    // Opaque photographs/video use the browser's maximum-quality JPEG path.
    // Transparent artwork ALWAYS remains lossless PNG (including alpha edges).
    // This avoids multi-megabyte PNG/XML re-encodes of every moving video frame.
    const encoded=this.profile?.now(),result=canvas.toDataURL(opaque?'image/jpeg':'image/png',1);this.bitmapCache.set(canvas,result);
    if(encoded!==undefined)this.profile?.record('raster.bitmapEncode',encoded);
    if(started!==undefined){this.profile?.record('raster.bitmap',started);this.profile?.count(opaque?'bitmap.jpeg':'bitmap.png');this.profile?.count('bitmap.characters',result.length);}
    return result;
  }
  private dataUrl(blob:Blob):Promise<string>{return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(Error('Lecture du média impossible.'));r.readAsDataURL(blob);});}
  private asset(raw:string){
    if(raw.startsWith('data:'))return Promise.resolve(raw);
    const url=new URL(raw,this.base).href;
    if(!this.assets.has(url))this.assets.set(url,(async()=>{
      const response=await fetch(url,{signal:this.signal,credentials:'same-origin'});
      if(!response.ok)throw Error(`Ressource du rendu inaccessible (${response.status}).`);
      return this.dataUrl(await response.blob());
    })());
    return this.assets.get(url)!;
  }
  async prepare(){
    const fonts=[['BTVBenin','BeninSemiBold-Regular.otf'],['Benin Semi Bold','BeninSemiBold-Regular.otf'],['BTVSuisse','SuisseIntl.otf'],['SuisseIntl','SuisseIntl.otf']];
    this.fontCss=(await Promise.all(fonts.map(async([family,file])=>`@font-face{font-family:'${family}';src:url('${await this.asset('lib/fonts/'+file)}') format('opentype');font-weight:400;font-style:normal}`))).join('');
    await document.fonts.ready;
  }
  private async clone(node:Node):Promise<Node>{
    this.signal.throwIfAborted();
    if(!(node instanceof Element))return node.cloneNode(false);
    if(node instanceof HTMLAudioElement)return document.createTextNode('');
    if(this.skipUnderlay&&node===this.underlay)return document.createTextNode('');
    if(this.omitCanvases&&node instanceof HTMLCanvasElement)return document.createTextNode('');
    // Hidden playlist clips and inactive Lottie layers must not be decoded or
    // base64-encoded. Keeping their layout box preserves the original geometry.
    if(node instanceof HTMLElement||node instanceof SVGElement){
      if(node.style.display==='none'||node.style.visibility==='hidden')return node.cloneNode(false);
    }
    let copy:Element;
    if(node instanceof HTMLCanvasElement||node instanceof HTMLVideoElement){
      const img=document.createElementNS(HTML,'img');
      for(const attr of node.attributes)if(!['src','srcset','autoplay','poster'].includes(attr.name))img.setAttribute(attr.name,attr.value);
      if(node instanceof HTMLVideoElement){
        const decoded=this.videoFrame?await this.videoFrame(node):node;
        if(decoded===node&&node.readyState<2)throw Error('Image vidéo non décodée : export interrompu, pas de frame noire de remplacement.');
        const c=document.createElement('canvas'),w=decoded instanceof HTMLVideoElement?decoded.videoWidth:decoded.width,h=decoded instanceof HTMLVideoElement?decoded.videoHeight:decoded.height,box=node.getBoundingClientRect();
        // Decode the source at native resolution, but avoid embedding a 1080p
        // bitmap for a small on-screen thumbnail. Never upscale or distort it.
        const scale=this.exactBitmaps?1:Math.min(1,Math.max(box.width/w,box.height/h));c.width=Math.max(1,Math.ceil(w*scale));c.height=Math.max(1,Math.ceil(h*scale));
        c.getContext('2d')!.drawImage(decoded,0,0,c.width,c.height);img.setAttribute('src',this.bitmap(c));c.width=c.height=0;
      }else{const started=performance.now();img.setAttribute('src',this.bitmap(node));this.timings.png+=performance.now()-started;}
      copy=img;
    }else{
      copy=node.cloneNode(false) as Element;
      if(node instanceof HTMLImageElement){
        await node.decode();
        copy.setAttribute('src',await this.asset(node.currentSrc||node.src));copy.removeAttribute('srcset');copy.removeAttribute('loading');
      }else if(node.namespaceURI===SVG&&node.localName==='image'){
        const href=node.getAttribute('href')||node.getAttributeNS('http://www.w3.org/1999/xlink','href');
        if(href){const inline=await this.asset(href);copy.setAttribute('href',inline);copy.setAttributeNS('http://www.w3.org/1999/xlink','href',inline);}
      }
      // Lottie sometimes prefixes fragment references with the current document URL.
      for(const attr of [...copy.attributes])if(/url\(["']?[^)]*#/.test(attr.value))copy.setAttribute(attr.name,attr.value.replace(/url\(["']?[^#)]*#([^)'"\s]+)["']?\)/g,'url(#$1)'));
      for(const child of node.childNodes)copy.appendChild(await this.clone(child));
    }
    return copy;
  }
  async draw(background:string|null,omitCanvases=false,exactBitmaps=false):Promise<HTMLCanvasElement>{
    const started=this.profile?.now();try{
    this.drawn++;
    if(this.underlay&&!omitCanvases&&(this.underlayAccepted!==false||this.drawn%25===0)){
      const ctx=this.composition.getContext('2d',{willReadFrequently:true})!;ctx.clearRect(0,0,1920,1080);
      if(background){ctx.fillStyle=background;ctx.fillRect(0,0,1920,1080);}
      const origin=this.root.host.getBoundingClientRect(),visible=(element:Element)=>{
        let opacity=1;for(let node:Element|null=element;node;node=node.parentElement){const style=getComputedStyle(node);if(style.display==='none'||style.visibility==='hidden')return 0;opacity*=Number(style.opacity);if(node===this.root.host)break;}return opacity;
      };
      const opacity=visible(this.underlay),style=getComputedStyle(this.underlay),rect=this.underlay.getBoundingClientRect();
      if(opacity){
        ctx.save();ctx.globalAlpha=opacity;ctx.fillStyle=style.backgroundColor;ctx.fillRect(rect.left-origin.left,rect.top-origin.top,rect.width,rect.height);ctx.restore();
        for(const node of this.underlay.querySelectorAll('video,img')){
          const alpha=visible(node);if(!alpha)continue;
          const image=node instanceof HTMLVideoElement?await this.videoFrame!(node):node as HTMLImageElement;
          if(image instanceof HTMLImageElement)await image.decode();
          const box=node.getBoundingClientRect(),css=getComputedStyle(node),w=image instanceof HTMLImageElement?image.naturalWidth:image.width,h=image instanceof HTMLImageElement?image.naturalHeight:image.height;
          const x=box.left-origin.left,y=box.top-origin.top,scale=(css.objectFit==='contain'?Math.min:Math.max)(box.width/w,box.height/h);
          ctx.save();ctx.globalAlpha=alpha;ctx.beginPath();ctx.rect(x,y,box.width,box.height);ctx.clip();ctx.fillStyle=css.backgroundColor;ctx.fillRect(x,y,box.width,box.height);ctx.drawImage(image,x+(box.width-w*scale)/2,y+(box.height-h*scale)/2,w*scale,h*scale);ctx.restore();
        }
      }
      this.skipUnderlay=true;const overlay=await this.drawOriginal(null,omitCanvases,exactBitmaps);this.skipUnderlay=false;ctx.drawImage(overlay,0,0);
      if(this.underlayAccepted!==true||this.drawn%25===0){
        const reference=await this.drawOriginal(background,omitCanvases,true),comparison=this.profile?.now(),a=this.context.getImageData(0,0,1920,1080).data,b=ctx.getImageData(0,0,1920,1080).data;let error=0;for(let n=0;n<a.length;n++)error+=Math.abs(a[n]-b[n]);this.underlayAccepted=error/a.length<.12;
        if(comparison!==undefined){this.profile?.record('raster.compare',comparison);this.profile?.count(this.underlayAccepted?'underlay.accept':'underlay.reject');}if(!this.underlayAccepted)return reference;
      }
      this.context.clearRect(0,0,1920,1080);this.context.drawImage(this.composition,0,0);return this.canvas;
    }
    return await this.drawOriginal(background,omitCanvases,exactBitmaps);
    }finally{if(started!==undefined)this.profile?.record('raster.total',started);}
  }
  private async drawOriginal(background:string|null,omitCanvases=false,exactBitmaps=false){
    this.omitCanvases=omitCanvases;
    this.exactBitmaps=exactBitmaps;this.bitmapCache.clear();
    const started=performance.now(),profileStarted=this.profile?.now();this.timings.png=0;
    this.signal.throwIfAborted();
    const svg=document.createElementNS(SVG,'svg');svg.setAttribute('width','1920');svg.setAttribute('height','1080');svg.setAttribute('viewBox','0 0 1920 1080');
    const foreign=document.createElementNS(SVG,'foreignObject');foreign.setAttribute('width','1920');foreign.setAttribute('height','1080');
    const host=document.createElementNS(HTML,'div');host.setAttribute('xmlns',HTML);
    // Replace :host selectors so shadow styles retain their original scope inside the snapshot.
    host.className='srtb-export-root';host.style.cssText='position:relative;width:1920px;height:1080px;overflow:hidden;background:transparent;color:white;font-family:BTVSuisse,SuisseIntl,sans-serif;font-synthesis:none;isolation:isolate';
    const fonts=document.createElementNS(HTML,'style');fonts.textContent=this.fontCss;host.append(fonts);
    for(const node of this.root.childNodes){const copy=await this.clone(node);if(copy instanceof HTMLStyleElement)copy.textContent=copy.textContent?.replaceAll(':host','.srtb-export-root')||'';host.appendChild(copy);}
    this.timings.clone=performance.now()-started;const cloned=performance.now();
    if(profileStarted!==undefined){this.profile?.record('raster.clone',profileStarted);this.profile?.count('raster.passes');}
    const serializeStarted=this.profile?.now();
    foreign.append(host);svg.append(foreign);
    const src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(svg));
    if(serializeStarted!==undefined){this.profile?.record('raster.serialize',serializeStarted);this.profile?.count('svg.characters',src.length);}
    const svgStarted=this.profile?.now();
    const image=new Image();image.src=src;await image.decode();this.signal.throwIfAborted();
    if(svgStarted!==undefined)this.profile?.record('raster.svgDecode',svgStarted);
    this.timings.svg=performance.now()-cloned;const decoded=performance.now();
    const drawStarted=this.profile?.now();
    this.context.clearRect(0,0,1920,1080);
    if(background){this.context.fillStyle=background;this.context.fillRect(0,0,1920,1080);}
    this.context.drawImage(image,0,0);
    // A tainted canvas must fail before the encoder receives the first frame.
    this.context.getImageData(0,0,1,1);
    image.src='';
    this.timings.draw=performance.now()-decoded;
    if(drawStarted!==undefined)this.profile?.record('raster.canvasDraw',drawStarted);
    return this.canvas;
  }
  dispose(){this.assets.clear();this.fontCss='';this.canvas.width=this.canvas.height=this.composition.width=this.composition.height=0;}
}
