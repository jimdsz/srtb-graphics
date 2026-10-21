import {PreviewWebGLGuard} from './preview-webgl-guard';

/** Fused preview shader: video -> correctly framed/graded raster in ONE pass.
 * Avoids video -> 2D -> GL -> 2D -> GL -> 2D readbacks across GPU processes.
 * The equations and LUT are those of the frozen native PackGrade renderer. */
export class BAPreviewFrame {
  readonly canvas=document.createElement('canvas');
  private gl:WebGLRenderingContext;
  private program:WebGLProgram;
  private picture:WebGLTexture;
  private guard:PreviewWebGLGuard;
  private locations:Record<string,WebGLUniformLocation|null>={};
  constructor(lut:Uint8Array){
    const gl=this.canvas.getContext('webgl',{alpha:true,premultipliedAlpha:true,preserveDrawingBuffer:true,antialias:false});
    if(!gl)throw Error('WebGL requis pour l’aperçu couleur.');this.gl=gl;
    let guard:PreviewWebGLGuard|undefined;
    try{
    const vertex='attribute vec2 p;varying vec2 uv;void main(){gl_Position=vec4(p,0.,1.);uv=(p+1.)*.5;}',fragment=`precision highp float;
varying vec2 uv;uniform sampler2D picture;uniform sampler2D lut;uniform vec2 logical;uniform vec4 placement;uniform bool rec709;uniform bool grading;uniform bool intro;
vec3 sampleLut(vec3 c){vec3 v=clamp(c,0.,1.)*63.;float b=floor(v.b);float b2=min(63.,b+1.);vec2 p1=vec2(mod(b,8.)*64.+v.r+.5,floor(b/8.)*64.+v.g+.5)/512.;vec2 p2=vec2(mod(b2,8.)*64.+v.r+.5,floor(b2/8.)*64.+v.g+.5)/512.;return mix(texture2D(lut,p1).rgb,texture2D(lut,p2).rgb,fract(v.b));}
void main(){vec2 pos=vec2(uv.x,1.-uv.y)*logical;vec2 at=(pos-placement.xy)/placement.zw;vec4 c=vec4(0.);if(at.x>=0.&&at.x<=1.&&at.y>=0.&&at.y<=1.)c=texture2D(picture,at);
if(rec709){vec3 linear=pow(c.rgb,vec3(2.4));c.rgb=mix(12.92*linear,1.055*pow(linear,vec3(1./2.4))-.055,step(vec3(.0031308),linear));}
float a=c.a+(intro?.1*(1.-c.a):0.);vec3 rgb=c.rgb*c.a;
if(grading){float ga=.1+.9*a;rgb=sampleLut(rgb/ga)*ga;a=ga;}gl_FragColor=vec4(rgb,a);}`;
    const shader=(type:number,source:string)=>{const s=gl.createShader(type)!;gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){const message=gl.getShaderInfoLog(s);gl.deleteShader(s);throw Error(message||'Shader d’aperçu refusé.');}return s;};
    const vs=shader(gl.VERTEX_SHADER,vertex),fs=shader(gl.FRAGMENT_SHADER,fragment),program=gl.createProgram()!;gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('Shader d’aperçu non lié.');this.program=program;gl.useProgram(program);
    for(const name of ['picture','lut','logical','placement','rec709','grading','intro'])this.locations[name]=gl.getUniformLocation(program,name);
    const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);const p=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(p);gl.vertexAttribPointer(p,2,gl.FLOAT,false,0,0);
    const texture=(unit:number)=>{gl.activeTexture(gl.TEXTURE0+unit);const t=gl.createTexture()!;gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);return t;};
    this.picture=texture(0);gl.uniform1i(this.locations.picture,0);texture(1);gl.uniform1i(this.locations.lut,1);
    const atlas=new Uint8Array(512*512*3);for(let b=0;b<64;b++)for(let g=0;g<64;g++)for(let r=0;r<64;r++){const from=((b*64+g)*64+r)*3,to=((Math.floor(b/8)*64+g)*512+(b%8*64+r))*3;atlas.set(lut.subarray(from,from+3),to);}
    gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,512,512,0,gl.RGB,gl.UNSIGNED_BYTE,atlas);
    guard=new PreviewWebGLGuard(gl);guard.check();this.guard=guard;
    }
    catch(error){guard?.dispose();gl.getExtension('WEBGL_lose_context')?.loseContext();throw error;}
  }
  draw(source:HTMLVideoElement|HTMLImageElement,width:number,height:number,kind:'intro'|'body'|'pack',placement:{x:number;y:number;width:number;height:number},rec709:boolean){
    const gl=this.gl,sampled=this.guard.source(source);if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;gl.viewport(0,0,width,height);}
    gl.useProgram(this.program);gl.uniform2f(this.locations.logical,1920,kind==='pack'?540:1080);gl.uniform4f(this.locations.placement,placement.x,placement.y,placement.width,placement.height);
    gl.uniform1i(this.locations.rec709,Number(rec709));gl.uniform1i(this.locations.grading,Number(kind==='pack'));gl.uniform1i(this.locations.intro,Number(kind==='intro'));
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.picture);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,sampled);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);this.guard.check();return this.canvas;
  }
  dispose(){this.guard.dispose();this.gl.getExtension('WEBGL_lose_context')?.loseContext();}
}
