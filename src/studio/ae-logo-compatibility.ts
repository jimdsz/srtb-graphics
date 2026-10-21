import type {BroadcastTemplate} from './domain';
import type {LegacyGraphic} from './video/engine';

const NS='http://www.w3.org/2000/svg';
const compositions=new Set(['Anim_TV_Roll','Anim_TV_Roll_Color OUT']);
const installed=new WeakSet<object>(),instances=new WeakMap<object,ReturnType<typeof compose>>();
let serial=0;
const blackAlpha='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0';
const opaqueColour='1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 0 1';

// Frozen É operands: Merge Add consumes the inner paints; Lottie skips mm and
// otherwise paints these black fills over its already combined white path.
const letterVertices=[
  [[-195.398,-50],[-122.571,-50],[-122.571,-34],[-175.674,-34],[-175.674,-9.173],[-125.467,-9.173],[-125.467,6.829],[-175.674,6.829],[-175.674,34],[-122.571,34],[-122.571,50],[-195.398,50]],
  [[-166.621,-37.575],[-178.549,-37.575],[-166.5,-62.809],[-142.008,-62.809]],
];
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function fixed(property:any,value:unknown){return property?.a===0&&!property.x&&equal(property.k,value);}
function letterTransform(transform:any,position:number[],anchor:number[]){
  return transform?.ty==='tr'&&fixed(transform.p,position)&&fixed(transform.a,anchor)&&fixed(transform.s,[100,100])&&
    ['r','sk','sa'].every(key=>fixed(transform[key],0))&&fixed(transform.o,100);
}
function letterFill(fill:any,colour:number[]){return fill?.ty==='fl'&&!fill.hd&&!fill.bm&&fill.r===1&&fixed(fill.c,colour)&&fixed(fill.o,100);}
/** Strict geometry/paint contract, not a general Merge Paths implementation.
 * Lottie converts zero relative tangents to absolute vertices before rendering;
 * those two exact representations are the only accepted path forms. */
export function nativeLogoLetterMerge(layer:any,composition:string):boolean|null{
  const index=composition==='BENINTV_Roll'?3:composition==='BTV_to_BENINTV_Gauche'?6:null;
  if(index===null||layer?.ind!==index||layer.nm!=='é')return false;
  const shapes=layer.shapes;
  if(layer.ty!==4||layer.ef?.length||!Array.isArray(shapes)||shapes.length!==4||shapes[2].ty!=='mm'||shapes[2].mm!==2||shapes[2].hd||!letterFill(shapes[3],[1,1,1,1]))return null;
  for(let i=0;i<2;i++){
    const group=shapes[i],inner=group?.it?.[0],path=inner?.it?.[0]?.ks;
    if(group?.ty!=='gr'||group.hd||group.bm||group.it?.length!==2||inner?.ty!=='gr'||inner.hd||inner.bm||inner.it?.length!==3||inner.it[0].ty!=='sh'||inner.it[0].hd||path?.a!==0||path.x||path.k?.c!==true||!equal(path.k.v,letterVertices[i]))return null;
    const tangents=[path.k.i,path.k.o],zero=letterVertices[i].map(()=>[0,0]);
    if(!tangents.every(points=>equal(points,zero))&&!tangents.every(points=>equal(points,letterVertices[i])))return null;
    if(!letterFill(inner.it[1],[0,0,0,1])||!letterTransform(inner.it[2],[0,0],[0,0])||
      !letterTransform(group.it[1],i===0?[801.015,540]:[799.721,489.808],i===0?[-158.985,0]:[-160.279,-50.192]))return null;
  }
  return true;
}

/** The only coloured variant in these frozen logos: the native exit's two
 * ADBE Fill effects, not an open-ended exemption for arbitrary AE effects. */
export function nativeLogoColourEffect(layer:any,composition:string){
  if(!layer.ef?.length)return false;
  if(composition!=='Anim_TV_Roll_Color OUT'||![4,7].includes(layer.ind)||layer.ef.length!==1)return null;
  const effect=layer.ef[0];if(effect.ty!==21||effect.mn!=='ADBE Fill'||effect.en!==1||effect.ef?.length!==7)return null;
  const values:Record<string,[number,number]>={'ADBE Fill-0001':[10,0],'ADBE Fill-0007':[7,0],'ADBE Fill-0006':[7,0],'ADBE Fill-0003':[0,0],'ADBE Fill-0004':[0,0],'ADBE Fill-0005':[0,1]};
  for(const [name,[type,value]]of Object.entries(values)){const item=effect.ef.find((s:any)=>s.mn===name);if(item?.ty!==type||item.v?.a!==0||item.v.k!==value||item.v.x)return null;}
  const colour=effect.ef.find((s:any)=>s.mn==='ADBE Fill-0002');
  const keys=[{t:0,s:[1,1,1,1],h:1},{t:layer.ind===4?4:1,s:layer.ind===4?[0.92156869173,0.098039224744,0.019607843831,1]:[0.941176533699,0.72549021244,0,1],h:1}];
  return colour?.ty===2&&colour.v?.a===1&&!colour.v.x&&JSON.stringify(colour.v.k)===JSON.stringify(keys)?true:null;
}

