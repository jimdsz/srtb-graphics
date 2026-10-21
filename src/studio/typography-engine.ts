import type {BroadcastTemplate,ProjectData} from './domain';
import type {LegacyGraphic} from './video/engine';
import {TYPOGRAPHY_KEY,DEFAULT_TEXT_CASE,defaultTextCaseData,currentStyle,textFields,shapedText,textStyles} from './typography-model';
import type {TextStyle} from './typography-model';
import {prepareTextFonts,fontFamily} from './typography-fonts';
import {localDisplacement,nativeTextStyle} from './typography-position';
import {installOverlayLogo} from './logo-render';
import {liveTextEdit} from './live-preview';
import {createTextReveal,textRevealParent} from './typography-reveal';
import {setSvgAttribute} from './svg-attributes';
import {nativeTextLayerHidden} from './typography-visibility';
import {nativeLineMotion,applyNativeLineMotion} from './typography-line-motion';
import {installImageSizing} from './image-sizing';
import {installAELogoCompatibility} from './ae-logo-compatibility';
import {installRelayPlacement} from './relay-placement-engine';
import {createRenvoiSignage} from './renvoi-signage-engine';
import {installCeSoirBackground} from './ce-soir-background-engine';
export {installPortableFonts} from './typography-fonts';
const NS='http://www.w3.org/2000/svg';
const svg=(tag:string)=>document.createElementNS(NS,tag);
function baField(name:string,scope:string){
  if(scope==='Inedit')return '_inedit_label';
  if(name==='Avec la participation de')return '_sponsor_label';
  if(name==='SOUSTEXTE 2')return '_sous_titre_pack';if(name==='SOUSTEXTE')return '_credit_pack';
  if(/THEM/.test(name))return '_thematique';
  if(name==='JOUR')return '_jour_1';
  const day=name.match(/^JOUR[ _](\d)$/)||name.match(/^TEXTE HAUT JOUR(?: (\d))?$/);if(day)return '_jour_'+(day[1]||1);
  const hour=name.match(/^HEURE[ _](\d)$/)||name.match(/^TEXTE BAS HORAIRE(?: (\d))?$/);if(hour)return '_heure_'+(hour[1]||1);
  if(['1L TITRE','TYPO 2L 3','2 LIGNES HAUT','1 LIGNE 1','1 LIGNE 2'].includes(name))return '_titre_ligne_1';
  if(['2L TITRE','TYPO 2L 4','2 LIGNES BAS','__TITLE_3L_PACK_2','__TITLE_3L_BODY_2'].includes(name))return '_titre_ligne_2';
  if(['3L TITRE','3 LIGNES BAS'].includes(name))return '_titre_ligne_3';
  return '';
}
function renvoiField(name:string){
  if(['TEXTE HAUT 1L','TEXTE BAS 1L','TEXTE HAUT 2L'].includes(name))return 'title';
  if(name==='TEXTE BAS 2L')return 'title2';
  if(name==='SOUSTEXTE')return 'subtitle';
  if(name==='TEXTE RENVOI')return 'announcement';
  return '';
}
function evenementField(name:string){
  return ({'TEXTE HAUT':'intro_top','TEXTE BAS':'intro_bottom','TEXTE JAUNE':'theme','THEMATIQUE 2L':'theme','TITRE 2 LIGNES HAUT':'title_1','TITRE 2 LIGNES BAS':'title_2',JOUR:'day',HORAIRE:'time'} as Record<string,string>)[name]||'';
}
function semainierField(name:string,ip=0){
  if(name==='CETTE')return 'intro_top';if(name==='SEMAINE')return 'intro_bottom';if(name==='7 JOURS')return 'final_top';if(name==='7 GENRES')return 'final_bottom';
  if(name==='SOUSTEXTE')return `programme_${Math.max(1,Math.min(7,Math.round((ip-99)/60)+1))}_title`;
  const match=name.match(/^TEXTE (\d) (?:HAUT|BAS)$/);return match?`programme_${match[1]}_category`:'';
}
const htmlFields:Record<string,Record<string,string>>={
  BTV_Ce_Soir:{'.heading':'_heading','.station':'_station',...Object.fromEntries([1,2,3].flatMap(n=>[[`.card:nth-child(${n}) .hour`,`_time_${n}`],[`.card:nth-child(${n}) .title`,`_title_${n}`]]))},
  BTV_Relais_Antenne:{'.current .label':'_current_label','.current .title':'_current_title','.next .label':'_next_label','.next .title':'_next_title'},
  BTV_Passerelle_Replay:{'.label':'_label','.title':'_heading','.programme':'_title'},
};
export function baIntroDays(data:ProjectData){
  // These are engine-facing appointments: engineData already blanked hidden
  // dates, including a simple/multiple change on this same graphic instance.
  return [...new Set([1,2,3].map(n=>String(data[`_jour_${n}`]||'').trim().normalize('NFC').toLocaleUpperCase('fr-FR')).filter(Boolean))].join(' - ');
}
interface Target {field:string;node:SVGGraphicsElement|HTMLElement;motionNode:SVGGraphicsElement|HTMLElement;reveal?:ReturnType<typeof createTextReveal>;document?:any;sourceElement?:any;text:SVGTextElement;group:SVGGElement;regular:boolean;colour:string;translate:string;translated:boolean;inline:boolean;introDays:boolean}
export interface TextBox {field:string;x:number;y:number;width:number;height:number}
/** Instance-only edition: native animations stay immutable. Edited text follows
 * its original layer's motion/opacity. Split AE titles retain their animated
 * reveal mattes; moving a title moves its matte together with the glyphs. */
