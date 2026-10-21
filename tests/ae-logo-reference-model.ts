/** Local qualification data only. No production renderer imports this module. */
export const AE_LOGO_REFERENCE = Object.freeze({
  frame: 1780, fps: 25, width: 1920, height: 1080,
  file: 'BroadcastTemplates/EXPORT/BTV_BA_1P/reference_aftereffects/frame_01780.png',
  sha256: 'ba7bfb02f507a2c9026ef6ade4cf6744cd6a9bfe568cad37021b0a3fbe54a76c',
});
export const AE_LOGO_REGIONS = [
  {id: 'complete-logo', label: 'BÉNIN TV complet', x: 690, y: 460, width: 555, height: 155},
  {id: 'tv', label: 'T/V', x: 1100, y: 460, width: 150, height: 155},
] as const;
export interface Region {x:number;y:number;width:number;height:number}

/** Descriptive measurements; no independently approved acceptance threshold exists. */
export function measureReferenceRegion(reference:Uint8ClampedArray,candidate:Uint8ClampedArray,width:number,height:number,region:Region){
  const values=[width,height,region.x,region.y,region.width,region.height];
  if(values.some(n=>!Number.isInteger(n)||n<0)||!width||!height||!region.width||!region.height||region.x+region.width>width||region.y+region.height>height)
    throw Error('Invalid reference comparison region.');
  if(reference.length!==width*height*4||candidate.length!==reference.length)throw Error('Reference comparison dimensions differ.');
  let changedPixels=0,rgbTotal=0,alphaTotal=0,premultipliedTotal=0,maxRgb=0,maxAlpha=0,maxPremultiplied=0;
  const histogram=Array<number>(256).fill(0),bounds=[width,height,-1,-1];
  for(let y=region.y;y<region.y+region.height;y++)for(let x=region.x;x<region.x+region.width;x++){
    const i=(y*width+x)*4,alpha=Math.abs(reference[i+3]-candidate[i+3]);let rgb=0;
    for(let channel=0;channel<3;channel++){
      const difference=Math.abs(reference[i+channel]-candidate[i+channel]);rgbTotal+=difference;rgb=Math.max(rgb,difference);
      const premultiplied=Math.abs(reference[i+channel]*reference[i+3]/255-candidate[i+channel]*candidate[i+3]/255);
      premultipliedTotal+=premultiplied;maxPremultiplied=Math.max(maxPremultiplied,premultiplied);
    }
    alphaTotal+=alpha;premultipliedTotal+=alpha;maxPremultiplied=Math.max(maxPremultiplied,alpha);
    maxRgb=Math.max(maxRgb,rgb);maxAlpha=Math.max(maxAlpha,alpha);histogram[rgb]++;
    if(rgb||alpha){changedPixels++;bounds[0]=Math.min(bounds[0],x);bounds[1]=Math.min(bounds[1],y);bounds[2]=Math.max(bounds[2],x);bounds[3]=Math.max(bounds[3],y);}
  }
  const pixels=region.width*region.height;
  return {pixels,changedPixels,exactPixels:pixels-changedPixels,meanAbsoluteRgb:rgbTotal/(pixels*3),meanAbsoluteAlpha:alphaTotal/pixels,
    maxRgb,maxAlpha,premultipliedRgbaMean:premultipliedTotal/(pixels*4),maxPremultiplied,
    // The historical probe counted RGB deltas >16; this remains descriptive.
    pixelsRgbOver16:histogram.slice(17).reduce((sum,n)=>sum+n,0),maxRgbDeltaHistogram:histogram,
    changedBounds:changedPixels?bounds:null};
}

export interface SourcePoseEvidence {
  seekFrame:number;statusFrame:number;animationFrame:number;rendererFrame:number;frameRate:number;
  outroFrame:number;beninFrame:number;tvFrame:number;
}
export function verifyNativeSourcePose(pose:SourcePoseEvidence){
  for(const name of ['seekFrame','statusFrame','animationFrame','rendererFrame'] as const)
    if(pose[name]!==AE_LOGO_REFERENCE.frame)throw Error(`${name}: source frame 1780 required; observed ${pose[name]}.`);
  if(pose.frameRate!==25)throw Error('Native reference frame rate must remain 25 fps.');
  // Source layer 16 starts at 1742; BENINTV_Roll starts at local 28.
  for(const [name,expected] of [['outroFrame',38],['beninFrame',10],['tvFrame',10]] as const)
    if(pose[name]!==expected)throw Error(`${name}: native local frame ${expected} required; observed ${pose[name]}.`);
  return pose;
}

