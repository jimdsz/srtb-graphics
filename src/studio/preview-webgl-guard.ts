import {previewCanvasContext,checkPreviewCanvas} from './preview-canvas-guard';
export type PreviewWebGLSource=HTMLVideoElement|HTMLImageElement|HTMLCanvasElement;

const contextError=()=>Error('Le processeur graphique ne répond plus pour cet aperçu. Relancez l’aperçu ; vos réglages sont conservés.');

/** Preview only. WebGL reports failed uploads/draws through its error flag,
 * not necessarily a JS exception: returning that canvas could repeat an old
 * texture while the video clock and decoder continue normally.
 * One capability read per context; one error read per completed render.
 * No readPixels/finish, colour conversion, encoding or delivery changes. */
export class PreviewWebGLGuard {
  readonly maxTextureSize:number;
  private reduced?:HTMLCanvasElement;
  private lost=false;
  private closed=false;
  private readonly onLost=()=>{this.lost=true;};
  constructor(private gl:WebGLRenderingContext){
    if(gl.isContextLost())throw contextError();
    this.maxTextureSize=Number(gl.getParameter(gl.MAX_TEXTURE_SIZE));
    if(!Number.isSafeInteger(this.maxTextureSize)||this.maxTextureSize<1)throw contextError();
    gl.canvas.addEventListener('webglcontextlost',this.onLost);
  }
  /** Preserve the original source when supported. Only over-limit inputs need
   * a bounded 2D intermediate; its alpha and aspect ratio are retained. */
  source(source:PreviewWebGLSource):PreviewWebGLSource{
    this.assertContext();
    const width='videoWidth' in source?source.videoWidth:'naturalWidth' in source?source.naturalWidth:source.width;
    const height='videoHeight' in source?source.videoHeight:'naturalHeight' in source?source.naturalHeight:source.height;
    if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw Error('L’image du média n’est pas disponible pour cet aperçu. Relancez l’aperçu.');
    if(width<=this.maxTextureSize&&height<=this.maxTextureSize)return source;
    const scale=this.maxTextureSize/Math.max(width,height),w=Math.max(1,Math.floor(width*scale)),h=Math.max(1,Math.floor(height*scale));
    const canvas=this.reduced??=document.createElement('canvas');
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
    const context=previewCanvasContext(canvas);
    try{context.clearRect(0,0,w,h);context.drawImage(source,0,0,w,h);}
    catch(cause){throw Error('L’image du média ne peut pas être préparée pour cet aperçu. Relancez l’aperçu.',{cause});}
    checkPreviewCanvas(context);
    return canvas;
  }
  /** Call after draw and BEFORE copying/publishing its canvas. A failed upload
   * must never be accepted as another successfully presented video frame. */
  check(){
    this.assertContext();
    const error=this.gl.getError();
    if(error===this.gl.CONTEXT_LOST_WEBGL)throw contextError();
    if(error===this.gl.OUT_OF_MEMORY)throw Error('Mémoire graphique insuffisante pour afficher cet aperçu. Fermez les aperçus inutilisés puis relancez ; vos réglages sont conservés.');
    if(error!==this.gl.NO_ERROR)throw Error(`Le processeur graphique a refusé une image de l’aperçu (0x${error.toString(16)}). Relancez l’aperçu ; vos réglages sont conservés.`);
  }
  private assertContext(){if(this.closed||this.lost||this.gl.isContextLost())throw contextError();}
  dispose(){if(this.closed)return;this.closed=true;this.gl.canvas.removeEventListener('webglcontextlost',this.onLost);if(this.reduced){this.reduced.width=0;this.reduced.height=0;this.reduced=undefined;}}
}
