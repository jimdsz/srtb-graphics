import type {CommercialSequence, CommercialSequenceSpan} from './model';

type Layout = CommercialSequence['layout'];
type Point = readonly [number, number];
interface NativePath {points: readonly Point[]; ins: readonly Point[]; outs: readonly Point[]}
interface Vertex {x: number; y: number; at: number}
export interface ReadableThreadRoute {
  readonly vertices: readonly Vertex[];
  readonly length: number;
  readonly glow: boolean;
  readonly delay: number;
}
export interface ReadableThreadStroke {
  readonly boundary: number;
  readonly points: readonly Point[];
  readonly width: number;
  readonly alpha: number;
  readonly color: string;
}

// Unchanged vertices and spatial tangents from native state-motion.jsx.
const LEFT: NativePath = {
  points: [[960,455],[825,454],[715,350],[510,350]],
  ins: [[0,0],[80,0],[85,0],[85,0]], outs: [[-75,0],[-100,0],[-100,0],[0,0]],
};
const RIGHT: NativePath = {
  points: [[960,455],[1170,454],[1190,698],[1413,698]],
  ins: [[0,0],[-100,0],[-50,-60],[-95,0]], outs: [[100,0],[90,0],[70,80],[0,0]],
};
const RETURN: NativePath = {
  points: [[1413,698],[1150,698],[1115,375],[960,368]],
  ins: [[0,0],[130,0],[0,130],[70,0]], outs: [[-100,0],[-130,0],[0,-75],[0,0]],
};
const smooth = (time: number, start: number, end: number) => {
  const q = Math.max(0, Math.min(1, (time-start)/(end-start)));
  return q*q*q*(q*(q*6-15)+10);
};
const centers: Record<Layout, readonly number[]> = {
  central: [960], columns: [532,1388], left: [792], right: [1128], final: [960],
};
const CENTER_Y = 478;
export const READABLE_THREAD_BEFORE = .62;
export const READABLE_THREAD_AFTER = .75;
const routeCache = new Map<string, readonly ReadableThreadRoute[]>();