function findLayer(container:any,ind:number,name:string){
  const layer=container?.layers?.find((item:any)=>item.ind===ind&&item.nm===name);
  if(!layer)throw Error(`Native logo layer missing: ${ind}/${name}.`);return layer;
}
function asset(data:any,id:string){const comp=data.assets.find((item:any)=>item.id===id);if(!comp)throw Error('Native logo composition missing.');return comp;}
function placement(layer:any){
  return Object.fromEntries(['ind','nm','refId','parent','st','sr','tm','ks','ip'].filter(key=>key in layer).map(key=>[key,layer[key]]));
}
/** Parent chain stays native. The source's existing outro lifetime extension is
 * outside this frame and deliberately excluded from the placement signature. */
export function nativeLogoPlacement(data:any){
  if(data.fr!==25||data.w!==1920||data.h!==1080||data.ip!==0)throw Error('Unexpected native BA coordinate system.');
  const outro=findLayer(data,16,'Outro_vert'),outroComp=asset(data,outro.refId),benin=findLayer(outroComp,1,'BENINTV_Roll'),beninComp=asset(data,benin.refId);
  const tv=findLayer(beninComp,1,'Anim TV Roll HAUT 2'),tvComp=asset(data,tv.refId);
  if(outro.st!==1742||benin.st!==28||tv.st!==0||[outro,benin,tv].some(layer=>layer.sr!==1||layer.tm))throw Error('Native outro logo timing has changed.');
  return {outro:placement(outro),benin:placement(benin),letters:beninComp.layers.map(placement),tv:tvComp.layers.map(placement)};
}
export interface PlacementDifference {path:string;expected:unknown;actual:unknown}
export class NativePlacementMismatchError extends Error {
  constructor(readonly differences:PlacementDifference[],readonly rendererNormalizations:PlacementDifference[]){
    const value=(item:unknown)=>item===undefined?'(missing)':JSON.stringify(item);
    super('Logo placement differs from the native source; comparison stopped. '+differences.map(item=>`${item.path}: expected ${value(item.expected)}, actual ${value(item.actual)}`).join('; '));
    this.name='NativePlacementMismatchError';
  }
}
function placementDifferences(expected:any,actual:any,path=''):PlacementDifference[]{
  if(Object.is(expected,actual))return [];
  if(!expected||!actual||typeof expected!=='object'||typeof actual!=='object'||Array.isArray(expected)!==Array.isArray(actual))return [{path,expected,actual}];
  const differences:PlacementDifference[]=[];
  if(Array.isArray(expected)&&expected.length!==actual.length)differences.push({path:path+'.length',expected:expected.length,actual:actual.length});
  for(const key of new Set([...Object.keys(expected),...Object.keys(actual)]))differences.push(...placementDifferences(expected[key],actual[key],Array.isArray(expected)?`${path}[${key}]`:path?`${path}.${key}`:key));
  return differences;
}
export function verifyNativePlacement(source:any,rendered:any){
  // Retain the prior JSON value contract: Lottie's function-valued caches are
  // not source placement data. Compare structure without depending on key order.
  const expected=JSON.parse(JSON.stringify(nativeLogoPlacement(source))),actual=JSON.parse(JSON.stringify(nativeLogoPlacement(rendered)));
  const rendererNormalizations:PlacementDifference[]=[];
  for(const [index,layer] of expected.tv.entries()){
    if(![[4,'V'],[5,'T 4'],[7,'T 2']].some(([ind,name])=>layer.ind===ind&&layer.nm===name))continue;
    const original=layer.ks?.p,observed=actual.tv[index]?.ks?.p,key=original?.k?.[0],next=original?.k?.[1],live=observed?.k?.[0];
    // The frozen KeyframedMultidimensionalProperty constructor sets BOTH zero
    // spatial handles to null for these straight position paths. This exact
    // mutation is exercised from the real constructor in the associated test.
    // No non-zero handle, missing handle, key time, easing, coordinate or parent
    // is exempted, and the live data are neither mutated nor silently normalized.
    const zero=(handle:unknown)=>Array.isArray(handle)&&handle.length===key?.s?.length&&handle.every(value=>value===0);
    if(original?.a!==1||observed?.a!==1||![2,3].includes(key?.s?.length)||!Array.isArray(next?.s)||next.s.length!==key.s.length||!zero(key.to)||!zero(key.ti)||live?.to!==null||live?.ti!==null)continue;
    for(const handle of ['to','ti']){rendererNormalizations.push({path:`tv[${index}].ks.p.k[0].${handle}`,expected:key[handle],actual:null});key[handle]=null;}
  }
  const differences=placementDifferences(expected,actual);
  if(differences.length)throw new NativePlacementMismatchError(differences,rendererNormalizations);
  return {placements:actual,rendererNormalizations};
}
