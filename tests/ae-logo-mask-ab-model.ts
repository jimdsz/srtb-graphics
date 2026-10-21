// Local qualification only. The candidate comes from the frozen repair, not
// from a new approximation of the AE artwork or a production modification.
export function invariant(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export class ABTransformMismatch extends Error{
  constructor(readonly label:string,readonly differences:unknown[],readonly expected:unknown,readonly actual:unknown,readonly rendererNormalizations:unknown[]=[]){
    super(`${label}: ${JSON.stringify(differences)}. Comparison stopped.`);this.name='ABTransformMismatch';
  }
}
export function verifyExactGroupTransform(actual:any,expected:any,label:string){
  const rendererNormalizations:unknown[]=[];let comparisonActual=actual;
  // Proven with the real frozen SVGShapeElement.searchShapes function in the
  // companion test: this is renderer bookkeeping, not a transform property.
  if(actual&&expected&&!Object.hasOwn(expected,'_render')&&actual._render===true){
    comparisonActual={...actual};delete comparisonActual._render;
    rendererNormalizations.push({path:'V.group.transform._render',expectedPresent:false,actual:true,rule:'Frozen SVGShapeElement.searchShapes adds _render=true to a visible transform.'});
  }
  if(same(comparisonActual,expected))return rendererNormalizations;
  const differences:unknown[]=[];
  function compare(a:any,b:any,path:string){
    if(same(a,b))return;
    if(a!==null&&b!==null&&typeof a==='object'&&typeof b==='object'&&Array.isArray(a)===Array.isArray(b)){
      for(const key of new Set([...Object.keys(a),...Object.keys(b)])){
        const next=Array.isArray(a)?`${path}[${key}]`:`${path}.${key}`;
        if(!Object.hasOwn(a,key)||!Object.hasOwn(b,key))differences.push({path:next,expected:b[key],actual:a[key],expectedPresent:Object.hasOwn(b,key),actualPresent:Object.hasOwn(a,key)});
        else compare(a[key],b[key],next);
      }
    }else differences.push({path,expected:b,actual:a});
  }
  compare(comparisonActual,expected,'V.group.transform');
  // Keep the initial strict guard even if only key serialization order differs;
  // expose the full objects before deciding whether a normalization is proven.
  if(!differences.length)differences.push({path:'V.group.transform',reason:'Object serialization order differs; no field-value difference located.'});
  throw new ABTransformMismatch(label,differences,expected,actual,rendererNormalizations);
}
export function preparePolygonProbe(source:any,repair:(data:any)=>any){
  const comp=structuredClone(source.assets.find((item:any)=>item.nm==='Anim_TV_Roll'));
  invariant(comp,'Original Anim_TV_Roll composition missing.');
  const v=comp.layers.find((layer:any)=>layer.ind===4&&layer.nm==='V');
  invariant(v?.st===0&&v.sr===1,'V source clock changed.');
  const items=v.shapes?.[0]?.it,shape=items?.find((item:any)=>item.ty==='sh');
  const rectangle=items?.find((item:any)=>item.ty==='gr'&&item.nm==='Rectangle 1');
  const rect=rectangle?.it.find((item:any)=>item.ty==='rc'),tr=rectangle?.it.find((item:any)=>item.ty==='tr');
  invariant(items?.some((item:any)=>item.ty==='mm'&&item.mm===3),'Native V subtraction missing.');
  invariant(rect?.s.a===0&&same(rect.s.k,[1574.688,788.547])&&rect.p.a===0&&same(rect.p.k,[0,0])&&rect.r.a===0&&rect.r.k===0,'Unsupported subtract rectangle.');
  for(const [key,expected] of Object.entries({p:[62.582,834.097],a:[0,0],s:[100,100],r:0,o:100,sk:0,sa:0}))
    invariant(tr?.[key]?.a===0&&same(tr[key].k,expected),`Subtract rectangle transform differs at ${key}.`);
  invariant(shape?.ks.a===1&&same(shape.ks.k.map((key:any)=>key.t),[11,12,16])&&shape.ks.k.every((key:any)=>key.h===1&&key.s?.length===1&&!key.e),'Only the original held V keys are qualified.');
  const originalShape=structuredClone(shape.ks.k[0].s[0]),groupTransform=structuredClone(items.find((item:any)=>item.ty==='tr'));
  const edge=tr.p.k[1]-rect.s.k[1]/2,left=tr.p.k[0]-rect.s.k[0]/2,right=tr.p.k[0]+rect.s.k[0]/2,bottom=tr.p.k[1]+rect.s.k[1]/2;
  invariant(originalShape.c&&originalShape.i.concat(originalShape.o).every((p:number[])=>same(p,[0,0])),'V must contain closed straight segments.');
  invariant(originalShape.v.every(([x,y]:number[])=>x>left&&x<right&&y<bottom),'Subtract rectangle does not cover the complete lower half-plane of this V.');
  // Before the first key (11), Lottie holds its first shape at local frame 10.
  // A separate instance of the SAME Lottie module will evaluate the repair.
  const data={v:source.v,fr:25,ip:0,op:80,w:1920,h:1080,assets:[comp],layers:[{ddd:0,ind:1,ty:0,nm:'local polygon probe',refId:comp.id,w:1920,h:1080,
    ks:{o:{a:0,k:100},r:{a:0,k:0},p:{a:0,k:[0,0,0]},a:{a:0,k:[0,0,0]},s:{a:0,k:[100,100,100]}},ip:0,op:80,st:0,sr:1}]};
  repair(data);
  invariant(same(v.shapes[0].it.map((item:any)=>item.ty),['sh','fl','tr']),'Frozen repair did not remove exactly the rectangle and Merge Paths operands.');
  invariant(same(groupTransform,v.shapes[0].it[2]),'Frozen repair changed the V group transform.');
  const expectedShape=structuredClone(v.shapes[0].it[0].ks.k[0].s[0]);
  invariant(expectedShape.v.every((p:number[])=>p[1]<=edge)&&expectedShape.v.some((p:number[])=>p[1]===edge),'Frozen repair did not produce the expected exact clipping edge.');
  return {data,originalShape,expectedShape,groupTransform,evidence:{localFrame:10,heldSourceKey:11,clipEdge:edge,rectangleBounds:{left,right,top:edge,bottom},originalShape,clippedShape:expectedShape,groupTransform}};
}

type EvaluatedShape={_length:number;c:boolean;v:ArrayLike<ArrayLike<number>>;i:ArrayLike<ArrayLike<number>>;o:ArrayLike<ArrayLike<number>>};
export function verifyEvaluatedPolygon(live:EvaluatedShape,raw:any){
  invariant(live.c===raw.c&&live._length===raw.v.length,'Evaluated polygon closure or vertex count differs.');
  for(let n=0;n<live._length;n++)for(let axis=0;axis<2;axis++)for(const key of ['v','i','o'] as const){
    // Lottie normalizes relative tangents to absolute Float32 coordinates.
    const expected=Math.fround(raw.v[n][axis]+(key==='v'?0:raw[key][n][axis]));
    invariant(live[key][n][axis]===expected,`Evaluated polygon differs at ${key}[${n}][${axis}]: ${live[key][n][axis]} != ${expected}.`);
  }
  return {vertices:Array.from({length:live._length},(_,n)=>Array.from(live.v[n])),closed:live.c,precision:'Lottie Float32, absolute tangents'};
}

// Deliberately matches the current BA reconstructMerge serializer. Runtime
// requires it to reproduce the existing custom V d exactly before any edit.
export function evaluatedPathData(shape:EvaluatedShape){
  const n=shape._length;invariant(Number.isInteger(n)&&n>0&&shape.c,'Expected a nonempty closed evaluated path.');
  for(const key of ['v','i','o'] as const)for(let p=0;p<n;p++)
    invariant(shape[key][p]?.length>=2&&Number.isFinite(shape[key][p][0])&&Number.isFinite(shape[key][p][1]),`Invalid evaluated path ${key}[${p}].`);
  let d=`M${shape.v[0][0]},${shape.v[0][1]}`;
  for(let p=1;p<n;p++)d+=` C${shape.o[p-1][0]},${shape.o[p-1][1]} ${shape.i[p][0]},${shape.i[p][1]} ${shape.v[p][0]},${shape.v[p][1]}`;
  return d+` C${shape.o[n-1][0]},${shape.o[n-1][1]} ${shape.i[0][0]},${shape.i[0][1]} ${shape.v[0][0]},${shape.v[0][1]}z`;
}

export function exactRgbaReplay(a:Uint8ClampedArray,b:Uint8ClampedArray){
  invariant(a.length===b.length&&a.length%4===0,'Replay dimensions differ.');let changedPixels=0,maxChannelDifference=0;
  for(let i=0;i<a.length;i+=4){let changed=false;for(let c=0;c<4;c++){const delta=Math.abs(a[i+c]-b[i+c]);if(delta)changed=true;maxChannelDifference=Math.max(maxChannelDifference,delta);}if(changed)changedPixels++;}
  return {exact:changedPixels===0,pixels:a.length/4,changedPixels,maxChannelDifference};
}