export function installTypography(g:LegacyGraphic,template:BroadcastTemplate,initial:ProjectData){
  installCeSoirBackground(g,template,initial);
  installRelayPlacement(g,template,initial);
  installAELogoCompatibility(g,template);
  installImageSizing(g,template,initial);
  const logo=installOverlayLogo(g,template,initial);
  const signage=createRenvoiSignage(g,template);
  let data=initial,targets:Target[]=[],animation:any,disposed=false,refreshing=false;
  let overlay:SVGSVGElement|undefined,style:HTMLStyleElement|undefined;
  let splitLabels:{node:HTMLElement;text:string;label:HTMLElement;hour:HTMLElement}[]=[];
  const allowed=new Set(textFields(template).map(([key])=>key));
  const getStyle=(field:string,introDays=false)=>{
    const own=currentStyle(data,field);
    // The native intro is one combined days layer. If any day needed a native
    // placeholder, draw that entire combined value, never the placeholder or
    // only the first appointment. Its existing first-day style remains in use.
    if(introDays&&[1,2,3].some(n=>data[`_jour_${n}`]&&!nativeTextStyle(currentStyle(data,`_jour_${n}`))))return {size:100,...own};
    return template.id==='BTV_Relais_Antenne'&&['_next_label','_next_time'].includes(field)&&[currentStyle(data,'_next_label'),currentStyle(data,'_next_time')].some(style=>!nativeTextStyle(style))?{size:100,...own}:own;
  };
  function safe(raw:ProjectData){
    const displayed=defaultTextCaseData(template,{...data,...raw});
    const clean=Object.fromEntries(Object.keys(raw).filter(key=>key!==TYPOGRAPHY_KEY&&key!==DEFAULT_TEXT_CASE).map(key=>[key,displayed[key]]));
    // A short placeholder is used only in an explicitly edited field. It reserves
    // the native timing/line variant; the full user text is drawn without truncation.
    for(const key of allowed){if(!(key in clean)&&key in data)clean[key]=data[key];if(!nativeTextStyle(getStyle(key))&&key in clean){
      // This literal is also the native validator's explicit no-hour mode.
      const immediate=template.id==='BTV_BA_1P'&&key==='_jour_1'&&String(clean[key]).trim().toLocaleLowerCase('fr-FR')==='tout de suite';
      if(!immediate)clean[key]=String(clean[key]??'').trim()?'A':'';
    }}
    return clean;
  }
  function opacity(node:Element){let a=1;for(let n:Element|null=node;n;n=n.parentElement){const css=getComputedStyle(n);if(css.display==='none'||css.visibility==='hidden')return 0;a*=Number(css.opacity);if(n===g)break;}return a;}
  function reset(){if(animation?._cbs)animation.removeEventListener('drawnFrame',refresh);for(const t of targets){t.node.removeAttribute('data-studio-text-original');if(t.translated)t.motionNode.style.translate=t.translate;t.reveal?.remove();}for(const item of splitLabels)if(item.label.parentNode===item.node&&item.hour.parentNode===item.node)item.node.textContent=item.text;splitLabels=[];targets=[];overlay?.remove();overlay=undefined;animation=undefined;}
  function add(field:string,node:Target['node'],doc?:any,introDays=false,sourceElement?:any){
    if(!allowed.has(field))return;
    const group=svg('g') as SVGGElement,text=svg('text') as SVGTextElement;group.setAttribute('data-studio-text-field',field);group.append(text);overlay!.append(group);
    const css=getComputedStyle(node),colour=css.color;if(!nativeTextStyle(getStyle(field,introDays)))node.setAttribute('data-studio-text-original','');
    if(introDays)group.setAttribute('data-studio-intro-days','');
    const parent=textRevealParent(node,template.id),reveal=parent?createTextReveal(parent,group):undefined,motionNode=parent||node;
    targets.push({field,node,motionNode,reveal,document:doc,sourceElement,text,group,regular:doc?String(doc.f).includes('Suisse'):css.fontFamily.includes('Suisse'),colour,translate:motionNode.style.translate,translated:false,inline:node.dataset.studioInlineText==='true',introDays});
  }
  function mount(){
    reset();if(disposed||data._studio_format&&data._studio_format!=='tv')return;
    overlay=svg('svg') as SVGSVGElement;overlay.setAttribute('viewBox','0 0 1920 1080');overlay.setAttribute('data-studio-typography','');overlay.style.cssText='position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;z-index:8';g.shadowRoot!.append(overlay);
    // Renvoi exposes its native animation directly, unlike the other engines.
    // Missing it leaves the safe placeholder on screen after a style change.
    animation=g.state?.animation||(template.id==='BTV_Renvoi'?g.animation:undefined);
    if(animation){const names=new Map((animation.animationData?.assets||[]).map((a:any)=>[a.id,a.nm]));
      function walk(container:any,scope='root'){for(const element of container.elements||[]){if(!element)continue;if(element.data?.ty===5){const field=template.id==='BTV_BA_1P'?baField(element.data.nm,scope):template.id==='BTV_Renvoi'?renvoiField(element.data.nm):template.id==='BTV_Evenement'?evenementField(element.data.nm):template.id==='BTV_Semainier'?semainierField(element.data.nm,element.data.ip):element.data.nm;add(field,element.layerElement,element.textProperty?.currentData,template.id==='BTV_BA_1P'&&scope==='root'&&element.data.nm==='JOUR',element);}walk(element,String(names.get(element.data?.refId)||scope));}}
      walk(animation.renderer);animation.addEventListener('drawnFrame',refresh);
    }else for(const [selector,field]of Object.entries(htmlFields[template.id]||{})){
      const node=g.scene?.root.querySelector(selector);if(!node)continue;
      if(template.id==='BTV_Relais_Antenne'&&field==='_next_label'&&!nativeTextStyle(getStyle(field))){
        const label=document.createElement('span'),hour=document.createElement('span');label.textContent='A';hour.textContent='A';node.style.position='relative';hour.style.cssText='position:absolute;right:0;top:0';node.replaceChildren(label,hour);add('_next_label',label);add('_next_time',hour);
      }else if(template.id==='BTV_Relais_Antenne'&&field==='_next_label'&&String(data._next_time||'')&&node.textContent===String(data._next_label)+' · '+String(data._next_time)){
        // Inline spans retain the native text, fitting and glyph flow. Relative
        // offsets move one run without converting it to an independent text box.
        const label=document.createElement('span'),hour=document.createElement('span');label.textContent=String(data._next_label);hour.textContent=String(data._next_time);
        for(const span of [label,hour]){span.dataset.studioInlineText='true';span.style.position='relative';}
        splitLabels.push({node,text:node.textContent,label,hour});node.replaceChildren(label,document.createTextNode(' · '),hour);add(field,label);add('_next_time',hour);
      }else add(field,node);
    }
    refresh();
  }
  function translateNative(t:Target,x:number,y:number,host?:DOMRect){
    if(!x&&!y){if(t.translated){if(t.inline){t.node.style.left='';t.node.style.top='';}else t.motionNode.style.translate=t.translate;}t.translated=false;return;}
    let matrix:{a:number;b:number;c:number;d:number};
    if(t.motionNode instanceof SVGGraphicsElement){const parent=t.motionNode.parentElement;if(!(parent instanceof SVGGraphicsElement))return;const m=parent.getScreenCTM();if(!m)return;matrix=m;}
    else{
      // HTML signatures use transforms on their scene/ancestors. Individual
      // translate is composed before the element's own animated transform.
      let m=new DOMMatrix();for(let p=t.node.parentElement;p;p=p.parentElement){const css=getComputedStyle(p);if(css.transform!=='none')m=new DOMMatrix(css.transform).multiply(m);if(p===g)break;}
      matrix=m;
    }
    const [dx,dy]=localDisplacement(matrix,x*host!.width/1920,y*host!.height/1080);
    if(t.inline){if(t.node.style.left!==`${dx}px`)t.node.style.left=`${dx}px`;if(t.node.style.top!==`${dy}px`)t.node.style.top=`${dy}px`;}else if(t.motionNode.style.translate!==`${dx}px ${dy}px`)t.motionNode.style.translate=`${dx}px ${dy}px`;t.translated=true;
  }
  function refresh(){
    logo.refresh();
    if(!disposed)signage.refresh(data);
    if(refreshing||disposed||!overlay)return;refreshing=true;
    try{
      // Unedited native text already follows the engine. Do not force a scene
      // measurement on every frame just to hide unused editor copies.
      let measured:DOMRect|undefined;
      const measure=()=>measured??(measured=g.getBoundingClientRect());
      for(const t of targets){
        const st=getStyle(t.field,t.introDays);
        if(nativeTextStyle(st)){setSvgAttribute(t.node,'data-studio-text-original',null);if(t.group.style.display!=='none')t.group.style.display='none';translateNative(t,st?.x??0,st?.y??0,st?.x||st?.y?measure():undefined);continue;}
        // AE marks most semainier layers inactive. Their editor copies cannot
        // contribute pixels, so avoid layout/style reads until the same native
        // layer becomes active. This also applies to precise frame inspection.
        if(animation&&nativeTextLayerHidden(t.node)){if(t.group.style.display!=='none')t.group.style.display='none';continue;}
        setSvgAttribute(t.node,'data-studio-text-original','');translateNative(t,0,0);
        if(!st)continue;
        const host=measure(),sx=1920/(host.width||1920),sy=1080/(host.height||1080);
        const doc=t.sourceElement?.textProperty?.currentData??t.document,css=getComputedStyle(t.node),regular=t.regular,base=doc?doc.finalSize??doc.s:parseFloat(css.fontSize),size=base*(st.size??100)/100;
        const align=st.align&&st.align!=='original'?st.align:doc?doc.j===1?'right':doc.j===2?'center':'left':css.textAlign;
        const displayed=defaultTextCaseData(template,data);
        let content=shapedText(t.introDays?baIntroDays(displayed):displayed[t.field],st,doc?.t===String(doc?.t||'').toLocaleUpperCase('fr')&&!regular);
        const lines=content.split('\n'),leading=size*(st.lineHeight??1.15);
        setSvgAttribute(t.text,'font-family',fontFamily(st.font||'original',regular));setSvgAttribute(t.text,'font-size',String(size));setSvgAttribute(t.text,'font-weight',st.bold?'700':'400');setSvgAttribute(t.text,'font-style',st.italic?'italic':'normal');setSvgAttribute(t.text,'letter-spacing',String(st.tracking??0));setSvgAttribute(t.text,'text-anchor',align==='right'?'end':align==='center'?'middle':'start');
        setSvgAttribute(t.text,'fill',st.colour&&st.colour!=='original'?st.colour:doc?.fc?'rgb('+doc.fc.map((n:number)=>Math.round(n*255)).join(',')+')':t.colour);
        setSvgAttribute(t.text,'xml:space','preserve');
        const key=JSON.stringify([content,leading]);if(t.text.dataset.content!==key){t.text.replaceChildren(...lines.map((line,i)=>{const n=svg('tspan');n.setAttribute('x','0');n.setAttribute('y',String(i*leading));n.textContent=line;return n;}));t.text.dataset.content=key;}
        applyNativeLineMotion(t.text,nativeLineMotion(t.sourceElement,template.id));
        let matrix:DOMMatrix;
        if(t.node instanceof SVGGraphicsElement){const m=t.node.getScreenCTM();if(!m){t.group.style.display='none';continue;}matrix=new DOMMatrix([m.a*sx,m.b*sy,m.c*sx,m.d*sy,(m.e-host.left)*sx,(m.f-host.top)*sy]);}
        else{const box=t.node.getBoundingClientRect(),scale=t.node.offsetWidth?box.width/t.node.offsetWidth:1;matrix=new DOMMatrix([scale*sx,0,0,scale*sy,(box.left-host.left)*sx+(align==='right'?box.width*sx:align==='center'?box.width*sx/2:0),(box.top-host.top)*sy+size*.85*scale*sy]);}
        if(t.reveal&&t.node instanceof SVGGraphicsElement){
          const parent=t.reveal.source.getScreenCTM(),grandparent=(t.reveal.source.parentElement as unknown as SVGGraphicsElement)?.getScreenCTM(),native=t.node.getScreenCTM();
          if(!parent||!grandparent||!native||Math.abs(parent.a*parent.d-parent.b*parent.c)<1e-10||Math.abs(grandparent.a*grandparent.d-grandparent.b*grandparent.c)<1e-10){t.group.style.display='none';continue;}
          t.reveal.sync();matrix=parent.inverse().multiply(native);
          const [dx,dy]=localDisplacement(grandparent,(st.x??0)/sx,(st.y??0)/sy);
          const anchor=grandparent.inverse().multiply(native);
          setSvgAttribute(t.reveal.placement,'transform',`translate(${dx} ${dy}) rotate(${st.rotation??0} ${anchor.e} ${anchor.f})`);
          setSvgAttribute(t.group,'transform',`matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`);setSvgAttribute(t.group,'opacity',css.opacity);
        }else{
          matrix.e+=st.x??0;matrix.f+=st.y??0;
          setSvgAttribute(t.group,'transform',matrix.toString()+` rotate(${st.rotation??0})`);setSvgAttribute(t.group,'opacity',String(opacity(t.node)));
        }
        if(t.group.style.display!=='')t.group.style.display='';
      }
    }finally{refreshing=false;}
  }
  async function configure(next:ProjectData,allowed:()=>boolean=()=>true){
    const css=await prepareTextFonts(next,template.module);if(disposed||!allowed())throw new DOMException('Édition interrompue.','AbortError');data=next;
    if(!style){style=document.createElement('style');g.shadowRoot!.append(style);}
    style.textContent=css+'\n[data-studio-text-original]>*{visibility:hidden!important}[data-studio-text-original]:not(g){color:transparent!important}';
  }
  const original={load:g.load.bind(g),update:g.updateAction.bind(g),dispose:g.dispose.bind(g)};
  g.load=async(params:any)=>{await configure({...data,...params.data});const result=await original.load({...params,data:safe(params.data)});mount();return result;};
  g.updateAction=async(raw:ProjectData)=>{const previous=data;await configure({...data,...raw});try{const result=await original.update(safe(raw));if(result?.statusCode>=400){await configure(previous);return result;}mount();return result;}catch(e){await configure(previous);refresh();throw e;}};
  if(g._draw){const draw=g._draw.bind(g);g._draw=(...args:any[])=>{const result=draw(...args);refresh();return result;};}
  for(const method of ['goToTime','stopAction','playAction'] as const){const original=g[method].bind(g);g[method]=async(...args:any[])=>{const result=await original(...args);refresh();return result;};}
  if(g._setHybridVisible){const visible=g._setHybridVisible.bind(g);g._setHybridVisible=(...args:any[])=>{const result=visible(...args);refresh();return result;};}
  g.dispose=async()=>{disposed=true;signage.dispose();reset();style?.remove();return original.dispose();};
  const controller={refresh,fields:()=>[...new Set(targets.filter(t=>!nativeTextStyle(getStyle(t.field,t.introDays))).map(t=>t.field))],boxes:():TextBox[]=>{refresh();const host=g.getBoundingClientRect();if(!host.width||!host.height)return [];return targets.flatMap(t=>{const native=nativeTextStyle(getStyle(t.field,t.introDays)),node=native?t.node:t.group;if((native?opacity(t.node):Number(t.group.getAttribute('opacity')))<=.05||!String(data[t.field]??'').trim())return [];const r=node.getBoundingClientRect();if(!r.width||!r.height)return [];return [{field:t.field,x:(r.left-host.left)/host.width,y:(r.top-host.top)/host.height,width:r.width/host.width,height:r.height/host.height}];});},nudge:(field:string,x:number,y:number)=>{const styles=textStyles(data);styles['tv:'+field]={...styles['tv:'+field],x,y};data={...data,[TYPOGRAPHY_KEY]:JSON.stringify(styles)};refresh();}};
  g.__typography={...controller,updateLive:async(next:ProjectData,allowed:()=>boolean)=>{
    next={...data,...next};
    if(!liveTextEdit(template,data,next)||data._studio_format&&data._studio_format!=='tv')return false;
    await configure(next,allowed);refresh();return true;
  }};return g.__typography;
}
