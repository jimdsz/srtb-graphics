import {readFile} from 'node:fs/promises';
import {createContext, Script} from 'node:vm';

type SubtitleTemplate = 'BTV_Renvoi' | 'BTV_Semainier';
type SubtitleVariant = '1L' | '2L' | null | undefined;

export interface NativeSubtitleSample {
  frame:number;
  element:{
    data:any;
    textProperty:{currentData:any};
    textAnimator:{renderedLetters:Array<{o:number;m:string;p:number[]}>};
  };
}

const library = new URL('../public/library/v1.7.0/', import.meta.url);
const runtimes = new Map<SubtitleTemplate, Promise<string>>();

function section(source:string, start:string, end:string) {
  const from=source.indexOf(start), to=source.indexOf(end,from+start.length);
  if(from<0||to<0)throw Error(`Frozen Lottie extraction boundary missing: ${start} → ${end}`);
  return source.slice(from,to);
}

async function nativeTextRuntime(templateId:SubtitleTemplate) {
  let pending=runtimes.get(templateId);
  if(!pending){
    pending=readFile(new URL(`${templateId}/lib/lottie-web.esm.mjs`,library),'utf8').then(source=>[
      // Fixed engine constants, not alternate easing/interpolation functions.
      'var initialDefaultFrame=-999999,degToRads=Math.PI/180,bmPow=Math.pow,bmSqrt=Math.sqrt,bmFloor=Math.floor,bmMax=Math.max,bmMin=Math.min;var getDefaultCurveSegments=()=>150;',
      section(source,'function extendPrototype(','function getDescriptor('),
      'var '+section(source,'createTypedArray=','function _typeof$6('),
      'var '+section(source,'BezierFactory=function','function bezFunction('),
      section(source,'function bezFunction(','var pointPool='),
      section(source,'var Matrix=function','function _typeof$3('),
      section(source,'function getFontProperties(','function SlotManager('),
      section(source,'function LetterProps(','function ITextElement('),
    ].join('\n'));
    runtimes.set(templateId,pending);
  }
  return pending;
}

/** Evaluate the frozen native text engine for the first chronological subtitle.
 * Frames are composition frames: do not subtract st. PropertyFactory already
 * subtracts st both from the frame and from the source keyframe times.
 *
 * No browser, renderer, or substitute selector/interpolator is used. The real
 * TextProperty builds A's line metadata and the real TextAnimatorProperty emits
 * SVG LetterProps. Like typography.safe(), only the text value becomes A.
 *
 * This is an opacity/vertical-motion oracle, NOT a font-layout oracle. Font
 * measurement alone is synthetic (A = half an em). For these single-line,
 * by-line, translation/opacity-only animators, width changes matrix[4], never
 * opacity or matrix[5]. No test should expect the returned horizontal offset
 * to match SuisseIntl's actual glyph advance.
 */
export async function nativeSubtitleSample(
  templateId:SubtitleTemplate,
  variant:SubtitleVariant,
  frame:number,
):Promise<NativeSubtitleSample>{
  if(!['BTV_Renvoi','BTV_Semainier'].includes(templateId))throw Error('Unsupported subtitle fixture template');
  if(!Number.isFinite(frame))throw Error('Subtitle fixture requires a finite composition frame');
  if(templateId==='BTV_Renvoi'&&variant!==undefined&&variant!==null&&variant!=='1L'&&variant!=='2L')throw Error('Unsupported Renvoi fixture variant');
  const sourcePath=templateId==='BTV_Renvoi'?`${templateId}/source/${variant||'1L'}/animation.json`:`${templateId}/source/animation.json`;
  const [runtime,fixtureJson]=await Promise.all([nativeTextRuntime(templateId),readFile(new URL(sourcePath,library),'utf8')]);
  // Parse the document INSIDE the VM: native easing checks Array constructors.
  // Fresh context and clone per sample also prevent mutable keyframe caches or
  // LetterProps shared between tests from hiding seek-order regressions.
  const context=createContext({fixtureJson,fixtureFrame:frame,fixtureTemplate:templateId});
  const result=new Script(runtime+`\n(function(){
    const animation=JSON.parse(fixtureJson), fonts=new FontManager();
    fonts.fonts=animation.fonts.list;
    fonts.measureText=(_char,_font,size)=>size/2;
    const layer=animation.layers.filter(layer=>layer.nm==='SOUSTEXTE').sort((a,b)=>a.ip-b.ip)[0];
    if(!layer||layer.sr!==1)throw Error('Native subtitle layer or time-stretch contract changed');
    const text=layer.t, animator=text.a[0], effect=animator.a, selector=animator.s;
    if(text.a.length!==1||selector.b!==4||selector.r!==1||selector.rn!==0||text.p.m!=null||
      Object.keys(effect).some(key=>key!=='p'&&key!=='o')||effect.p.a!==0||effect.o.a!==0||
      effect.o.k!==0||effect.p.k[0]!==0||effect.p.k[2]!==0||
      effect.p.k[1]!== (fixtureTemplate==='BTV_Renvoi'?-10:0))throw Error('Subtitle animator exceeded fixture contract');
    if(text.d.k.length!==1||text.d.k[0].s.ps||text.d.k[0].s.ls||text.d.k[0].s.sz)throw Error('Subtitle layout exceeded fixture contract');
    text.d.k[0].s.t='A';
    const element={data:layer,comp:{renderedFrame:fixtureFrame},globalData:{frameId:1,fontManager:fonts},
      dynamicProperties:[],addDynamicProperty(property){if(!this.dynamicProperties.includes(property))this.dynamicProperties.push(property)}};
    element.textProperty=new TextProperty(element,text);
    element.textAnimator=new TextAnimatorProperty(text,'svg',element);
    element.textAnimator.searchProperties();
    element.textAnimator.getValue();
    element.textAnimator.getMeasures(element.textProperty.currentData,true);
    const letters=element.textAnimator.renderedLetters;
    if(letters.length!==1||!Number.isFinite(letters[0].o)||typeof letters[0].m!=='string')throw Error('Native subtitle did not emit one evaluated SVG letter');
    return JSON.stringify({frame:fixtureFrame,element:{data:layer,textProperty:{currentData:element.textProperty.currentData},textAnimator:{renderedLetters:letters}}});
  })()`,{filename:`${templateId}-frozen-text-fixture.vm.js`}).runInContext(context,{timeout:1000});
  return JSON.parse(result);
}