/** Map the native curve and every tangent together, preserving smooth joins. */
function mappedPath(path: NativePath, from: Point, to: Point): NativePath {
  const first = path.points[0], last = path.points[path.points.length-1];
  const dx = last[0]-first[0], dy = last[1]-first[1], length = Math.hypot(dx,dy);
  const tx = to[0]-from[0], ty = to[1]-from[1], targetLength = Math.hypot(tx,ty);
  const bend = Math.max(.45, Math.min(1.25, targetLength/length));
  const transform = (point: Point): Point => {
    const along = (point[0]*dx+point[1]*dy)/(length*length);
    const across = (-point[0]*dy+point[1]*dx)/length*bend;
    return [along*tx-across*ty/targetLength, along*ty+across*tx/targetLength];
  };
  return {
    points: path.points.map((point,index) => {
      if(index===0)return from;if(index===path.points.length-1)return to;
      const p=transform([point[0]-first[0],point[1]-first[1]]);return [from[0]+p[0],from[1]+p[1]];
    }),
    ins: path.ins.map(transform), outs: path.outs.map(transform),
  };
}
function reversed(path: NativePath): NativePath {
  return {points:[...path.points].reverse(), ins:[...path.outs].reverse(), outs:[...path.ins].reverse()};
}
function route(path: NativePath, sourceX: number, targetX: number, glow: boolean, delay: number): ReadableThreadRoute {
  // A same-position sequence still has a visible hand-off, rather than a
  // collapsed zero-length curve. Both ends stay local to its composition.
  const same = Math.abs(sourceX-targetX)<.01;
  const curve = mappedPath(path, [sourceX-(same?160:0),CENTER_Y], [targetX+(same?160:0),CENTER_Y]);
  const vertices: Vertex[] = [{x:curve.points[0][0],y:curve.points[0][1],at:0}];
  let length=0;
  for(let i=1;i<curve.points.length;i++){
    const p=curve.points[i-1],q=curve.points[i];
    const a:Point=[p[0]+curve.outs[i-1][0],p[1]+curve.outs[i-1][1]];
    const b:Point=[q[0]+curve.ins[i][0],q[1]+curve.ins[i][1]];
    // The native canvas implementation uses the same 40 samples per Bézier.
    for(let j=1;j<=40;j++){
      const t=j/40,u=1-t,x=u**3*p[0]+3*u*u*t*a[0]+3*u*t*t*b[0]+t**3*q[0],y=u**3*p[1]+3*u*u*t*a[1]+3*u*t*t*b[1]+t**3*q[1];
      const previous=vertices[vertices.length-1];length+=Math.hypot(x-previous.x,y-previous.y);vertices.push({x,y,at:length});
    }
  }
  return {vertices,length,glow,delay};
}
/** Geometry is reused for all occurrences of the same pair of layouts. */
export function readableSequenceThreadRoutes(from: Layout, to: Layout): readonly ReadableThreadRoute[] {
  const key=from+'/'+to,cached=routeCache.get(key);if(cached)return cached;
  const source=centers[from],target=centers[to];let routes:ReadableThreadRoute[];
  if(source.length===2&&target.length===2){
    routes=[route(LEFT,source[0],target[0],true,0),route(RIGHT,source[1],target[1],false,.13)];
  }else if(target.length===2){
    routes=[route(LEFT,source[0],target[0],true,0),route(RIGHT,source[0],target[1],false,.13)];
  }else if(source.length===2){
    routes=[route(RETURN,source[1],target[0],true,0),route(reversed(LEFT),source[0],target[0],false,.13)];
  }else{
    routes=[route(target[0]<source[0]?RETURN:RIGHT,source[0],target[0],true,0)];
  }
  routeCache.set(key,routes);return routes;
}
function trim(route: ReadableThreadRoute, from: number, to: number): Point[] {
  const points:Point[]=[];
  for(let i=1;i<route.vertices.length;i++){
    const a=route.vertices[i-1],b=route.vertices[i],begin=Math.max(a.at,from*route.length),stop=Math.min(b.at,to*route.length);
    if(stop<=begin||b.at===a.at)continue;
    const p=(begin-a.at)/(b.at-a.at),q=(stop-a.at)/(b.at-a.at);
    if(!points.length)points.push([a.x+(b.x-a.x)*p,a.y+(b.y-a.y)*p]);
    points.push([a.x+(b.x-a.x)*q,a.y+(b.y-a.y)*q]);
  }
  return points;
}
/** Pure, seekable overlay: neither edits the sequence order nor changes timing. */
export function readableSequenceThreads(time: number, spans: readonly CommercialSequenceSpan[]): ReadableThreadStroke[] {
  if(!Number.isFinite(time))return [];
  const strokes:ReadableThreadStroke[]=[];
  for(let i=1;i<spans.length;i++){
    const previous=spans[i-1],next=spans[i],boundary=next.start;
    if(!Number.isFinite(boundary)||previous.end<=previous.start||next.end<=next.start||Math.abs(previous.end-boundary)>.001)continue;
    const start=boundary-Math.min(READABLE_THREAD_BEFORE,(previous.end-previous.start)/3);
    const end=boundary+Math.min(READABLE_THREAD_AFTER,(next.end-next.start)/3);
    if(time<=start||time>=end)continue;
    // Preserve the native trim cadence, compressed only for unusually short spans.
    const scale=(end-start)/(READABLE_THREAD_BEFORE+READABLE_THREAD_AFTER);
    for(const path of readableSequenceThreadRoutes(previous.layout,next.layout)){
      const pathStart=start+path.delay*scale;
      if(time<=pathStart)continue;
      for(const width of path.glow?[10,2.2]:[2.2]){
        const lag=path.glow&&width<4?.035:0;
        const from=smooth(time,pathStart+(.36+lag)*scale,end-.04*scale);
        const to=smooth(time,pathStart+lag*scale,pathStart+(.67+lag)*scale);
        if(to<=from)continue;
        const points=trim(path,from,to);if(points.length<2)continue;
        strokes.push({boundary,points,width,alpha:width>4?.14:.72,color:width>4?'#ffffff':'#f7faed'});
      }
    }
  }
  return strokes;
}
/** Call once per reading frame; native legacy threads and bookends stay separate. */
export function drawReadableSequenceThreads(context: CanvasRenderingContext2D, time: number, spans: readonly CommercialSequenceSpan[]): void {
  const strokes=readableSequenceThreads(time,spans);if(!strokes.length)return;
  context.save();
  try{
    const alpha=context.globalAlpha;context.lineCap='round';context.lineJoin='round';
    for(const stroke of strokes){
      context.globalAlpha=alpha*stroke.alpha;context.strokeStyle=stroke.color;context.lineWidth=stroke.width;
      context.beginPath();context.moveTo(...stroke.points[0]);
      for(let i=1;i<stroke.points.length;i++)context.lineTo(...stroke.points[i]);
      context.stroke();
    }
  }finally{context.restore();}
}
