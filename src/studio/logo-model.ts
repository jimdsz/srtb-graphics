import type {BroadcastField,FieldValue,ProjectData} from './domain';

export const OVERLAY_LOGO_PREFIX='_studio_overlay_logo_';
export const OVERLAY_LOGO_VERSION=1;
export const overlayLogoAnchors=['top-left','top-center','top-right','bottom-left','bottom-center','bottom-right'] as const;
export const overlayLogoPlates={none:'transparent',white:'#ffffff',black:'#000000',gold:'#f0b900',green:'#007300'} as const;
export const overlayLogoMotions=['none','fade','slide'] as const;
export const overlayLogoDefaults:ProjectData={
  _studio_overlay_logo_version:1,_studio_overlay_logo_enabled:false,_studio_overlay_logo_url:'',
  _studio_overlay_logo_anchor:'top-right',_studio_overlay_logo_size:12,_studio_overlay_logo_x:0,_studio_overlay_logo_y:0,
  _studio_overlay_logo_plate:'none',_studio_overlay_logo_motion:'none',_studio_overlay_logo_delay:0,
};
export const overlayLogoKey=(key:string)=>Object.hasOwn(overlayLogoDefaults,key);
export function overlayLogoFields():Record<string,BroadcastField>{
  const field=(key:string,extra:BroadcastField):BroadcastField=>({default:overlayLogoDefaults[key],'x-section':'Logo supplémentaire',...extra});
  return {
    _studio_overlay_logo_version:field('_studio_overlay_logo_version',{type:'integer',minimum:1,maximum:1,title:'Version du logo supplémentaire'}),
    _studio_overlay_logo_enabled:field('_studio_overlay_logo_enabled',{type:'boolean',title:'Afficher le logo supplémentaire'}),
    _studio_overlay_logo_url:field('_studio_overlay_logo_url',{type:'string',title:'Image du logo supplémentaire','x-control':'image'}),
    _studio_overlay_logo_anchor:field('_studio_overlay_logo_anchor',{type:'string',enum:[...overlayLogoAnchors],title:'Position du logo supplémentaire'}),
    _studio_overlay_logo_size:field('_studio_overlay_logo_size',{type:'number',minimum:4,maximum:25,title:'Taille du logo supplémentaire (%)'}),
    _studio_overlay_logo_x:field('_studio_overlay_logo_x',{type:'number',minimum:-20,maximum:20,title:'Décalage horizontal du logo (%)'}),
    _studio_overlay_logo_y:field('_studio_overlay_logo_y',{type:'number',minimum:-20,maximum:20,title:'Décalage vertical du logo (%)'}),
    _studio_overlay_logo_plate:field('_studio_overlay_logo_plate',{type:'string',enum:Object.keys(overlayLogoPlates),title:'Fond du logo supplémentaire'}),
    _studio_overlay_logo_motion:field('_studio_overlay_logo_motion',{type:'string',enum:[...overlayLogoMotions],title:'Apparition du logo supplémentaire'}),
    _studio_overlay_logo_delay:field('_studio_overlay_logo_delay',{type:'number',minimum:0,maximum:5,title:'Délai du logo supplémentaire (s)'}),
  };
}
export interface OverlayLogoSettings {enabled:boolean;source:FieldValue;anchor:typeof overlayLogoAnchors[number];size:number;x:number;y:number;plate:keyof typeof overlayLogoPlates;motion:typeof overlayLogoMotions[number];delay:number}
export function overlayLogoSettings(data:ProjectData):OverlayLogoSettings{
  const read=(key:string)=>data[OVERLAY_LOGO_PREFIX+key]??overlayLogoDefaults[OVERLAY_LOGO_PREFIX+key];
  const number=(key:string,min:number,max:number)=>{const value=read(key),n=Number(value);if(value===''||value===null||!Number.isFinite(n)||n<min||n>max)throw Error(`Logo supplémentaire : réglage ${key} hors limites.`);return n;};
  const choice=<T extends string>(key:string,values:readonly T[])=>{const value=read(key);if(typeof value!=='string'||!values.includes(value as T))throw Error(`Logo supplémentaire : réglage ${key} invalide.`);return value as T;};
  number('version',1,1);
  const enabled=read('enabled');if(![true,false,'true','false',1,0,'1','0'].includes(enabled as string|number|boolean))throw Error('Logo supplémentaire : activation invalide.');
  return {enabled:[true,'true',1,'1'].includes(enabled as string|number|boolean),source:read('url'),anchor:choice('anchor',overlayLogoAnchors),size:number('size',4,25),x:number('x',-20,20),y:number('y',-20,20),plate:choice('plate',Object.keys(overlayLogoPlates) as (keyof typeof overlayLogoPlates)[]),motion:choice('motion',overlayLogoMotions),delay:number('delay',0,5)};
}
export function overlayLogoSource(data:ProjectData,module:string,base:string){
  const config=overlayLogoSettings(data);if(!config.enabled)return '';
  const source=config.source,raw=typeof source==='object'?source.url:String(source||'');
  if(!raw)throw Error('Choisissez une image pour le logo supplémentaire, ou masquez-le.');
  if(typeof source==='object'&&!source.mimeType.startsWith('image/'))throw Error('Le logo supplémentaire doit être une image.');
  if(raw.startsWith('local-media:'))throw Error('Reconnectez le fichier du logo supplémentaire sur ce poste.');
  const url=new URL(/^img_\d+\./.test(raw)?'lib/images/'+raw:raw,new URL(module,base));
  if(!['http:','https:','blob:','data:'].includes(url.protocol))throw Error('Adresse du logo supplémentaire invalide.');
  return url.href;
}
const clamp=(n:number,min:number,max:number)=>Math.min(max,Math.max(min,n));
export interface LogoBox {x:number;y:number;w:number;h:number}
export function overlayLogoGeometry(data:ProjectData,width:number,height:number,imageWidth=1,imageHeight=1){
  if(![width,height,imageWidth,imageHeight].every(n=>Number.isFinite(n)&&n>0))throw Error('Dimensions du logo supplémentaire invalides.');
  const config=overlayLogoSettings(data),vertical=height/width>1.5,tv=width>height;
  const safe={x:tv?width*.05:80*width/1080,y:tv?height*.05:(vertical?220:100)*height/(vertical?1920:1350),w:width-(tv?width*.1:(vertical?230:160)*width/1080),h:height-(tv?height*.1:(vertical?570:230)*height/(vertical?1920:1350))};
  const padding=config.plate==='none'?0:12*width/1920;
  const scale=Math.min((Math.min(width*config.size/100,safe.w)-2*padding)/imageWidth,(Math.min(height*config.size/100,safe.h)-2*padding)/imageHeight);
  const w=imageWidth*scale,h=imageHeight*scale,pw=w+2*padding,ph=h+2*padding;
  const anchorX=config.anchor.endsWith('right')?safe.x+safe.w-pw:config.anchor.endsWith('center')?safe.x+(safe.w-pw)/2:safe.x;
  const anchorY=config.anchor.startsWith('bottom')?safe.y+safe.h-ph:safe.y;
  const x=clamp(anchorX+config.x*width/100,safe.x,safe.x+safe.w-pw),y=clamp(anchorY+config.y*height/100,safe.y,safe.y+safe.h-ph);
  return {image:{x:x+padding,y:y+padding,w,h},plate:{x,y,w:pw,h:ph},safe,x:(x-anchorX)/width*100,y:(y-anchorY)/height*100};
}
const smooth=(n:number)=>{const p=clamp(n,0,1);return p*p*(3-2*p);};
/** End is the end of native motion, excluding any transparent terminal hold. */
export function overlayLogoMotion(data:ProjectData,seconds:number,end=Infinity){
  const config=overlayLogoSettings(data);
  if(!config.enabled||!Number.isFinite(seconds)||seconds<config.delay||seconds>=end-.04)return {opacity:0,progress:0};
  const progress=config.motion==='none'?1:smooth((seconds-config.delay)/.6);
  return {opacity:progress*smooth((end-.04-seconds)/.32),progress};
}
