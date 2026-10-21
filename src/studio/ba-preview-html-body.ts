import {previewCanvasContext,checkPreviewCanvas} from './preview-canvas-guard';
/** BA-only presentation. The pinned AE body has two copies:
 * layer 26 is complete, layer 25 covers its lower half. After the intro ends,
 * all visible vector layers are above these copies, including the OUT pack.
 * Keep both copies: merging them changes partially transparent source media.
 * Unknown scene structures and still images retain SVG presentation. */
export function baHTMLBodyPhase(seconds:number){return seconds>=5.6&&seconds<66.16;}
/** Check the actual configured scene, not only a template/version label. */
export function baHTMLBodyStructure(data:any){
  if(data?.w!==1920||data?.h!==1080||!Array.isArray(data.layers)||!Array.isArray(data.assets))return false;
  if(data.layers.filter((layer:any)=>layer.ind===25||layer.ind===26).length!==2)return false;
  const lowerIndex=data.layers.findIndex((layer:any)=>layer.ind===25),upperIndex=data.layers.findIndex((layer:any)=>layer.ind===26);
  if(lowerIndex<0||upperIndex<=lowerIndex)return false;
  const lower=data.layers[lowerIndex],upper=data.layers[upperIndex];
  if(lower.parent!==22||upper.parent!==23||[22,23].some(index=>{const parent=data.layers.find((layer:any)=>layer.ind===index);return !parent||parent.ty!==3||parent.ddd||parent.ef?.length;}))return false;
  if([lower,upper].some(layer=>layer.nm!=='BA_1P_Rush_Corps'||layer.ty!==0||layer.ddd||layer.w!==1920||layer.h!==1080||layer.tt||layer.td||layer.bm||layer.ef?.length||layer.ip!==109))return false;
  if(lower.op!==1654||lower.refId!==upper.refId||!data.assets.some((asset:any)=>asset.id===lower.refId&&asset.nm==='BA_1P_Rush_Corps')||upper.masksProperties?.length)return false;
  const mask=lower.masksProperties?.[0];
  if(lower.masksProperties?.length!==1||!mask||mask.mode!=='a'||mask.inv||mask.pt?.a!==0||mask.o?.a!==0||mask.o?.k!==100||mask.x?.a!==0||mask.x?.k!==0||!mask.pt.k?.c)return false;
  const vertices='[[0,540],[0,1080],[1920,1080],[1920,540]]';
  // Lottie converts relative Bezier handles to absolute coordinates in-place.
  const handles=data.__complete===true?vertices:'[[0,0],[0,0],[0,0],[0,0]]';
  if(JSON.stringify(mask.pt.k.v)!==vertices||JSON.stringify(mask.pt.k.i)!==handles||JSON.stringify(mask.pt.k.o)!==handles)return false;
  return data.layers.slice(upperIndex+1).every((layer:any)=>layer.td===1||layer.ty===3||layer.ip>=1654||layer.op<=140);
}
type BodyLayer={image:SVGImageElement;index:number};
export class BAPreviewHTMLBody {
  private root=document.createElement('div');
  private svg:SVGSVGElement;
  private previous:{position:string;zIndex:string};
  private records:{image:SVGImageElement;wrapper:HTMLDivElement;canvas:HTMLCanvasElement;ancestors:SVGElement[]}[]=[];
  presented=0;
  active=false;
  constructor(layers:BodyLayer[]){
    if(layers.length!==2||!layers.some(layer=>layer.index===25)||!layers.some(layer=>layer.index===26))throw Error('Calques du corps BA incompatibles avec la présentation HTML.');
    this.svg=layers[0].image.ownerSVGElement!;if(!this.svg)throw Error('Scène BA absente.');
    this.previous={position:this.svg.style.position,zIndex:this.svg.style.zIndex};
    this.root.dataset.studioBodyPresentation='html';this.root.style.cssText='position:absolute;inset:0;width:1920px;height:1080px;overflow:hidden;pointer-events:none;z-index:0;display:none';
    this.svg.before(this.root);this.svg.style.position='relative';this.svg.style.zIndex='1';
    for(const layer of [...layers].sort((a,b)=>b.index-a.index)){
      const wrapper=document.createElement('div'),canvas=document.createElement('canvas'),ancestors:SVGElement[]=[];
      for(let parent:Element|null=layer.image.parentElement;parent&&parent!==this.svg;parent=parent.parentElement)ancestors.push(parent as SVGElement);
      wrapper.dataset.studioBodyLayer=String(layer.index);wrapper.style.cssText='position:absolute;left:0;top:0;width:1920px;height:1080px;transform-origin:0 0';
      canvas.style.cssText='display:block;width:1920px;height:1080px';if(layer.index===25)canvas.style.clipPath='inset(50% 0 0 0)';
      wrapper.append(canvas);this.root.append(wrapper);this.records.push({image:layer.image,wrapper,canvas,ancestors});
    }
  }
  show(active:boolean){this.active=active;this.root.style.display=active?'block':'none';for(const record of this.records)record.image.style.visibility=active?'hidden':'';}
  get copyExpected(){return this.active&&this.records.some(({ancestors})=>ancestors.every(ancestor=>ancestor.style.display!=='none'&&ancestor.getAttribute('display')!=='none'&&Number(ancestor.getAttribute('opacity')??1)!==0));}
  draw(frame:HTMLCanvasElement){
    let copied=false;
    for(const {wrapper,canvas,ancestors} of this.records){
      let matrix=new DOMMatrix(),opacity=1,visible=true;
      for(const ancestor of [...ancestors].reverse()){
        const transform=ancestor.getAttribute('transform');if(transform)matrix=matrix.multiply(new DOMMatrix(transform));
        opacity*=Number(ancestor.getAttribute('opacity')??1);if(ancestor.style.display==='none'||ancestor.getAttribute('display')==='none')visible=false;
      }
      wrapper.style.display=visible?'block':'none';wrapper.style.opacity=String(opacity);
      wrapper.style.transform=`matrix(${matrix.a},${matrix.b},${matrix.c},${matrix.d},${matrix.e},${matrix.f})`;
      if(!visible||opacity===0)continue;
      if(canvas.width!==frame.width||canvas.height!==frame.height){canvas.width=frame.width;canvas.height=frame.height;}
      const context=previewCanvasContext(canvas);context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(frame,0,0);checkPreviewCanvas(context);
      copied=true;
    }
    if(copied)this.presented++;
    return copied;
  }
  dispose(){this.show(false);this.root.remove();this.svg.style.position=this.previous.position;this.svg.style.zIndex=this.previous.zIndex;}
}
