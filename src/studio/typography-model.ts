import type {BroadcastTemplate,ProjectData} from './domain';

export const TYPOGRAPHY_KEY='_studio_typography';
export const DEFAULT_TEXT_CASE='_studio_default_text_case';
export interface TextStyle {x:number;y:number;size:number;font:string;fontName:string;align:'original'|'left'|'center'|'right';lineHeight:number;tracking:number;rotation:number;bold:boolean;italic:boolean;colour:string;case:'original'|'typed'|'upper'|'lower'}
export type TextStyles=Record<string,Partial<TextStyle>>;
export const styleDefaults:TextStyle={x:0,y:0,size:100,font:'original',fontName:'',align:'original',lineHeight:1.15,tracking:0,rotation:0,bold:false,italic:false,colour:'original',case:'original'};
export function textFields(template:Pick<BroadcastTemplate,'fields'>){return Object.entries(template.fields).filter(([key,f])=>!key.startsWith('_studio_')&&f.type==='string'&&!f.enum&&!f['x-control']&&!/url|sequence|sponsor_logo|reveal/.test(key));}
export function styleKey(field:string,format='tv'){return format+':'+field;}
export function textStyles(data:ProjectData):TextStyles{return parseStyles(data[TYPOGRAPHY_KEY]??'{}');}
export function parseStyles(raw:unknown,allowed?:Set<string>):TextStyles{
  if(typeof raw!=='string'||raw.length>48000)throw Error('Mise en forme du texte invalide.');
  let parsed;try{parsed=JSON.parse(raw);}catch{throw Error('Mise en forme du texte illisible.');}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||Object.keys(parsed).length>160)throw Error('Mise en forme du texte invalide.');
  const result:TextStyles={};
  for(const [key,value]of Object.entries(parsed)){
    if(!/^(tv|portrait|vertical):[a-z0-9_]+$/.test(key)||allowed&&!allowed.has(key.slice(key.indexOf(':')+1))||!value||typeof value!=='object'||Array.isArray(value))throw Error('Bloc de texte inconnu.');
    const style:Partial<TextStyle>={};
    for(const [k,v]of Object.entries(value)){
      if(!Object.hasOwn(styleDefaults,k))throw Error('Option de texte inconnue.');
      const ranges:Record<string,[number,number]>={x:[-4096,4096],y:[-4096,4096],size:[10,400],lineHeight:[.5,3],tracking:[-10,50],rotation:[-180,180]};
      if(k in ranges){const [min,max]=ranges[k];if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw Error('Valeur de texte hors limites.');}
      else if(['bold','italic'].includes(k)){if(typeof v!=='boolean')throw Error('Style de texte invalide.');}
      else if(k==='font'){if(typeof v!=='string'||!['original','benin','suisse'].includes(v)&&!/^local-font:[a-f0-9]{64}$/.test(v))throw Error('Police invalide.');}
      else if(k==='fontName'){if(typeof v!=='string'||v.length>200||/[\x00-\x1f<>]/.test(v))throw Error('Nom de police invalide.');}
      else if(k==='colour'){if(!['original','#ffffff','#000000','#f0b900','#007300','#eb1905'].includes(String(v)))throw Error('Couleur de texte hors charte.');}
      else if(k==='align'){if(!['original','left','center','right'].includes(String(v)))throw Error('Alignement invalide.');}
      else if(k==='case'&&!['original','typed','upper','lower'].includes(String(v)))throw Error('Casse invalide.');
      Object.assign(style,{[k]:v});
    }
    result[key]=style;
  }
  return result;
}
const styleCache=new WeakMap<ProjectData,{raw:unknown;styles:TextStyles}>();
export function currentStyle(data:ProjectData,field:string){const raw=data[TYPOGRAPHY_KEY]??'{}';let cached=styleCache.get(data);if(!cached||cached.raw!==raw){cached={raw,styles:parseStyles(raw)};styleCache.set(data,cached);}return cached.styles[styleKey(field,String(data._studio_format||'tv'))];}
export function patchTextStyle(data:ProjectData,field:string,patch:Partial<TextStyle>|null):ProjectData{
  const styles=textStyles(data),key=styleKey(field,String(data._studio_format||'tv'));
  if(patch===null)delete styles[key];else styles[key]={...styles[key],...patch};
  return {[TYPOGRAPHY_KEY]:JSON.stringify(styles)};
}
/** Content editing is not itself a request to opt out of project casing or to
 * replace native glyph geometry. Older projects retain their established UI. */
export function textContentPatch(data:ProjectData,field:string,value:string):ProjectData{
  return {...(data[DEFAULT_TEXT_CASE]==='upper'?{}:patchTextStyle(data,field,currentStyle(data,field)||{size:100,case:'typed'})),[field]:value};
}
export function shapedText(value:unknown,style:Partial<TextStyle>,upper=false){const text=String(value??'').replace(/\r\n?|\n/g,'\n');return style.case==='upper'||(style.case??'original')==='original'&&upper?text.toLocaleUpperCase('fr'):style.case==='lower'?text.toLocaleLowerCase('fr'):text;}

const displayCaseCache=new WeakMap<ProjectData,{template:Pick<BroadcastTemplate,'fields'>;view:ProjectData}>();
/** A display-only view: retain typed source text and per-format overrides. No
 * case-only typography overlay is introduced; native fitting stays native. */
export function defaultTextCaseData(template:Pick<BroadcastTemplate,'fields'>,data:ProjectData):ProjectData{
  if(data[DEFAULT_TEXT_CASE]!=='upper')return data;
  const cached=displayCaseCache.get(data);if(cached?.template===template)return cached.view;
  const view={...data};
  for(const [key]of textFields(template)){
    const choice=currentStyle(data,key)?.case;
    if(typeof data[key]==='string'&&(!choice||choice==='upper'))view[key]=(data[key] as string).toLocaleUpperCase('fr');
  }
  displayCaseCache.set(data,{template,view});return view;
}