/** These AE compositions are byte-identical to the established BA logo operands.
 * Bodymovin omitted the native T5 silhouette and alpha-add blend modes. The AE
 * engine already clips V-minus-Rectangle exactly; retain that path, every live
 * matrix/matte and the original painter order. Never substitute a flat logo.
 * The normal colour / summed alpha formula is shared with BA's established
 * adapter; its white-only fast path is used only for proven white operands. */
function compose(animation:any){
  const renderer=animation?.renderer,defs:SVGDefsElement=renderer?.globalData?.defs;
  if(!defs||renderer.svgElement?.namespaceURI!==NS)throw Error('Logo AE : moteur SVG indisponible.');
  const assets=new Map<string,string>((animation.animationData.assets||[]).map((a:any)=>[a.id,a.nm]));
  const owner=`studio-ae-logo-${++serial}`,owned:SVGElement[]=[],undo:(()=>void)[]=[],adapted=new Set<any>(),letters=new Set<any>();
  let count=0,disposed=false;
  const id=(name:string)=>`${owner}-${name}-${++count}`;
  function create(tag:string,attrs:Record<string,string|number>={}){
    const node=defs.ownerDocument.createElementNS(NS,tag);node.setAttribute('data-studio-ae-logo-owner',owner);
    for(const [key,value]of Object.entries(attrs))node.setAttribute(key,String(value));owned.push(node);return node;
  }
  function definition(node:SVGElement){defs.append(node);return node;}
  const use=(ref:string)=>create('use',{href:`#${ref}`});
  function move(node:SVGElement){
    const parent=node.parentNode,next=node.nextSibling;undo.push(()=>{if(parent)parent.insertBefore(node,next?.parentNode===parent?next:null);});defs.append(node);
  }
  function identify(node:SVGElement,name:string){
    const previous=node.getAttribute('id'),ref=id(name);undo.push(()=>previous===null?node.removeAttribute('id'):node.setAttribute('id',previous));node.setAttribute('id',ref);return ref;
  }
  function subtract(ref:string){
    const filter=definition(create('filter',{id:id('black-alpha'),'color-interpolation-filters':'sRGB'}));
    filter.append(create('feColorMatrix',{type:'matrix',values:blackAlpha}));
    const mask=definition(create('mask',{id:id('subtract'),maskUnits:'userSpaceOnUse',maskContentUnits:'userSpaceOnUse',x:-1920,y:-1080,width:5760,height:3240,'mask-type':'luminance'}));
    mask.append(create('rect',{x:-1920,y:-1080,width:5760,height:3240,fill:'white'}));
    const operand=use(ref);operand.setAttribute('filter',`url(#${filter.id})`);mask.append(operand);return mask.id;
  }
  function add(bottom:string|null,top:string,element:any,white:boolean){
    if(!bottom)return top;
    const box={x:0,y:0,width:element.data.w||1920,height:element.data.h||1080};
    const filter=definition(create('filter',{id:id('alpha-add'),filterUnits:'userSpaceOnUse',primitiveUnits:'userSpaceOnUse',...box,'color-interpolation-filters':'sRGB','data-studio-native-mode':'alpha-add'}));
    filter.append(create('feImage',{href:`#${bottom}`,...box,preserveAspectRatio:'none',result:'destination'}),create('feImage',{href:`#${top}`,...box,preserveAspectRatio:'none',result:'source'}));
    if(white){
      // White premultiplied RGB equals alpha: saturating addition is exact.
      filter.append(create('feComposite',{in:'source',in2:'destination',operator:'arithmetic',k1:0,k2:1,k3:1,k4:0}));
    }else{
      filter.append(create('feComposite',{in:'source',in2:'destination',operator:'over',result:'normal'}));
      filter.append(create('feColorMatrix',{in:'normal',type:'matrix',values:opaqueColour,result:'normalOpaque'}));
      filter.append(create('feComposite',{in:'source',in2:'destination',operator:'arithmetic',k1:0,k2:1,k3:1,k4:0,result:'alphaSum'}));
      filter.append(create('feComposite',{in:'normalOpaque',in2:'alphaSum',operator:'in'}));
    }
    const result=definition(create('g',{id:id('sum')}));result.append(create('rect',{...box,fill:'transparent',filter:`url(#${filter.id})`}));return result.id;
  }
  function white(items:any[]):boolean{
    return !!items?.length&&items.every(s=>s.ty==='gr'?white(s.it):s.ty==='fl'?s.c?.a===0&&s.c.k.slice(0,3).every((v:number)=>v===1):['sh','rc','tr'].includes(s.ty));
  }
  function install(element:any){
    for(const [ind,name]of [[2,'V 2'],[4,'V'],[5,'T 4'],[6,'T 5'],[7,'T 2']])if(!element.elements.some((e:any)=>e?.data.ind===ind&&e.data.nm===name))throw Error('Logo AE : calques natifs non reconnus.');
    const v=element.elements.find((e:any)=>e?.data.ind===4),items=v?.data.shapes?.[0]?.it;
    if(items?.length!==3||items[0].ty!=='sh'||items[1].ty!=='fl'||items[2].ty!=='tr')throw Error('Logo AE : soustraction native non préparée.');
    const visible=element.elements.filter((e:any)=>e?.getBaseElement?.());
    const colours=visible.map((e:any)=>nativeLogoColourEffect(e.data,assets.get(element.data.refId)||''));
    if(colours.includes(null)||!visible.every((e:any)=>e.data.ty===4&&(!e.data.tt||[1,2].includes(e.data.tt))&&white(e.data.shapes)))throw Error('Logo AE : couleur ou opération native non reconnue.');
    const whiteOnly=!colours.includes(true);
    let composite:string|null=null;
    for(const layer of [...element.elements].reverse()){
      const node=layer?.getBaseElement?.() as SVGElement|undefined;if(!node)continue;
      const ref=identify(node,`layer-${layer.data.ind}`);move(node);
      if(layer.data.ind===6){
        const masked=definition(create('g',{id:id('silhouette'),mask:`url(#${subtract(ref)})`}));
        if(composite)masked.append(use(composite));composite=masked.id;
      }else if([2,5,7].includes(layer.data.ind))composite=add(composite,ref,element,whiteOnly);
      else{const group=definition(create('g',{id:id('normal')}));if(composite)group.append(use(composite));group.append(use(ref));composite=group.id;}
    }
    const output=use(composite!);output.setAttribute('data-studio-ae-logo-output',assets.get(element.data.refId)!);element.layerElement.append(output);adapted.add(element);
  }
  function installLetter(element:any,scope:string){
    if(letters.has(element))return;
    const recognized=nativeLogoLetterMerge(element.data,scope);if(recognized===false)return;
    if(recognized===null)throw Error('Logo AE : fusion native du É non reconnue.');
    const combined=element.itemsData?.[3]?.style?.pElem as SVGPathElement|undefined;
    const paints=[0,1].map(i=>element.itemsData?.[i]?.it?.[0]?.it?.[1]?.style?.pElem as SVGPathElement|undefined);
    if(combined?.localName!=='path'||paints.some(node=>node?.localName!=='path'||node===combined)||paints[0]===paints[1])throw Error('Logo AE : peintures de fusion indisponibles.');
    // Do not hide the source groups: the final white path already references
    // both geometries. Only suppress paints consumed by the native operation.
    for(const node of paints as SVGPathElement[]){
      const display=node.getAttribute('display'),marker=node.getAttribute('data-studio-ae-logo-merge-paint');
      undo.push(()=>{display===null?node.removeAttribute('display'):node.setAttribute('display',display);marker===null?node.removeAttribute('data-studio-ae-logo-merge-paint'):node.setAttribute('data-studio-ae-logo-merge-paint',marker);});
      node.setAttribute('display','none');node.setAttribute('data-studio-ae-logo-merge-paint','consumed');
    }
    letters.add(element);
  }
  function walk(container:any,scope=''){for(const element of container?.elements||[]){if(!element?.data)continue;installLetter(element,scope);if(compositions.has(assets.get(element.data.refId)||'')&&!adapted.has(element))install(element);walk(element,assets.get(element.data.refId)||'');}}
  function refresh(){if(disposed)return;try{walk(renderer);}catch(error){dispose();throw error;}}
  function dispose(){
    if(disposed)return;disposed=true;animation.removeEventListener?.('drawnFrame',refresh);animation.removeEventListener?.('destroy',dispose);
    for(const restore of undo.reverse())restore();for(const node of owned.reverse())node.remove();instances.delete(animation);adapted.clear();letters.clear();
  }
  const api={refresh,dispose,get count(){return adapted.size;},get letterCount(){return letters.size;}};
  animation.addEventListener('drawnFrame',refresh);animation.addEventListener('destroy',dispose);
  refresh();return api;
}

export function installAELogoCompositing(animation:any){
  const current=instances.get(animation);if(current)return current;
  const next=compose(animation);instances.set(animation,next);return next;
}

/** Shared by catalogue, project preview and portable/video rendering. */
export function installAELogoCompatibility(graphic:LegacyGraphic,template:Pick<BroadcastTemplate,'id'|'version'|'libraryVersion'|'module'>){
  // Portable delivery relocates module to ./graphic.mjs. Version and live
  // operand guards, not a web-root URL, keep preview/export/delivery equivalent.
  if(!['BTV_Evenement','BTV_Semainier'].includes(template.id)||template.version!=='1.0.0'||template.libraryVersion!=='1.7.0'||installed.has(graphic))return;
  const native=graphic as LegacyGraphic&{_update:(...args:any[])=>Promise<unknown>;animation?:any};
  if(typeof native._update!=='function')return;
  installed.add(graphic);const update=native._update;
  native._update=async function(...args:any[]){
    const result=await update.apply(this,args);
    // SocialScene deliberately uses a clock-only dummy, with no TV SVG.
    if(this.animation?.renderer?.svgElement?.namespaceURI===NS)installAELogoCompositing(this.animation);
    return result;
  };
}
